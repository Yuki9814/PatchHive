import { describe, expect, it } from 'vitest'
import { createDefaultWorkspace } from './storage'
import {
  getAgentHygieneImportConflict,
  workspaceReducer,
} from './workspaceReducer'

describe('workspaceReducer', () => {
  it('blocks locked stages even when selected directly', () => {
    const state = createDefaultWorkspace()
    const mission = state.missions[0]
    const patchPlanStage = mission.stages.find((stage) => stage.name === 'Patch Plan')

    const blocked = workspaceReducer(state, {
      type: 'set-stage',
      missionId: mission.id,
      stageId: patchPlanStage?.id ?? '',
    })

    expect(blocked.missions[0].activeStageId).toBe(mission.activeStageId)
  })

  it('allows stage advancement after the matching approval is recorded', () => {
    const state = createDefaultWorkspace()
    const mission = state.missions[0]
    const approved = workspaceReducer(state, {
      type: 'toggle-approval',
      missionId: mission.id,
      approvalId: 'patch-scope',
    })
    const advanced = workspaceReducer(approved, {
      type: 'advance-stage',
      missionId: mission.id,
    })

    expect(advanced.missions[0].activeStageId).toBe('patch-plan')
  })

  it('clamps lane confidence and drafts handoff fields from linked evidence kind', () => {
    const state = createDefaultWorkspace()
    const mission = state.missions[0]
    const stage = mission.stages[0]
    const lane = stage.lanes[0]
    const withConfidence = workspaceReducer(state, {
      type: 'update-lane-confidence',
      missionId: mission.id,
      stageId: stage.id,
      laneId: lane.id,
      confidence: 140,
    })
    const withEvidence = workspaceReducer(withConfidence, {
      type: 'add-evidence',
      missionId: mission.id,
      evidence: {
        kind: 'decision',
        title: 'Scope locked',
        detail: 'Maintainer asked for the smallest possible patch.',
        stageId: stage.id,
        agentId: lane.id,
      },
    })
    const drafted = workspaceReducer(withEvidence, {
      type: 'draft-handoff-from-evidence',
      missionId: mission.id,
      stageId: stage.id,
      laneId: lane.id,
      targetField: 'risks',
    })

    expect(withConfidence.missions[0].stages[0].lanes[0].confidence).toBe(100)
    expect(drafted.missions[0].outputs.risks).toContain('Scope locked')
    expect(drafted.missions[0].outputs.fieldSources.risks).toContain(withEvidence.missions[0].evidence[0].id)
  })

  it('routes patch evidence into the patch plan draft', () => {
    const state = createDefaultWorkspace()
    const mission = state.missions[0]
    const stage = mission.stages[1]
    const lane = stage.lanes.find((item) => item.id === 'patch-agent') ?? stage.lanes[0]
    const withEvidence = workspaceReducer(state, {
      type: 'add-evidence',
      missionId: mission.id,
      evidence: {
        kind: 'diff',
        title: 'Guard diff',
        detail: 'Adds a narrow guard around parser access.',
        stageId: stage.id,
        agentId: lane.id,
      },
    })
    const drafted = workspaceReducer(withEvidence, {
      type: 'draft-handoff-from-evidence',
      missionId: mission.id,
      stageId: stage.id,
      laneId: lane.id,
      targetField: 'patchPlan',
    })

    expect(drafted.missions[0].outputs.patchPlan).toContain('Guard diff')
  })

  it('updates mission status and filters evidence source links after deletion', () => {
    const state = createDefaultWorkspace()
    const mission = state.missions[0]
    const withEvidence = workspaceReducer(state, {
      type: 'add-evidence',
      missionId: mission.id,
      evidence: {
        kind: 'decision',
        title: 'Scope note',
        detail: 'Maintainer asked for a narrow patch.',
        stageId: mission.activeStageId,
      },
    })
    const evidenceId = withEvidence.missions[0].evidence[0].id
    const sourced = workspaceReducer(withEvidence, {
      type: 'set-handoff-field-sources',
      missionId: mission.id,
      field: 'summary',
      evidenceIds: [evidenceId],
    })
    const archived = workspaceReducer(sourced, {
      type: 'update-mission-status',
      missionId: mission.id,
      status: 'archived',
    })
    const deleted = workspaceReducer(archived, {
      type: 'delete-evidence',
      missionId: mission.id,
      evidenceId,
    })

    expect(archived.missions[0].status).toBe('archived')
    expect(deleted.missions[0].evidence.some((evidence) => evidence.id === evidenceId)).toBe(false)
    expect(deleted.missions[0].outputs.fieldSources.summary).toEqual([])
  })

  it('imports scanner evidence with provenance, deduplicates known fingerprints, and blocks the review lane', () => {
    const state = createDefaultWorkspace()
    const mission = state.missions[0]
    const scan = {
      format: 'json' as const,
      sourceName: 'scan.json',
      toolName: 'agent-hygiene' as const,
      producerStatus: 'declared' as const,
      producerVersion: '0.3.0',
      scanComplete: false,
      scopeId: 'scope-repository-a',
      score: 45,
      status: 'blocked',
      findings: [
        {
          ruleId: 'AH003',
          title: 'Hard-coded secret',
          severity: 'critical' as const,
          path: 'AGENTS.md',
          line: 4,
          message: 'A literal looks like a credential.',
          remediation: 'Move the value to a secret store.',
          fingerprint: '55555555555555555555',
          findingKey: 'finding-critical-a',
        },
      ],
      discoveryIssues: [
        {
          path: '.github/workflows/scan.yml',
          reason: 'unreadable',
          message: 'Permission denied.',
        },
      ],
      severityCounts: {
        critical: 1,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
      },
    }
    const imported = workspaceReducer(state, {
      type: 'import-agent-hygiene-scan',
      missionId: mission.id,
      stageId: mission.activeStageId,
      scan,
    })
    const importedMission = imported.missions[0]
    const reviewLane = importedMission.stages[0].lanes.find((lane) => lane.id === 'review-agent')

    expect(importedMission.evidence).toHaveLength(mission.evidence.length + 3)
    expect(importedMission.evidence[0].provenance).toMatchObject({
      importer: 'agent-hygiene',
      scanComplete: false,
    })
    expect(reviewLane?.status).toBe('blocked')
    expect(importedMission.outputs.fieldSources.risks).toHaveLength(3)

    const importedAgain = workspaceReducer(imported, {
      type: 'import-agent-hygiene-scan',
      missionId: mission.id,
      stageId: mission.activeStageId,
      scan,
    })

    expect(
      importedAgain.missions[0].evidence.filter(
          (evidence) => evidence.provenance?.fingerprint === '55555555555555555555',
      ),
    ).toHaveLength(1)

    const completeRerun = workspaceReducer(imported, {
      type: 'import-agent-hygiene-scan',
      missionId: mission.id,
      stageId: mission.activeStageId,
      scan: {
        ...scan,
        scanComplete: true,
        discoveryIssues: [],
      },
    })
    const originalCritical = completeRerun.missions[0].evidence.find(
      (evidence) => evidence.provenance?.fingerprint === '55555555555555555555',
    )
    const rerunReviewLane = completeRerun.missions[0].stages[0].lanes.find(
      (lane) => lane.id === 'review-agent',
    )

    expect(originalCritical?.triageStatus).toBe('open')
    expect(originalCritical?.provenance?.scanComplete).toBe(true)
    expect(rerunReviewLane?.status).toBe('blocked')

    const cleanRerun = workspaceReducer(completeRerun, {
      type: 'import-agent-hygiene-scan',
      missionId: mission.id,
      stageId: mission.activeStageId,
      scan: {
        ...scan,
        scanComplete: true,
        findings: [],
        discoveryIssues: [],
        severityCounts: {
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          info: 0,
        },
      },
    })
    const resolvedCritical = cleanRerun.missions[0].evidence.find(
      (evidence) => evidence.provenance?.fingerprint === '55555555555555555555',
    )

    expect(resolvedCritical?.triageStatus).toBe('resolved')
    expect(resolvedCritical?.provenance?.scanComplete).toBe(true)
    expect(resolvedCritical?.provenance?.resolution?.method).toBe('complete-rerun')
  })

  it('resolves incomplete scan provenance only after a complete rerun is imported', () => {
    const state = createDefaultWorkspace()
    const mission = state.missions[0]
    const baseScan = {
      format: 'json' as const,
      sourceName: 'scan.json',
      toolName: 'agent-hygiene' as const,
      producerStatus: 'declared' as const,
      producerVersion: '0.3.0',
      scopeId: 'scope-repository-a',
      score: 100,
      status: 'ready',
      findings: [],
      discoveryIssues: [],
      severityCounts: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
      },
    }
    const incomplete = workspaceReducer(state, {
      type: 'import-agent-hygiene-scan',
      missionId: mission.id,
      stageId: mission.activeStageId,
      scan: { ...baseScan, scanComplete: false },
    })
    const incompleteSummary = incomplete.missions[0].evidence.find(
      (evidence) => evidence.provenance?.ruleId === 'scan/summary',
    )
    const rerun = workspaceReducer(incomplete, {
      type: 'import-agent-hygiene-scan',
      missionId: mission.id,
      stageId: mission.activeStageId,
      scan: { ...baseScan, scanComplete: true },
    })

    expect(
      incompleteSummary?.triageStatus,
    ).toBe('open')
    const resolvedSummary = rerun.missions[0].evidence.find(
      (evidence) => evidence.id === incompleteSummary?.id,
    )
    expect(resolvedSummary?.triageStatus).toBe('resolved')
    expect(resolvedSummary?.provenance?.scanComplete).toBe(true)
  })

  it('reconciles scanner lane ownership across a same-scope rerun in another stage', () => {
    const state = createDefaultWorkspace()
    const mission = state.missions[0]
    const firstStage = mission.stages[0]
    const secondStage = mission.stages[1]
    const baseScan = {
      format: 'json' as const,
      sourceName: 'incomplete.json',
      toolName: 'agent-hygiene' as const,
      producerStatus: 'declared' as const,
      producerVersion: '0.3.0',
      scopeId: 'scope-cross-stage-rerun',
      score: 40,
      status: 'blocked',
      findings: [],
      discoveryIssues: [],
      severityCounts: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
      },
    }
    const incomplete = workspaceReducer(state, {
      type: 'import-agent-hygiene-scan',
      missionId: mission.id,
      stageId: firstStage.id,
      scan: { ...baseScan, scanComplete: false },
    })
    const incompleteSummary = incomplete.missions[0].evidence.find(
      (evidence) =>
        evidence.provenance?.scopeId === baseScan.scopeId &&
        evidence.provenance.ruleId === 'scan/summary',
    )
    const complete = workspaceReducer(incomplete, {
      type: 'import-agent-hygiene-scan',
      missionId: mission.id,
      stageId: secondStage.id,
      scan: {
        ...baseScan,
        sourceName: 'complete.json',
        scanComplete: true,
        score: 100,
        status: 'clean',
      },
    })
    const completeMission = complete.missions[0]
    const completeSummary = completeMission.evidence.find(
      (evidence) =>
        evidence.id !== incompleteSummary?.id &&
        evidence.provenance?.scopeId === baseScan.scopeId &&
        evidence.provenance.ruleId === 'scan/summary',
    )
    const firstReviewLane = completeMission.stages[0].lanes.find(
      (lane) => lane.id === 'review-agent',
    )
    const secondReviewLane = completeMission.stages[1].lanes.find(
      (lane) => lane.id === 'review-agent',
    )
    const assignmentCounts = new Map<string, number>()

    completeMission.stages.forEach((stage) => {
      stage.lanes.forEach((lane) => {
        lane.assignedEvidenceIds.forEach((id) => {
          assignmentCounts.set(id, (assignmentCounts.get(id) ?? 0) + 1)
        })
      })
    })

    expect(incompleteSummary?.id).toBeTruthy()
    expect(completeSummary?.id).toBeTruthy()
    expect(
      completeMission.evidence.find(
        (evidence) => evidence.id === incompleteSummary?.id,
      )?.triageStatus,
    ).toBe('resolved')
    expect(firstReviewLane?.status).toBe('ready')
    expect(secondReviewLane?.status).toBe('ready')
    expect(firstReviewLane?.assignedEvidenceIds).toContain(incompleteSummary?.id)
    expect(firstReviewLane?.assignedEvidenceIds).not.toContain(completeSummary?.id)
    expect(secondReviewLane?.assignedEvidenceIds).toContain(completeSummary?.id)
    expect(secondReviewLane?.assignedEvidenceIds).not.toContain(
      incompleteSummary?.id,
    )
    expect(assignmentCounts.get(incompleteSummary?.id ?? '')).toBe(1)
    expect(assignmentCounts.get(completeSummary?.id ?? '')).toBe(1)
  })

  it('marks the scanner review lane ready after the final high-severity finding is accepted', () => {
    const state = createDefaultWorkspace()
    const mission = state.missions[0]
    const imported = workspaceReducer(state, {
      type: 'import-agent-hygiene-scan',
      missionId: mission.id,
      stageId: mission.activeStageId,
      scan: {
        format: 'json',
        sourceName: 'scan.json',
        toolName: 'agent-hygiene',
        producerStatus: 'declared',
        producerVersion: '0.3.0',
        scanComplete: true,
        scopeId: 'scope-repository-a',
        findings: [
          {
            ruleId: 'AH003',
            title: 'Hard-coded secret',
            severity: 'high',
            path: 'AGENTS.md',
            line: 4,
            message: 'A literal needs review.',
            remediation: 'Remove the literal.',
            fingerprint: '66666666666666666666',
            findingKey: 'finding-triage-a',
          },
        ],
        discoveryIssues: [],
        severityCounts: {
          critical: 0,
          high: 1,
          medium: 0,
          low: 0,
          info: 0,
        },
      },
    })
    const scannerEvidence = imported.missions[0].evidence.find(
      (evidence) => evidence.provenance?.fingerprint === '66666666666666666666',
    )
    const rejectedBlankAcceptance = workspaceReducer(imported, {
      type: 'set-scanner-triage',
      missionId: mission.id,
      evidenceId: scannerEvidence?.id ?? '',
      triageStatus: 'accepted',
      resolutionNote: '   ',
    })
    const stillBlockedLane = rejectedBlankAcceptance.missions[0].stages[0].lanes.find(
      (lane) => lane.id === 'review-agent',
    )
    const accepted = workspaceReducer(rejectedBlankAcceptance, {
      type: 'set-scanner-triage',
      missionId: mission.id,
      evidenceId: scannerEvidence?.id ?? '',
      triageStatus: 'accepted',
      resolutionNote: 'The maintainer accepts this local-only test fixture risk.',
    })
    const reviewLane = accepted.missions[0].stages[0].lanes.find(
      (lane) => lane.id === 'review-agent',
    )
    const acceptedEvidence = accepted.missions[0].evidence.find(
      (evidence) => evidence.id === scannerEvidence?.id,
    )

    expect(stillBlockedLane?.status).toBe('blocked')
    expect(reviewLane?.status).toBe('ready')
    expect(acceptedEvidence?.triageStatus).toBe('accepted')
    expect(acceptedEvidence?.resolutionNote).toBe(
      'The maintainer accepts this local-only test fixture risk.',
    )
  })

  it('preserves an accepted risk note across the same finding rerun and clears it on reopen', () => {
    const state = createDefaultWorkspace()
    const mission = state.missions[0]
    const scan = {
      format: 'json' as const,
      sourceName: 'scan.json',
      toolName: 'agent-hygiene' as const,
      producerStatus: 'declared' as const,
      producerVersion: '0.3.0',
      scanComplete: true,
      scopeId: 'scope-note-rerun',
      findings: [
        {
          ruleId: 'AH003',
          title: 'Hard-coded secret',
          severity: 'high' as const,
          path: 'AGENTS.md',
          line: 4,
          message: 'A literal needs review.',
          remediation: 'Remove the literal.',
          fingerprint: '67676767676767676767',
          findingKey: 'finding-note-rerun',
        },
      ],
      discoveryIssues: [],
      severityCounts: {
        critical: 0,
        high: 1,
        medium: 0,
        low: 0,
        info: 0,
      },
    }
    const imported = workspaceReducer(state, {
      type: 'import-agent-hygiene-scan',
      missionId: mission.id,
      stageId: mission.activeStageId,
      scan,
    })
    const finding = imported.missions[0].evidence.find(
      (evidence) => evidence.provenance?.findingKey === scan.findings[0].findingKey,
    )
    const accepted = workspaceReducer(imported, {
      type: 'set-scanner-triage',
      missionId: mission.id,
      evidenceId: finding?.id ?? '',
      triageStatus: 'accepted',
      resolutionNote: 'Accepted while the generated fixture remains local.',
    })
    const rerun = workspaceReducer(accepted, {
      type: 'import-agent-hygiene-scan',
      missionId: mission.id,
      stageId: mission.activeStageId,
      scan,
    })
    const rerunFinding = rerun.missions[0].evidence.find(
      (evidence) => evidence.id === finding?.id,
    )
    const reopened = workspaceReducer(rerun, {
      type: 'set-scanner-triage',
      missionId: mission.id,
      evidenceId: finding?.id ?? '',
      triageStatus: 'open',
    })
    const reopenedFinding = reopened.missions[0].evidence.find(
      (evidence) => evidence.id === finding?.id,
    )

    expect(rerunFinding?.triageStatus).toBe('accepted')
    expect(rerunFinding?.resolutionNote).toBe(
      'Accepted while the generated fixture remains local.',
    )
    expect(reopenedFinding?.triageStatus).toBe('open')
    expect(reopenedFinding?.resolutionNote).toBeUndefined()
  })

  it('does not let an unrelated complete scope resolve an incomplete scan', () => {
    const state = createDefaultWorkspace()
    const mission = state.missions[0]
    const baseScan = {
      format: 'json' as const,
      sourceName: 'scan-a.json',
      toolName: 'agent-hygiene' as const,
      producerStatus: 'declared' as const,
      producerVersion: '0.3.0',
      scanComplete: false,
      scopeId: 'scope-repository-a',
      findings: [],
      discoveryIssues: [],
      severityCounts: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
      },
    }
    const incomplete = workspaceReducer(state, {
      type: 'import-agent-hygiene-scan',
      missionId: mission.id,
      stageId: mission.activeStageId,
      scan: baseScan,
    })
    const unrelated = workspaceReducer(incomplete, {
      type: 'import-agent-hygiene-scan',
      missionId: mission.id,
      stageId: mission.activeStageId,
      scan: {
        ...baseScan,
        sourceName: 'scan-b.json',
        scopeId: 'scope-repository-b',
        scanComplete: true,
      },
    })
    const originalSummary = unrelated.missions[0].evidence.find(
      (evidence) => evidence.provenance?.sourceName === 'scan-a.json',
    )

    expect(originalSummary?.triageStatus).toBe('open')
    expect(originalSummary?.provenance?.scanComplete).toBe(false)
  })

  it('deduplicates fingerprint-free findings by normalized identity across reruns', () => {
    const state = createDefaultWorkspace()
    const mission = state.missions[0]
    const scan = {
      format: 'json' as const,
      sourceName: 'legacy.json',
      toolName: 'agent-hygiene' as const,
      producerStatus: 'unverified' as const,
      scanComplete: true,
      scopeId: 'scope-legacy',
      findings: [
        {
          ruleId: 'AH001',
          title: 'Repeated finding',
          severity: 'medium' as const,
          path: 'AGENTS.md',
          line: 2,
          message: 'Repeated message.',
          remediation: 'Review it.',
          findingKey: 'finding-normalized-legacy',
        },
      ],
      discoveryIssues: [],
      severityCounts: {
        critical: 0,
        high: 0,
        medium: 1,
        low: 0,
        info: 0,
      },
    }
    const first = workspaceReducer(state, {
      type: 'import-agent-hygiene-scan',
      missionId: mission.id,
      stageId: mission.activeStageId,
      scan,
    })
    const second = workspaceReducer(first, {
      type: 'import-agent-hygiene-scan',
      missionId: mission.id,
      stageId: mission.activeStageId,
      scan,
    })

    expect(
      second.missions[0].evidence.filter(
        (evidence) => evidence.provenance?.findingKey === 'finding-normalized-legacy',
      ),
    ).toHaveLength(1)
  })

  it('enforces incomplete evidence locks in reducer actions', () => {
    const state = createDefaultWorkspace()
    const mission = state.missions[0]
    const imported = workspaceReducer(state, {
      type: 'import-agent-hygiene-scan',
      missionId: mission.id,
      stageId: mission.activeStageId,
      scan: {
        format: 'json',
        sourceName: 'incomplete.json',
        toolName: 'agent-hygiene',
        producerStatus: 'declared',
        producerVersion: '0.3.0',
        scanComplete: false,
        scopeId: 'scope-incomplete',
        findings: [],
        discoveryIssues: [],
        severityCounts: {
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          info: 0,
        },
      },
    })
    const summary = imported.missions[0].evidence.find(
      (evidence) => evidence.provenance?.sourceName === 'incomplete.json',
    )
    const forgedResolution = workspaceReducer(imported, {
      type: 'update-evidence',
      missionId: mission.id,
      evidenceId: summary?.id ?? '',
      evidence: { title: 'forged title', triageStatus: 'resolved' },
    })
    const deleted = workspaceReducer(forgedResolution, {
      type: 'delete-evidence',
      missionId: mission.id,
      evidenceId: summary?.id ?? '',
    })

    expect(
      forgedResolution.missions[0].evidence.find((evidence) => evidence.id === summary?.id)
        ?.triageStatus,
    ).toBe('open')
    expect(
      forgedResolution.missions[0].evidence.find((evidence) => evidence.id === summary?.id)
        ?.title,
    ).toBe('agent-hygiene scan summary')
    expect(deleted.missions[0].evidence.some((evidence) => evidence.id === summary?.id)).toBe(true)
  })

  it('rejects a cross-rerun fingerprint collision within the same scope', () => {
    const state = createDefaultWorkspace()
    const mission = state.missions[0]
    const scan = {
      format: 'json' as const,
      sourceName: 'scan.json',
      toolName: 'agent-hygiene' as const,
      producerStatus: 'declared' as const,
      producerVersion: '0.3.0',
      scanComplete: true,
      scopeId: 'scope-collision',
      findings: [
        {
          ruleId: 'AH001',
          title: 'Original',
          severity: 'low' as const,
          path: 'AGENTS.md',
          line: 1,
          message: 'Original.',
          remediation: 'Review.',
          fingerprint: '88888888888888888888',
          findingKey: 'finding-original',
        },
      ],
      discoveryIssues: [],
      severityCounts: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 1,
        info: 0,
      },
    }
    const imported = workspaceReducer(state, {
      type: 'import-agent-hygiene-scan',
      missionId: mission.id,
      stageId: mission.activeStageId,
      scan,
    })
    const collision = {
      ...scan,
      findings: [
        {
          ...scan.findings[0],
          ruleId: 'AH999',
          title: 'Different',
          severity: 'critical' as const,
          findingKey: 'finding-different',
        },
      ],
    }

    expect(getAgentHygieneImportConflict(imported.missions[0], collision)).toMatch(
      /fingerprint collision/i,
    )
    expect(
      workspaceReducer(imported, {
        type: 'import-agent-hygiene-scan',
        missionId: mission.id,
        stageId: mission.activeStageId,
        scan: collision,
      }),
    ).toEqual(imported)

    const evidenceOnlyCollision = {
      ...scan,
      findings: [
        {
          ...scan.findings[0],
          evidence: 'The scanner evidence changed while the fingerprint stayed fixed.',
          findingKey: 'finding-evidence-changed',
        },
      ],
    }

    expect(
      getAgentHygieneImportConflict(imported.missions[0], evidenceOnlyCollision),
    ).toMatch(/fingerprint collision/i)
    expect(
      workspaceReducer(imported, {
        type: 'import-agent-hygiene-scan',
        missionId: mission.id,
        stageId: mission.activeStageId,
        scan: evidenceOnlyCollision,
      }),
    ).toEqual(imported)
  })

  it('neutralizes imported mentions and URLs when drafting from scanner evidence', () => {
    const state = createDefaultWorkspace()
    const mission = state.missions[0]
    const stage = mission.stages[0]
    const imported = workspaceReducer(state, {
      type: 'import-agent-hygiene-scan',
      missionId: mission.id,
      stageId: stage.id,
      scan: {
        format: 'json',
        sourceName: 'scan.json',
        toolName: 'agent-hygiene',
        producerStatus: 'declared',
        producerVersion: '0.3.0',
        scanComplete: true,
        scopeId: 'scope-markdown',
        findings: [
          {
            ruleId: 'AH001',
            title: '@openai/security #123',
            severity: 'medium',
            path: 'AGENTS.md',
            line: 2,
            message: 'Review https://tracker.example/pixel.',
            remediation: 'Remove the text.',
            fingerprint: '77777777777777777777',
            findingKey: 'finding-markdown',
          },
        ],
        discoveryIssues: [],
        severityCounts: {
          critical: 0,
          high: 0,
          medium: 1,
          low: 0,
          info: 0,
        },
      },
    })
    const drafted = workspaceReducer(imported, {
      type: 'draft-handoff-from-evidence',
      missionId: mission.id,
      stageId: stage.id,
      laneId: 'review-agent',
      targetField: 'summary',
    })

    expect(drafted.missions[0].outputs.summary).toContain('@\u200Bopenai/security')
    expect(drafted.missions[0].outputs.summary).toContain('#\u200B123')
    expect(drafted.missions[0].outputs.summary).toContain(
      'https:\u200B//tracker.\u200Bexample/pixel',
    )
    expect(drafted.missions[0].outputs.summary).not.toContain('@openai/security')
  })
})
