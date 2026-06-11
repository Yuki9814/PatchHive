import type {
  AgentLane,
  ApprovalGate,
  ComposerInput,
  EvidenceItem,
  Mission,
  MissionSource,
  MissionStage,
  MissionTemplate,
} from './types'

const now = () => new Date().toISOString()

const createId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export const agentBlueprints: Array<Pick<AgentLane, 'id' | 'name' | 'role'>> = [
  {
    id: 'planner',
    name: 'Planner',
    role: 'Scopes the mission, breaks work into stages, and keeps tradeoffs explicit.',
  },
  {
    id: 'repo-reader',
    name: 'Repo Reader',
    role: 'Turns pasted links, diffs, logs, and file hints into traceable evidence.',
  },
  {
    id: 'review-agent',
    name: 'Review Agent',
    role: 'Simulates maintainer review and calls out regression or review-burden risk.',
  },
  {
    id: 'patch-agent',
    name: 'Patch Agent',
    role: 'Drafts a minimal patch plan without touching code until approval is granted.',
  },
  {
    id: 'test-agent',
    name: 'Test Agent',
    role: 'Designs verification and regression coverage tied to the reported behavior.',
  },
]

export const missionTemplates: MissionTemplate[] = [
  {
    id: 'pr-rescue',
    name: 'PR Rescue',
    description: 'Clean up a noisy PR into a focused maintainer-friendly patch.',
    defaultGoal: 'Turn a noisy bug-fix PR into a minimal, reviewable patch with tests.',
    defaultConstraints: [
      'Keep the diff minimal',
      'Preserve existing behavior',
      'Ask for approval before external handoff',
    ],
    stageBlueprints: [
      {
        id: 'triage',
        name: 'Triage',
        summary: 'Normalize the PR, capture maintainer asks, and identify risky scope.',
        nextAction: 'Capture source evidence and approve the patch scope.',
      },
      {
        id: 'patch-plan',
        name: 'Patch Plan',
        summary: 'Convert the approved scope into a minimal patch and test plan.',
        nextAction: 'Review the patch/test plan and approve maintainer communication.',
      },
      {
        id: 'handoff',
        name: 'Handoff',
        summary: 'Package the final summary, evidence, risks, and reviewer note.',
        nextAction: 'Export the handoff after all required approvals are complete.',
      },
    ],
    approvalBlueprints: [
      {
        id: 'patch-scope',
        label: 'Patch scope approved',
        riskLevel: 'medium',
        requiredBefore: 'Patch Plan',
      },
      {
        id: 'external-handoff',
        label: 'Maintainer-facing message approved',
        riskLevel: 'high',
        requiredBefore: 'Handoff export',
      },
    ],
  },
  {
    id: 'issue-intake',
    name: 'Issue Intake',
    description: 'Turn a raw issue into a reproducible implementation plan.',
    defaultGoal: 'Turn a raw bug report into an evidence-backed implementation plan.',
    defaultConstraints: [
      'No code changes before reproduction notes exist',
      'Capture assumptions explicitly',
      'Every patch suggestion needs a test owner',
    ],
    stageBlueprints: [
      {
        id: 'intake',
        name: 'Intake',
        summary: 'Summarize the issue, missing context, and likely ownership.',
        nextAction: 'Attach source evidence and confirm assumptions.',
      },
      {
        id: 'repro',
        name: 'Reproduction',
        summary: 'Describe expected behavior, observed behavior, and setup gaps.',
        nextAction: 'Approve the implementation plan once reproduction notes are clear.',
      },
      {
        id: 'handoff',
        name: 'Handoff',
        summary: 'Export a concise plan with risks, evidence, and follow-up questions.',
        nextAction: 'Copy or download the issue response draft.',
      },
    ],
    approvalBlueprints: [
      {
        id: 'assumptions',
        label: 'Assumptions accepted',
        riskLevel: 'medium',
        requiredBefore: 'Reproduction',
      },
      {
        id: 'response',
        label: 'Issue response approved',
        riskLevel: 'medium',
        requiredBefore: 'Handoff export',
      },
    ],
  },
  {
    id: 'release-brief',
    name: 'Release Brief',
    description: 'Prepare release notes and risk handoff from merged work.',
    defaultGoal: 'Prepare a maintainer-facing release brief from merged work and pending risks.',
    defaultConstraints: [
      'Only cite merged work',
      'Every risk needs an owner',
      'Keep release notes scannable',
    ],
    stageBlueprints: [
      {
        id: 'digest',
        name: 'Digest',
        summary: 'Group merged work, notable changes, and open release risks.',
        nextAction: 'Attach merged-work evidence and assign risk owners.',
      },
      {
        id: 'draft',
        name: 'Draft',
        summary: 'Turn technical changes into a release narrative.',
        nextAction: 'Approve the release summary and verification language.',
      },
      {
        id: 'handoff',
        name: 'Handoff',
        summary: 'Export release notes, risks, and follow-up checklist.',
        nextAction: 'Download the release brief for review.',
      },
    ],
    approvalBlueprints: [
      {
        id: 'risk-summary',
        label: 'Risk summary approved',
        riskLevel: 'high',
        requiredBefore: 'Draft',
      },
      {
        id: 'release-copy',
        label: 'Release copy approved',
        riskLevel: 'medium',
        requiredBefore: 'Handoff export',
      },
    ],
  },
]

