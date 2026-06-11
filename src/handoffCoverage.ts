import type { EvidenceItem, HandoffEvidenceTarget, HandoffFieldKey, Mission } from './types'

export type EvidenceWorkflowStatus = 'unlinked' | 'linked' | 'in-handoff'

export const handoffEvidenceTargets: HandoffEvidenceTarget[] = ['summary', 'patchPlan', 'testPlan', 'risks']

export function getHandoffFieldSourceIds(mission: Mission, field: HandoffFieldKey) {
  return mission.outputs.fieldSources[field] ?? []
}

export function getEvidenceHandoffFields(mission: Mission, evidenceId: string): HandoffFieldKey[] {
  return (Object.entries(mission.outputs.fieldSources) as Array<[HandoffFieldKey, string[]]>)
    .filter(([, ids]) => ids.includes(evidenceId))
    .map(([field]) => field)
}

export function getEvidenceWorkflowStatus(mission: Mission, evidence: EvidenceItem): EvidenceWorkflowStatus {
  if (getEvidenceHandoffFields(mission, evidence.id).length > 0) {
    return 'in-handoff'
  }

  if (evidence.stageId || evidence.agentId) {
    return 'linked'
  }

  return 'unlinked'
}

export function getHandoffEvidenceCoverage(mission: Mission) {
  const coveredTargets = handoffEvidenceTargets.filter(
    (field) => getHandoffFieldSourceIds(mission, field).length > 0,
  )
  const sourceIds = new Set(coveredTargets.flatMap((field) => getHandoffFieldSourceIds(mission, field)))

  return {
    coveredTargets,
    missingTargets: handoffEvidenceTargets.filter((field) => !coveredTargets.includes(field)),
    sourceCount: sourceIds.size,
    hasAnyCoverage: sourceIds.size > 0,
  }
}
