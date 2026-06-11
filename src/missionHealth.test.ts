import { describe, expect, it } from 'vitest'
import { getHandoffFieldStatuses, getMissionHealth } from './missionHealth'
import { createMissionFromInput } from './templates'

function missionWithGaps() {
  return createMissionFromInput({
    templateId: 'pr-rescue',
    title: 'Health check mission',
    sourceKind: 'diff-paste',
    sourceText: 'diff --git a/src/a.ts b/src/a.ts',
    goal: 'Keep the patch focused.',
    branch: 'main',
    constraints: 'No broad refactor',
  })
}

describe('missionHealth', () => {
  it('summarizes evidence, approval, handoff, and next-step gaps', () => {
    const mission = {
      ...missionWithGaps(),
      evidence: [
        {
          ...missionWithGaps().evidence[0],
          stageId: undefined,
        },
      ],
      outputs: {
        ...missionWithGaps().outputs,
        summary: '',
        patchPlan: '',
      },
    }

    const health = getMissionHealth(mission)

    expect(health.score).toBe(20)
    expect(health.evidenceGap).toContain('Link 1 evidence')
    expect(health.approvalGap).toContain('2 approval')
    expect(health.handoffGap).toContain('2 handoff')
    expect(health.handoffSourceCount).toBe(0)
    expect(health.nextStep).toBe('Patch scope approved before Patch Plan')
  })

  it('marks each handoff field as complete or missing', () => {
    const fields = getHandoffFieldStatuses({
      ...missionWithGaps(),
      outputs: {
        ...missionWithGaps().outputs,
        summary: '',
        risks: 'Low risk after focused tests.',
      },
    })

    expect(fields.find((field) => field.key === 'summary')?.complete).toBe(false)
    expect(fields.find((field) => field.key === 'risks')?.complete).toBe(true)
    expect(fields.find((field) => field.key === 'summary')?.sourceCount).toBe(0)
  })
})
