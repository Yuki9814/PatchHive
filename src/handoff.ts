import type { ApprovalGate, EvidenceItem, Mission, MissionStage } from './types'

function listItems(items: string[]) {
  if (items.length === 0) {
    return '- None recorded'
  }

  return items.map((item) => `- ${item}`).join('\n')
}

function evidenceLine(item: EvidenceItem) {
  const source = item.url ? ` (${item.url})` : item.filePath ? ` (${item.filePath})` : ''
  return `- [${item.kind}] ${item.title}: ${item.detail}${source}`
}

function approvalLine(item: ApprovalGate) {
  const state = item.approved ? `approved${item.approvedAt ? ` at ${item.approvedAt}` : ''}` : 'pending'
  return `- ${item.label}: ${state} before ${item.requiredBefore}`
}

function stageLine(stage: MissionStage) {
  return `- ${stage.name}: ${stage.summary}`
}

export function isHandoffReady(mission: Mission) {
  return mission.approvals.every((approval) => approval.approved)
}

export function buildHandoffMarkdown(mission: Mission) {
  const pendingApprovals = mission.approvals.filter((approval) => !approval.approved)
  const laneOutputs = mission.stages
    .flatMap((stage) =>
      stage.lanes.map((lane) => `- ${stage.name} / ${lane.name}: ${lane.outputDraft || 'No draft yet.'}`),
    )
    .join('\n')

  return `# ${mission.title}

Repository: ${mission.repo}
Branch: ${mission.branch}
Source: ${mission.source.url ?? mission.source.rawText ?? 'manual'}
Status: ${isHandoffReady(mission) ? 'Ready for maintainer handoff' : 'Needs approval before handoff'}

## Goal

${mission.goal}

## Scope Guardrails

${listItems(mission.constraints)}

## Workflow Stages

${mission.stages.map(stageLine).join('\n')}

## Evidence

${mission.evidence.length > 0 ? mission.evidence.map(evidenceLine).join('\n') : '- No evidence attached yet'}

## Agent Outputs

${laneOutputs || '- No agent output yet'}

## Patch Plan

${mission.outputs.patchPlan}

## Test Plan

${mission.outputs.testPlan}

## Risks

${mission.outputs.risks}

## Approvals

${mission.approvals.map(approvalLine).join('\n')}

## Pending Approvals

${pendingApprovals.length > 0 ? pendingApprovals.map(approvalLine).join('\n') : '- None'}

## Maintainer Comment Draft

${mission.outputs.maintainerComment}
`
}
