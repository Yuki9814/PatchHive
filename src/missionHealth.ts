import { getHandoffBlockers } from './handoff'
import { getHandoffEvidenceCoverage, getHandoffFieldSourceIds } from './handoffCoverage'
import type { HandoffFieldKey, Mission } from './types'

export type HandoffFieldStatus = {
  key: HandoffFieldKey
  label: string
  complete: boolean
  sourceCount: number
  blocker: string
}

export type MissionHealth = {
  stageName: string
  score: number
  evidenceGap: string
  approvalGap: string
  handoffGap: string
  nextStep: string
  unlinkedEvidenceCount: number
  pendingApprovalCount: number
  missingHandoffCount: number
  handoffSourceCount: number
}

const handoffFields: Array<Pick<HandoffFieldStatus, 'key' | 'label' | 'blocker'>> = [
  { key: 'summary', label: 'Summary', blocker: 'Summary is required' },
  { key: 'patchPlan', label: 'Patch plan', blocker: 'Patch plan is required' },
  { key: 'testPlan', label: 'Test plan', blocker: 'Test plan is required' },
  { key: 'risks', label: 'Risks', blocker: 'Risks is required' },
  {
    key: 'maintainerComment',
    label: 'Maintainer comment',
    blocker: 'Maintainer comment is required',
  },
]

export function getHandoffFieldStatuses(mission: Mission): HandoffFieldStatus[] {
  return handoffFields.map((field) => ({
    ...field,
    complete: mission.outputs[field.key].trim().length > 0,
    sourceCount: getHandoffFieldSourceIds(mission, field.key).length,
  }))
}

export function getMissionHealth(mission: Mission): MissionHealth {
  const stage = mission.stages.find((item) => item.id === mission.activeStageId) ?? mission.stages[0]
  const unlinkedEvidenceCount = mission.evidence.filter((item) => !item.stageId && !item.agentId).length
  const pendingApprovalCount = mission.approvals.filter((approval) => !approval.approved).length
  const missingHandoffCount = getHandoffFieldStatuses(mission).filter((field) => !field.complete).length
  const handoffCoverage = getHandoffEvidenceCoverage(mission)
  const blockers = getHandoffBlockers(mission)

  const completedChecks = [
    mission.evidence.length > 0,
    unlinkedEvidenceCount === 0,
    pendingApprovalCount === 0,
    missingHandoffCount === 0,
    handoffCoverage.hasAnyCoverage,
  ].filter(Boolean).length

  return {
    stageName: stage?.name ?? 'No stage',
    score: Math.round((completedChecks / 5) * 100),
    evidenceGap:
      mission.evidence.length === 0
        ? 'Capture at least one evidence item.'
        : unlinkedEvidenceCount > 0
          ? `Link ${unlinkedEvidenceCount} evidence item(s) to a stage or agent.`
          : 'Evidence is linked.',
    approvalGap:
      pendingApprovalCount > 0
        ? `${pendingApprovalCount} approval gate(s) still pending.`
        : 'Approval gates are clear.',
    handoffGap:
      missingHandoffCount > 0
        ? `${missingHandoffCount} handoff field(s) need content.`
        : !handoffCoverage.hasAnyCoverage
          ? 'Map evidence into the handoff draft.'
        : 'Handoff fields are complete.',
    nextStep: blockers[0] ?? 'Export or copy the maintainer handoff.',
    unlinkedEvidenceCount,
    pendingApprovalCount,
    missingHandoffCount,
    handoffSourceCount: handoffCoverage.sourceCount,
  }
}
