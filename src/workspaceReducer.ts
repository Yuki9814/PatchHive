import { getNextStageGateBlocker } from './handoff'
import type { AgentHygieneScan } from './agentHygieneImport'
import { neutralizeUntrustedMarkdown } from './safeMarkdown'
import { deriveFindingKey, deriveScanScopeId } from './scanIdentity'
import {
  isAcceptedScannerRiskMissingResolution,
  isScannerRiskEvidence,
  normalizeResolutionNote,
} from './scannerTriage'
import { createDefaultWorkspace } from './storage'
import { createMissionFromInput } from './templates'
import type {
  AgentStatus,
  ComposerInput,
  EvidenceItem,
  EvidenceKind,
  HandoffEvidenceTarget,
  HandoffDraft,
  HandoffFieldKey,
  Mission,
  MissionStatus,
  WorkspaceSettings,
  WorkspaceState,
} from './types'

export type WorkspaceAction =
  | { type: 'create-mission'; input: ComposerInput }
  | { type: 'select-mission'; missionId: string }
  | { type: 'set-stage'; missionId: string; stageId: string }
  | { type: 'advance-stage'; missionId: string }
  | { type: 'update-lane-status'; missionId: string; stageId: string; laneId: string; status: AgentStatus }
  | { type: 'update-lane-confidence'; missionId: string; stageId: string; laneId: string; confidence: number }
  | { type: 'update-lane-output'; missionId: string; stageId: string; laneId: string; output: string }
  | { type: 'add-finding'; missionId: string; stageId: string; laneId: string; text: string }
  | { type: 'add-evidence'; missionId: string; evidence: Omit<EvidenceItem, 'id' | 'createdAt' | 'updatedAt'> }
  | {
      type: 'update-evidence'
      missionId: string
      evidenceId: string
      evidence: Partial<Omit<EvidenceItem, 'id' | 'createdAt' | 'updatedAt'>>
    }
  | {
      type: 'set-scanner-triage'
      missionId: string
      evidenceId: string
      triageStatus: NonNullable<EvidenceItem['triageStatus']>
      resolutionNote?: string
    }
  | { type: 'delete-evidence'; missionId: string; evidenceId: string }
  | { type: 'update-mission-status'; missionId: string; status: MissionStatus }
  | { type: 'toggle-approval'; missionId: string; approvalId: string }
  | { type: 'update-handoff'; missionId: string; output: Partial<HandoffDraft> }
  | {
      type: 'draft-handoff-from-evidence'
      missionId: string
      stageId: string
      laneId: string
      targetField: HandoffEvidenceTarget
    }
  | { type: 'set-handoff-field-sources'; missionId: string; field: HandoffFieldKey; evidenceIds: string[] }
  | {
      type: 'import-agent-hygiene-scan'
      missionId: string
      stageId: string
      scan: AgentHygieneScan
    }
  | { type: 'replace-workspace'; workspace: WorkspaceState }
  | { type: 'update-settings'; settings: Partial<WorkspaceSettings> }
  | { type: 'reset-workspace' }

const now = () => new Date().toISOString()
const createId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

function touch<T extends { updatedAt: string }>(mission: T): T {
  return {
    ...mission,
    updatedAt: now(),
  }
}

function mutateMission(
  state: WorkspaceState,
  missionId: string,
  updater: (mission: WorkspaceState['missions'][number]) => WorkspaceState['missions'][number],
) {
  return {
    ...state,
    missions: state.missions.map((mission) => (mission.id === missionId ? updater(mission) : mission)),
  }
}

function canEnterStage(mission: WorkspaceState['missions'][number], targetStageId: string) {
  const targetIndex = mission.stages.findIndex((stage) => stage.id === targetStageId)

  if (targetIndex <= 0) {
    return targetIndex === 0
  }

  const requiredStageNames = new Set(mission.stages.slice(1, targetIndex + 1).map((stage) => stage.name))

  return mission.approvals.every(
    (approval) => !requiredStageNames.has(approval.requiredBefore) || approval.approved,
  )
}

