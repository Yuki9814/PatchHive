import { describe, expect, it } from 'vitest'
import { createDefaultWorkspace } from './storage'
import { workspaceReducer } from './workspaceReducer'

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
    })

    expect(withConfidence.missions[0].stages[0].lanes[0].confidence).toBe(100)
    expect(drafted.missions[0].outputs.risks).toContain('Scope locked')
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
    })

    expect(drafted.missions[0].outputs.patchPlan).toContain('Guard diff')
  })
})
