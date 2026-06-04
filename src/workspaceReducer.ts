import { createDefaultWorkspace } from './storage'
import { createMissionFromInput } from './templates'
import type {
  AgentStatus,
  ComposerInput,
  EvidenceItem,
  EvidenceKind,
  HandoffDraft,
  WorkspaceState,
} from './types'

type WorkspaceAction =
  | { type: 'create-mission'; input: ComposerInput }
  | { type: 'select-mission'; missionId: string }
  | { type: 'set-stage'; missionId: string; stageId: string }
  | { type: 'advance-stage'; missionId: string }
  | { type: 'update-lane-status'; missionId: string; stageId: string; laneId: string; status: AgentStatus }
  | { type: 'update-lane-output'; missionId: string; stageId: string; laneId: string; output: string }
  | { type: 'add-finding'; missionId: string; stageId: string; laneId: string; text: string }
  | { type: 'add-evidence'; missionId: string; evidence: Omit<EvidenceItem, 'id' | 'createdAt'> }
  | { type: 'toggle-approval'; missionId: string; approvalId: string }
  | { type: 'update-handoff'; missionId: string; output: Partial<HandoffDraft> }
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

function isStageLocked(state: WorkspaceState, missionId: string, nextStageName: string) {
  const mission = state.missions.find((item) => item.id === missionId)

  if (!mission) {
    return false
  }

  return mission.approvals.some(
    (approval) => !approval.approved && approval.requiredBefore === nextStageName,
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
        touch({
          ...mission,
          activeStageId: action.stageId,
        }),
      )

    case 'advance-stage':
      return mutateMission(state, action.missionId, (mission) => {
        const currentIndex = mission.stages.findIndex((stage) => stage.id === mission.activeStageId)
        const nextStage = mission.stages[currentIndex + 1]

        if (!nextStage || isStageLocked(state, mission.id, nextStage.name)) {
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
            },
            ...mission.evidence,
          ],
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

    case 'reset-workspace':
      return createDefaultWorkspace()

    default:
      return state
  }
}