function appendSection(current: string, section: string) {
  const normalized = section.trim()

  if (!normalized || current.includes(normalized)) {
    return current
  }

  return [current.trim(), normalized].filter(Boolean).join('\n\n')
}

function scanSummaryLine(scan: AgentHygieneScan) {
  const counts = (['critical', 'high', 'medium', 'low', 'info'] as const)
    .filter((severity) => scan.severityCounts[severity] > 0)
    .map((severity) => `${severity}=${scan.severityCounts[severity]}`)
    .join(', ')

  return [
    `agent-hygiene ${scan.format.toUpperCase()} scan`,
    scan.scanComplete ? 'complete' : 'incomplete',
    scan.score === undefined ? '' : `score ${scan.score}/100`,
    counts || 'no findings',
  ]
    .filter(Boolean)
    .join(' · ')
}

function scanScopeId(scan: AgentHygieneScan) {
  return scan.scopeId ?? deriveScanScopeId(scan.scanRoot, scan.sourceName)
}

function provenanceScopeId(provenance: NonNullable<EvidenceItem['provenance']>) {
  return provenance.scopeId ?? deriveScanScopeId(provenance.scanRoot, provenance.sourceName)
}

function scanFindingKey(finding: AgentHygieneScan['findings'][number]) {
  return finding.findingKey ?? deriveFindingKey(finding)
}

function isScannerFinding(evidence: EvidenceItem) {
  return isScannerRiskEvidence(evidence)
}

function evidenceMatchesFinding(
  evidence: EvidenceItem,
  finding: AgentHygieneScan['findings'][number],
) {
  return (
    evidence.title === `${finding.ruleId} · ${finding.title}` &&
    evidence.detail === `${finding.message}\nRemediation: ${finding.remediation}` &&
    evidence.filePath === `${finding.path}:${finding.line}` &&
    evidence.severity === finding.severity
  )
}

export function getAgentHygieneImportConflict(mission: Mission, scan: AgentHygieneScan) {
  const scopeId = scanScopeId(scan)
  const scopedEvidence = mission.evidence.filter(
    (evidence) =>
      isScannerFinding(evidence) &&
      evidence.provenance &&
      provenanceScopeId(evidence.provenance) === scopeId,
  )
  const existingByFingerprint = new Map(
    scopedEvidence
      .filter((evidence) => Boolean(evidence.provenance?.fingerprint))
      .map((evidence) => [evidence.provenance?.fingerprint, evidence]),
  )
  const existingByFindingKey = new Map(
    scopedEvidence
      .filter((evidence) => Boolean(evidence.provenance?.findingKey))
      .map((evidence) => [evidence.provenance?.findingKey, evidence]),
  )

  for (const finding of scan.findings) {
    const findingKey = scanFindingKey(finding)
    const fingerprintMatch = finding.fingerprint
      ? existingByFingerprint.get(finding.fingerprint)
      : undefined
    const findingKeyMatch = existingByFindingKey.get(findingKey)

    if (
      fingerprintMatch &&
      (fingerprintMatch.provenance?.findingKey
        ? fingerprintMatch.provenance.findingKey !== findingKey
        : !evidenceMatchesFinding(fingerprintMatch, finding))
    ) {
      return `Fingerprint collision: ${finding.fingerprint} identifies different normalized findings in this scan scope.`
    }

    if (findingKeyMatch && !evidenceMatchesFinding(findingKeyMatch, finding)) {
      return `Normalized finding identity collision in scan scope ${scopeId}.`
    }
  }

  return ''
}

