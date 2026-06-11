import { missionTemplates } from './templates'
import type {
  AgentStatus,
  ComposerInput,
  EvidenceKind,
  HandoffEvidenceTarget,
  HandoffFieldKey,
  Mission,
  MissionStatus,
  MissionStatusFilter,
  MissionTemplate,
} from './types'

export type EvidenceForm = {
  kind: EvidenceKind
  title: string
  detail: string
  sourceText: string
  url: string
  filePath: string
  stageId: string
  agentId: string
}

export type EvidenceFilter = 'all' | 'unlinked' | EvidenceKind

export const agentStatuses: AgentStatus[] = ['idle', 'scanning', 'drafting', 'waiting', 'ready', 'blocked']
export const evidenceKinds: EvidenceKind[] = ['file', 'log', 'decision', 'link', 'diff']
export const missionStatuses: MissionStatus[] = ['active', 'ready', 'archived']
export const missionStatusFilters: MissionStatusFilter[] = ['all', ...missionStatuses]
export const handoffEvidenceTargets: HandoffEvidenceTarget[] = ['summary', 'patchPlan', 'testPlan', 'risks']

export const missionStatusLabels: Record<MissionStatusFilter, string> = {
  all: 'All missions',
  active: 'Active',
  ready: 'Ready',
  archived: 'Archived',
}

export const handoffFieldLabels: Record<HandoffFieldKey, string> = {
  summary: 'Summary',
  patchPlan: 'Patch plan',
  testPlan: 'Test plan',
  risks: 'Risks',
  maintainerComment: 'Maintainer comment',
}

export const sourceHints: Record<ComposerInput['sourceKind'], string> = {
  'github-url': 'Paste a GitHub issue or PR URL. PatchHive parses owner/repo and issue number locally.',
  'diff-paste': 'Paste a focused diff. Include file paths and enough context for review.',
  'log-paste': 'Paste the failing command and the relevant error lines.',
  manual: 'Write the source brief, constraints, and any maintainer asks.',
}

export const statusDescriptions: Record<AgentStatus, string> = {
  idle: 'No work started.',
  scanning: 'Reading source and collecting evidence.',
  drafting: 'Converting evidence into a usable output.',
  waiting: 'Blocked on evidence, approval, or human input.',
  ready: 'Ready for review or handoff.',
  blocked: 'Risk or missing input prevents progress.',
}

export const getTemplate = (templateId: string) =>
  missionTemplates.find((template) => template.id === templateId) ?? missionTemplates[0]

export function createComposerInput(template: MissionTemplate = missionTemplates[0]): ComposerInput {
  return {
    templateId: template.id,
    title: template.name,
    sourceKind: 'github-url',
    sourceText: '',
    goal: template.defaultGoal,
    branch: 'main',
    constraints: template.defaultConstraints.join('\n'),
  }
}

export const emptyEvidenceForm = (): EvidenceForm => ({
  kind: 'decision',
  title: '',
  detail: '',
  sourceText: '',
  url: '',
  filePath: '',
  stageId: '',
  agentId: '',
})

export function getActiveMission(missions: Mission[], activeMissionId: string) {
  return missions.find((mission) => mission.id === activeMissionId) ?? missions[0]
}

export function getFilteredMissions(missions: Mission[], filter: MissionStatusFilter) {
  return filter === 'all' ? missions : missions.filter((mission) => mission.status === filter)
}

export function getMissionLaneName(mission: Mission, laneId?: string) {
  if (!laneId) {
    return 'No agent'
  }

  return mission.stages.flatMap((stage) => stage.lanes).find((lane) => lane.id === laneId)?.name ?? 'No agent'
}

export function formatExportTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-')
}
