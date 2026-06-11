import { describe, expect, it } from 'vitest'
import {
  buildHandoffMarkdown,
  getHandoffBlockers,
  getNextStageGateBlocker,
  getStageGateBlocker,
  isHandoffReady,
} from './handoff'
import { createMissionFromInput } from './templates'

function readyMission() {
  const mission = createMissionFromInput({
    templateId: 'pr-rescue',
    title: 'Reviewable patch',
    sourceKind: 'github-url',
    sourceText: 'https://github.com/owner/repo/pull/42',
    goal: 'Ship a minimal patch.',
    branch: 'main',
    constraints: 'Keep the diff tight',
  })

  return {
    ...mission,
    approvals: mission.approvals.map((approval) => ({
      ...approval,
      approved: true,
      approvedAt: '2026-06-07T00:00:00.000Z',
    })),
    outputs: {
      ...mission.outputs,
      fieldSources: {
        summary: [mission.evidence[0].id],
      },
    },
  }
}

describe('handoff', () => {
  it('reports blockers for pending approvals and empty required draft fields', () => {
    const mission = {
      ...readyMission(),
      approvals: readyMission().approvals.map((approval) =>
        approval.id === 'external-handoff' ? { ...approval, approved: false, approvedAt: undefined } : approval,
      ),
      outputs: {
        ...readyMission().outputs,
        risks: '',
      },
    }

    expect(getHandoffBlockers(mission)).toEqual([
      'Maintainer-facing message approved before Handoff export',
      'Risks is required',
    ])
    expect(isHandoffReady(mission)).toBe(false)
  })

  it('uses the same approval blocker text for stage and handoff gates', () => {
    const mission = readyMission()
    const patchPlanStage = mission.stages.find((stage) => stage.id === 'patch-plan')
    const gatedMission = {
      ...mission,
      approvals: mission.approvals.map((approval) =>
        approval.id === 'patch-scope' ? { ...approval, approved: false, approvedAt: undefined } : approval,
      ),
    }

    expect(getNextStageGateBlocker(gatedMission)).toBe('Patch scope approved before Patch Plan')
    expect(getStageGateBlocker(gatedMission, patchPlanStage?.id ?? '')).toBe(
      getHandoffBlockers(gatedMission)[0],
    )
  })

  it('exports edited summary, risks, evidence, and approvals', () => {
    const mission = readyMission()
    const markdown = buildHandoffMarkdown({
      ...mission,
      outputs: {
        ...mission.outputs,
        summary: 'Edited maintainer summary.',
        risks: 'Regression risk is low after parser coverage.',
      },
    })

    expect(isHandoffReady(mission)).toBe(true)
    expect(markdown).toContain('Edited maintainer summary.')
    expect(markdown).toContain('Regression risk is low after parser coverage.')
    expect(markdown).toContain('[link] Source GitHub thread')
    expect(markdown).toContain('## Handoff Evidence Sources')
    expect(markdown).toContain('Maintainer-facing message approved')
  })

  it('blocks export until evidence is mapped into the handoff', () => {
    const mission = {
      ...readyMission(),
      outputs: {
        ...readyMission().outputs,
        fieldSources: {},
      },
    }

    expect(getHandoffBlockers(mission)).toContain('At least one handoff field needs evidence source coverage')
    expect(isHandoffReady(mission)).toBe(false)
  })
})