function isOpenScannerBlocker(evidence: EvidenceItem) {
  if (!evidence.provenance || evidence.triageStatus === 'resolved') {
    return false
  }

  if (isAcceptedScannerRiskMissingResolution(evidence)) {
    return true
  }

  if (!evidence.provenance.scanComplete) {
    return true
  }

  return (
    evidence.triageStatus === 'open' &&
    (evidence.severity === 'critical' || evidence.severity === 'high')
  )
}

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'create-mission': {
      const mission = createMissionFromInput(action.input)

      return {
        ...state,
        missions: [mission, ...state.missions],
        activeMissionId: mission.id,
      }
    }

    case 'select-mission':
      return {
        ...state,
        activeMissionId: action.missionId,
      }

    case 'set-stage':
      return mutateMission(state, action.missionId, (mission) =>
        canEnterStage(mission, action.stageId)
          ? touch({
              ...mission,
              activeStageId: action.stageId,
            })
          : mission,
      )

    case 'advance-stage':
      return mutateMission(state, action.missionId, (mission) => {
        const currentIndex = mission.stages.findIndex((stage) => stage.id === mission.activeStageId)
        const nextStage = mission.stages[currentIndex + 1]

        if (!nextStage || getNextStageGateBlocker(mission)) {
          return mission
        }

        return touch({
          ...mission,
          activeStageId: nextStage.id,
        })
      })

    case 'update-lane-status':
      return mutateMission(state, action.missionId, (mission) =>
        touch({
          ...mission,
          stages: mission.stages.map((stage) =>
            stage.id === action.stageId
              ? {
                  ...stage,
                  lanes: stage.lanes.map((lane) =>
                    lane.id === action.laneId ? { ...lane, status: action.status } : lane,
                  ),
                }
              : stage,
          ),
        }),
      )

    case 'update-lane-confidence':
      return mutateMission(state, action.missionId, (mission) =>
        touch({
          ...mission,
          stages: mission.stages.map((stage) =>
            stage.id === action.stageId
              ? {
                  ...stage,
                  lanes: stage.lanes.map((lane) =>
                    lane.id === action.laneId
                      ? { ...lane, confidence: Math.max(0, Math.min(100, action.confidence)) }
                      : lane,
                  ),
                }
              : stage,
          ),
        }),
      )

    case 'update-lane-output':
      return mutateMission(state, action.missionId, (mission) =>
        touch({
          ...mission,
          stages: mission.stages.map((stage) =>
            stage.id === action.stageId
              ? {
                  ...stage,
                  lanes: stage.lanes.map((lane) =>
                    lane.id === action.laneId ? { ...lane, outputDraft: action.output } : lane,
                  ),
                }
              : stage,
          ),
        }),
      )

    case 'add-finding':
      return mutateMission(state, action.missionId, (mission) =>
        touch({
          ...mission,
          stages: mission.stages.map((stage) =>
            stage.id === action.stageId
              ? {
                  ...stage,
                  lanes: stage.lanes.map((lane) =>
                    lane.id === action.laneId
                      ? {
                          ...lane,
                          findings: [
                            {
                              id: createId('finding'),
                              text: action.text,
                              createdAt: now(),
                            },
                            ...lane.findings,
                          ],
                        }
                      : lane,
                  ),
                }
              : stage,
          ),
        }),
      )

    case 'add-evidence':
      return mutateMission(state, action.missionId, (mission) =>
        touch({
          ...mission,
          evidence: [
            {
              ...action.evidence,
              id: createId('evidence'),
              kind: action.evidence.kind as EvidenceKind,
              createdAt: now(),
              updatedAt: now(),
            },
            ...mission.evidence,
          ],
        }),
      )

    case 'update-evidence':
      return mutateMission(state, action.missionId, (mission) => {
        const updatedAt = now()
        const evidence = mission.evidence.map((item) => {
          if (item.id !== action.evidenceId) {
            return item
          }

          if (item.provenance) {
            return item
          }

          return {
            ...item,
            ...action.evidence,
            updatedAt,
          }
        })
        const hasScannerBlocker = evidence.some(isOpenScannerBlocker)

        return touch({
          ...mission,
          evidence,
          stages: mission.stages.map((stage) => ({
            ...stage,
            lanes: stage.lanes.map((lane) =>
              lane.id === 'review-agent' && lane.outputDraft.startsWith('agent-hygiene ')
                ? {
                    ...lane,
                    status: hasScannerBlocker ? 'blocked' : 'ready',
                  }
                : lane,
            ),
          })),
          outputs: {
            ...mission.outputs,
            ready: false,
          },
        })
      })

    case 'set-scanner-triage':
      return mutateMission(state, action.missionId, (mission) => {
        const updatedAt = now()
        const resolutionNote = normalizeResolutionNote(action.resolutionNote)
        let changed = false
        const evidence = mission.evidence.map((item) => {
          if (
            item.id !== action.evidenceId ||
            !isScannerRiskEvidence(item) ||
            !item.provenance?.scanComplete ||
            (action.triageStatus === 'accepted' && !resolutionNote)
          ) {
            return item
          }

          changed = true
          return {
            ...item,
            triageStatus: action.triageStatus,
            resolutionNote:
              action.triageStatus === 'accepted' ? resolutionNote : undefined,
            updatedAt,
          }
        })

        if (!changed) {
          return mission
        }

        const hasScannerBlocker = evidence.some(isOpenScannerBlocker)

        return touch({
          ...mission,
          evidence,
          stages: mission.stages.map((stage) => ({
            ...stage,
            lanes: stage.lanes.map((lane) =>
              lane.id === 'review-agent' && lane.outputDraft.startsWith('agent-hygiene ')
                ? {
                    ...lane,
                    status: hasScannerBlocker ? 'blocked' : 'ready',
                  }
                : lane,
            ),
          })),
          outputs: {
            ...mission.outputs,
            ready: false,
          },
        })
      })

    case 'delete-evidence':
      return mutateMission(state, action.missionId, (mission) => {
        const target = mission.evidence.find((evidence) => evidence.id === action.evidenceId)

        if (
          target?.provenance?.importer === 'agent-hygiene' &&
          target.triageStatus !== 'resolved'
        ) {
          return mission
        }

        const evidence = mission.evidence.filter(
          (evidence) => evidence.id !== action.evidenceId,
        )
        const hasScannerBlocker = evidence.some(isOpenScannerBlocker)

        return touch({
          ...mission,
          evidence,
          stages: mission.stages.map((stage) => ({
            ...stage,
            lanes: stage.lanes.map((lane) =>
              lane.id === 'review-agent' &&
              lane.outputDraft.startsWith('agent-hygiene ')
                ? {
                    ...lane,
                    status: hasScannerBlocker ? 'blocked' : 'ready',
                    assignedEvidenceIds: lane.assignedEvidenceIds.filter(
                      (id) => id !== action.evidenceId,
                    ),
                  }
                : {
                    ...lane,
                    assignedEvidenceIds: lane.assignedEvidenceIds.filter(
                      (id) => id !== action.evidenceId,
                    ),
                  },
            ),
          })),
          outputs: {
            ...mission.outputs,
            ready: false,
            fieldSources: Object.fromEntries(
              Object.entries(mission.outputs.fieldSources).map(([field, ids]) => [
                field,
                ids.filter((id) => id !== action.evidenceId),
              ]),
            ),
          },
        })
      })

    case 'update-mission-status':
      return mutateMission(state, action.missionId, (mission) =>
        touch({
          ...mission,
          status: action.status,
        }),
      )

    case 'toggle-approval':
      return mutateMission(state, action.missionId, (mission) =>
        touch({
          ...mission,
          approvals: mission.approvals.map((approval) =>
            approval.id === action.approvalId
              ? {
                  ...approval,
                  approved: !approval.approved,
                  approvedAt: approval.approved ? undefined : now(),
                }
              : approval,
          ),
        }),
      )

    case 'update-handoff':
      return mutateMission(state, action.missionId, (mission) =>
        touch({
          ...mission,
          outputs: {
            ...mission.outputs,
            ...action.output,
          },
        }),
      )

    case 'draft-handoff-from-evidence':
      return mutateMission(state, action.missionId, (mission) => {
        const stage = mission.stages.find((item) => item.id === action.stageId)
        const lane = stage?.lanes.find((item) => item.id === action.laneId)
        const evidence = mission.evidence.filter(
          (item) =>
            item.stageId === action.stageId ||
            item.agentId === action.laneId ||
            lane?.assignedEvidenceIds.includes(item.id),
        )

        if (!stage || !lane || evidence.length === 0) {
          return mission
        }

        const evidenceSummary = evidence
          .slice(0, 4)
          .map((item) => {
            const title = item.provenance
              ? neutralizeUntrustedMarkdown(item.title)
              : item.title
            const detail = item.provenance
              ? neutralizeUntrustedMarkdown(item.detail)
              : item.detail

            return `[${item.kind}] ${title}: ${detail}`
          })
          .join('\n')
        const laneDraft = `${stage.name} / ${lane.name}\n${evidenceSummary}`
        const fieldSources = new Set([
          ...(mission.outputs.fieldSources[action.targetField] ?? []),
          ...evidence.map((item) => item.id),
        ])

        return touch({
          ...mission,
          outputs: {
            ...mission.outputs,
            [action.targetField]: [mission.outputs[action.targetField], laneDraft].filter(Boolean).join('\n\n'),
            fieldSources: {
              ...mission.outputs.fieldSources,
              [action.targetField]: [...fieldSources],
            },
          },
        })
      })

    case 'set-handoff-field-sources':
      return mutateMission(state, action.missionId, (mission) =>
        touch({
          ...mission,
          outputs: {
            ...mission.outputs,
            fieldSources: {
              ...mission.outputs.fieldSources,
              [action.field]: action.evidenceIds.filter((id) => mission.evidence.some((evidence) => evidence.id === id)),
            },
          },
        }),
      )

    case 'import-agent-hygiene-scan':
      return mutateMission(state, action.missionId, (mission) => {
        const stage = mission.stages.find((item) => item.id === action.stageId)

        if (!stage || getAgentHygieneImportConflict(mission, action.scan)) {
          return mission
        }

        const importedAt = now()
        const scopeId = scanScopeId(action.scan)
        const reviewLane = stage.lanes.find((lane) => lane.id === 'review-agent') ?? stage.lanes[0]
        const findingsByKey = new Map(
          action.scan.findings.map((finding) => [scanFindingKey(finding), finding]),
        )
        const findingsByFingerprint = new Map(
          action.scan.findings
            .filter((finding) => Boolean(finding.fingerprint))
            .map((finding) => [finding.fingerprint, finding]),
        )
        const matchedFindingKeys = new Set<string>()
        const touchedEvidenceIds = new Set<string>()
        const summaryEvidenceId = createId('evidence')
        const sharedProvenance = {
          importer: 'agent-hygiene' as const,
          format: action.scan.format,
          sourceName: action.scan.sourceName,
          toolName: 'agent-hygiene' as const,
          producerStatus: action.scan.producerStatus ?? 'unverified',
          producerVersion: action.scan.producerVersion,
          scanComplete: action.scan.scanComplete,
          importedAt,
          scanRoot: action.scan.scanRoot,
          scopeId,
        }
        const summaryEvidence: EvidenceItem = {
          id: summaryEvidenceId,
          kind: 'decision',
          title: 'agent-hygiene scan summary',
          detail: scanSummaryLine(action.scan),
          stageId: stage.id,
          agentId: reviewLane?.id,
          severity: action.scan.scanComplete ? 'info' : 'high',
          triageStatus: action.scan.scanComplete ? 'resolved' : 'open',
          provenance: {
            ...sharedProvenance,
            ruleId: 'scan/summary',
          },
          createdAt: importedAt,
          updatedAt: importedAt,
        }
        const existingEvidence = mission.evidence.map((evidence) => {
          const provenance = evidence.provenance

          if (
            !provenance ||
            provenance.importer !== 'agent-hygiene' ||
            provenanceScopeId(provenance) !== scopeId
          ) {
            return evidence
          }

          if (isScannerFinding(evidence)) {
            const matchingFinding =
              (provenance.findingKey
                ? findingsByKey.get(provenance.findingKey)
                : undefined) ??
              (provenance.fingerprint
                ? findingsByFingerprint.get(provenance.fingerprint)
                : undefined)

            if (matchingFinding) {
              const findingKey = scanFindingKey(matchingFinding)
              const preserveAcceptance =
                action.scan.scanComplete && evidence.triageStatus === 'accepted'
              matchedFindingKeys.add(findingKey)
              touchedEvidenceIds.add(evidence.id)

              return {
                ...evidence,
                title: `${matchingFinding.ruleId} · ${matchingFinding.title}`,
                detail: `${matchingFinding.message}\nRemediation: ${matchingFinding.remediation}`,
                filePath: `${matchingFinding.path}:${matchingFinding.line}`,
                stageId: stage.id,
                agentId: reviewLane?.id,
                severity: matchingFinding.severity,
                triageStatus: preserveAcceptance ? ('accepted' as const) : ('open' as const),
                resolutionNote: preserveAcceptance
                  ? normalizeResolutionNote(evidence.resolutionNote)
                  : undefined,
                provenance: {
                  ...sharedProvenance,
                  ruleId: matchingFinding.ruleId,
                  fingerprint: matchingFinding.fingerprint,
                  findingKey,
                },
                updatedAt: importedAt,
              }
            }

            if (action.scan.scanComplete) {
              touchedEvidenceIds.add(evidence.id)
              return {
                ...evidence,
                triageStatus: 'resolved' as const,
                resolutionNote: undefined,
                provenance: {
                  ...provenance,
                  ...sharedProvenance,
                },
                updatedAt: importedAt,
              }
            }

            return evidence
          }

          if (
            action.scan.scanComplete &&
            !provenance.scanComplete &&
            (provenance.ruleId === 'scan/summary' ||
              provenance.ruleId?.startsWith('discovery/'))
          ) {
            touchedEvidenceIds.add(evidence.id)
            return {
              ...evidence,
              triageStatus: 'resolved' as const,
              provenance: {
                ...provenance,
                ...sharedProvenance,
              },
              updatedAt: importedAt,
            }
          }

          return evidence
        })
        const newFindings = action.scan.findings.filter(
          (finding) => !matchedFindingKeys.has(scanFindingKey(finding)),
        )
        const findingEvidence: EvidenceItem[] = newFindings.map((finding) => ({
          id: createId('evidence'),
          kind: 'file',
          title: `${finding.ruleId} · ${finding.title}`,
          detail: `${finding.message}\nRemediation: ${finding.remediation}`,
          filePath: `${finding.path}:${finding.line}`,
          stageId: stage.id,
          agentId: reviewLane?.id,
          severity: finding.severity,
          triageStatus: 'open',
          provenance: {
            ...sharedProvenance,
            ruleId: finding.ruleId,
            fingerprint: finding.fingerprint,
            findingKey: scanFindingKey(finding),
          },
          createdAt: importedAt,
          updatedAt: importedAt,
        }))
        const discoveryEvidence: EvidenceItem[] = action.scan.discoveryIssues.map((issue) => ({
          id: createId('evidence'),
          kind: 'log',
          title: `Incomplete discovery · ${issue.reason}`,
          detail: issue.message,
          filePath: issue.path,
          stageId: stage.id,
          agentId: reviewLane?.id,
          severity: 'high',
          triageStatus: 'open',
          provenance: {
            ...sharedProvenance,
            ruleId: `discovery/${issue.reason}`,
          },
          createdAt: importedAt,
          updatedAt: importedAt,
        }))
        const newEvidence = [summaryEvidence, ...findingEvidence, ...discoveryEvidence]
        newEvidence.forEach((evidence) => touchedEvidenceIds.add(evidence.id))
        const nextEvidence = [...newEvidence, ...existingEvidence]
        const blockingEvidence = nextEvidence.filter(
          (evidence) => touchedEvidenceIds.has(evidence.id) && isOpenScannerBlocker(evidence),
        )
        const reviewFindings = [...action.scan.findings]
          .sort(
            (left, right) =>
              ['critical', 'high', 'medium', 'low', 'info'].indexOf(left.severity) -
              ['critical', 'high', 'medium', 'low', 'info'].indexOf(right.severity),
          )
          .slice(0, 12)
          .map((finding) => ({
            id: createId('finding'),
            text: `${finding.severity.toUpperCase()} ${finding.ruleId} ${finding.path}:${finding.line} — ${finding.message}`,
            createdAt: importedAt,
          }))
        const riskSection = [
          `Imported scan: ${scanSummaryLine(action.scan)}.`,
          blockingEvidence.length > 0
            ? `${blockingEvidence.length} scanner blocker(s) entered triage at import time.`
            : 'No high-severity or incomplete-scan blockers entered triage.',
        ].join('\n')
        const hasScannerBlocker = nextEvidence.some(isOpenScannerBlocker)
        const reviewFindingTexts = new Set(reviewFindings.map((finding) => finding.text))
        const scannerEvidenceIds = new Set<string>()
        const scannerEvidenceIdsByStage = new Map<
          string,
          Map<string, string[]>
        >()

        nextEvidence.forEach((evidence) => {
          if (evidence.provenance?.importer !== 'agent-hygiene') {
            return
          }

          scannerEvidenceIds.add(evidence.id)

          if (!evidence.stageId || !evidence.agentId) {
            return
          }

          const stageAssignments =
            scannerEvidenceIdsByStage.get(evidence.stageId) ??
            new Map<string, string[]>()
          stageAssignments.set(evidence.agentId, [
            ...(stageAssignments.get(evidence.agentId) ?? []),
            evidence.id,
          ])
          scannerEvidenceIdsByStage.set(evidence.stageId, stageAssignments)
        })

        return touch({
          ...mission,
          status: 'active',
          evidence: nextEvidence,
          stages: mission.stages.map((missionStage) => ({
            ...missionStage,
            lanes: missionStage.lanes.map((lane) => {
              const assignedScannerEvidenceIds =
                scannerEvidenceIdsByStage.get(missionStage.id)?.get(lane.id) ?? []
              const hadScannerAssignment = lane.assignedEvidenceIds.some((id) =>
                scannerEvidenceIds.has(id),
              )
              const assignedEvidenceIds = [
                ...new Set([
                  ...assignedScannerEvidenceIds,
                  ...lane.assignedEvidenceIds.filter(
                    (id) => !scannerEvidenceIds.has(id),
                  ),
                ]),
              ]
              const isCurrentReviewLane =
                missionStage.id === stage.id &&
                Boolean(reviewLane) &&
                lane.id === reviewLane?.id
              const isScannerReviewLane =
                isCurrentReviewLane ||
                hadScannerAssignment ||
                assignedScannerEvidenceIds.length > 0 ||
                lane.outputDraft.startsWith('agent-hygiene ')

              if (!isScannerReviewLane) {
                return {
                  ...lane,
                  assignedEvidenceIds,
                }
              }

              const reconciledLane = {
                ...lane,
                status: hasScannerBlocker ? ('blocked' as const) : ('ready' as const),
                assignedEvidenceIds,
              }

              if (!isCurrentReviewLane) {
                return reconciledLane
              }

              return {
                ...reconciledLane,
                confidence: action.scan.scanComplete ? 95 : 55,
                findings: [
                  ...reviewFindings,
                  ...lane.findings.filter(
                    (finding) => !reviewFindingTexts.has(finding.text),
                  ),
                ],
                outputDraft: scanSummaryLine(action.scan),
              }
            }),
          })),
          outputs: {
            ...mission.outputs,
            summary: appendSection(mission.outputs.summary, scanSummaryLine(action.scan)),
            risks: appendSection(mission.outputs.risks, riskSection),
            fieldSources: {
              ...mission.outputs.fieldSources,
              summary: [
                ...new Set([
                  ...(mission.outputs.fieldSources.summary ?? []),
                  summaryEvidenceId,
                ]),
              ],
              risks: [
                ...new Set([
                  ...(mission.outputs.fieldSources.risks ?? []),
                  ...blockingEvidence.map((evidence) => evidence.id),
                ]),
              ],
            },
            ready: false,
          },
        })
      })

    case 'replace-workspace':
      return action.workspace

    case 'update-settings':
      return {
        ...state,
        settings: {
          ...state.settings,
          ...action.settings,
        },
      }

    case 'reset-workspace':
      return createDefaultWorkspace()

    default:
      return state
  }
}
