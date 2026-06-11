import { getNextStageGateBlocker } from './handoff'
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
      return mutateMission(state, action.missionId, (mission) =>
        touch({
          ...mission,
          evidence: mission.evidence.map((evidence) =>
            evidence.id === action.evidenceId
              ? {
                  ...evidence,
                  ...action.evidence,
                  updatedAt: now(),
                }
              : evidence,
          ),
        }),
      )

    case 'delete-evidence':
      return mutateMission(state, action.missionId, (mission) =>
        touch({
          ...mission,
          evidence: mission.evidence.filter((evidence) => evidence.id !== action.evidenceId),
          stages: mission.stages.map((stage) => ({
            ...stage,
            lanes: stage.lanes.map((lane) => ({
              ...lane,
              assignedEvidenceIds: lane.assignedEvidenceIds.filter((id) => id !== action.evidenceId),
            })),
          })),
          outputs: {
            ...mission.outputs,
            fieldSources: Object.fromEntries(
              Object.entries(mission.outputs.fieldSources).map(([field, ids]) => [
                field,
                ids.filter((id) => id !== action.evidenceId),
              ]),
            ),
          },
        }),
      )

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
          .map((item) => `[${item.kind}] ${item.title}: ${item.detail}`)
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