export function parseGithubSource(value: string): Pick<MissionSource, 'parsedRepo' | 'parsedNumber'> {
  const match = value.match(
    /(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/(?:pull|pulls|issues)\/(\d+)(?:[/?#][^\s]*)?/i,
  )

  if (!match) {
    return {}
  }

  return {
    parsedRepo: match[1],
    parsedNumber: match[2],
  }
}

function makeLanes(stageName: string, templateName: string): AgentLane[] {
  return agentBlueprints.map((agent) => ({
    ...agent,
    status: agent.id === 'planner' ? 'ready' : agent.id === 'repo-reader' ? 'scanning' : 'waiting',
    confidence: agent.id === 'planner' ? 82 : agent.id === 'repo-reader' ? 74 : 64,
    findings:
      agent.id === 'planner'
        ? [
            {
              id: createId('finding'),
              text: `${templateName} started in ${stageName}; scope and evidence are the first review targets.`,
              createdAt: now(),
            },
          ]
        : [],
    assignedEvidenceIds: [],
    outputDraft:
      agent.id === 'planner'
        ? 'Initial scope is ready for human review.'
        : 'Waiting for evidence or approval before producing a draft.',
  }))
}

function makeStages(template: MissionTemplate): MissionStage[] {
  return template.stageBlueprints.map((stage) => ({
    ...stage,
    lanes: makeLanes(stage.name, template.name),
  }))
}

function makeInitialEvidence(input: ComposerInput, source: MissionSource, stageId: string): EvidenceItem[] {
  const createdAt = now()
  const sourceKindLabels: Record<ComposerInput['sourceKind'], string> = {
    'github-url': 'GitHub thread',
    'diff-paste': 'Pasted diff',
    'log-paste': 'Pasted log',
    manual: 'Manual brief',
  }
  const sourceKindEvidence: Record<ComposerInput['sourceKind'], EvidenceItem['kind']> = {
    'github-url': 'link',
    'diff-paste': 'diff',
    'log-paste': 'log',
    manual: 'decision',
  }
  const trimmedSource = input.sourceText.trim()
  const evidence: EvidenceItem[] = [
    {
      id: createId('evidence'),
      kind: sourceKindEvidence[source.kind],
      title: `Source ${sourceKindLabels[source.kind]}`,
      detail:
        source.kind === 'github-url'
          ? source.url ?? 'GitHub source URL captured.'
          : `${sourceKindLabels[source.kind]} captured: ${trimmedSource.slice(0, 220) || 'No source text supplied.'}`,
      sourceText: trimmedSource,
      url: source.kind === 'github-url' ? source.url : undefined,
      stageId,
      createdAt,
      updatedAt: createdAt,
    },
  ]

  if (source.parsedRepo) {
    evidence.push({
      id: createId('evidence'),
      kind: 'decision',
      title: 'Repository parsed',
      detail: `${source.parsedRepo}${source.parsedNumber ? ` #${source.parsedNumber}` : ''}`,
      stageId,
      createdAt,
      updatedAt: createdAt,
    })
  }

  return evidence
}

export function createMissionFromInput(input: ComposerInput): Mission {
  const template = missionTemplates.find((item) => item.id === input.templateId) ?? missionTemplates[0]
  const parsed = parseGithubSource(input.sourceText)
  const source: MissionSource = {
    kind: input.sourceKind,
    url: input.sourceKind === 'github-url' ? input.sourceText.trim() : undefined,
    rawText: input.sourceText.trim(),
    ...parsed,
  }
  const createdAt = now()
  const stages = makeStages(template)
  const constraints = input.constraints
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)

  return {
    id: createId('mission'),
    templateId: template.id,
    status: 'active',
    title: input.title.trim() || template.name,
    source,
    repo: parsed.parsedRepo ?? 'Repository not parsed',
    branch: input.branch.trim() || 'main',
    goal: input.goal.trim() || template.defaultGoal,
    constraints: constraints.length > 0 ? constraints : template.defaultConstraints,
    stages,
    activeStageId: stages[0].id,
    evidence: makeInitialEvidence(input, source, stages[0].id),
    approvals: template.approvalBlueprints.map((approval) => ({
      ...approval,
      approved: false,
    })) as ApprovalGate[],
    outputs: {
      summary: input.goal.trim() || template.defaultGoal,
      patchPlan: 'Draft the smallest credible change after evidence and approvals are in place.',
      testPlan: 'Define regression coverage before a maintainer-facing handoff.',
      risks: 'Risk review pending.',
      maintainerComment: 'Thanks for the context. I reviewed the scope and will follow up with a minimal plan once evidence and tests are attached.',
      fieldSources: {},
      ready: false,
    },
    createdAt,
    updatedAt: createdAt,
  }
}

export function createSeedMission(): Mission {
  return createMissionFromInput({
    templateId: 'pr-rescue',
    title: 'pypdf XObject guard rescue',
    sourceKind: 'github-url',
    sourceText: 'https://github.com/py-pdf/pypdf/pull/3124',
    goal: 'Turn a noisy bug-fix PR into a minimal, reviewable patch with regression coverage.',
    branch: 'fix/xobjs-unbound',
    constraints: 'Keep the diff minimal\nPreserve existing behavior\nRequest human approval before final patch',
  })
}
