import { describe, expect, it } from 'vitest'
import { getEvidenceWorkflowStatus, getHandoffEvidenceCoverage } from './handoffCoverage'
import { createMissionFromInput } from './templates'

describe('handoffCoverage', () => {
  it('reports evidence workflow status and field coverage', () => {
    const mission = createMissionFromInput({
      templateId: 'pr-rescue',
      title: 'Coverage mission',
      sourceKind: 'diff-paste',
      sourceText: 'diff --git a/src/a.ts b/src/a.ts',
      goal: 'Keep evidence traceable.',
      branch: 'main',
      constraints: 'No broad refactor',
    })
    const evidence = mission.evidence[0]
    const sourcedMission = {
      ...mission,
      outputs: {
        ...mission.outputs,
        fieldSources: {
          summary: [evidence.id],
        },
      },
    }

    expect(getEvidenceWorkflowStatus(mission, { ...evidence, stageId: undefined })).toBe('unlinked')
    expect(getEvidenceWorkflowStatus(mission, evidence)).toBe('linked')
    expect(getEvidenceWorkflowStatus(sourcedMission, evidence)).toBe('in-handoff')
    expect(getHandoffEvidenceCoverage(sourcedMission)).toMatchObject({
      coveredTargets: ['summary'],
      sourceCount: 1,
      hasAnyCoverage: true,
    })
  })
})
