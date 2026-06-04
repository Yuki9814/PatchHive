export type MissionSourceKind = 'github-url' | 'manual' | 'diff-paste' | 'log-paste'

export type AgentStatus = 'idle' | 'scanning' | 'drafting' | 'waiting' | 'ready' | 'blocked'

export type EvidenceKind = 'file' | 'log' | 'decision' | 'link' | 'diff'

export type RiskLevel = 'low' | 'medium' | 'high'

export type MissionSource = {
  kind: MissionSourceKind
  url?: string
  rawText?: string
  parsedRepo?: string
  parsedNumber?: string
}

export type AgentFinding = {
  id: string
  text: string
  createdAt: string
}

export type AgentLane = {
  id: string
  name: string
  role: string
  status: AgentStatus
  confidence: number
  findings: AgentFinding[]
  assignedEvidenceIds: string[]
  outputDraft: string
}

export type EvidenceItem = {
  id: string
  kind: EvidenceKind
  title: string
  detail: string
  sourceText?: string
  url?: string
  filePath?: string
  agentId?: string
  createdAt: string
}

export type ApprovalGate = {
  id: string
  label: string
  riskLevel: RiskLevel
  requiredBefore: string
  approved: boolean
  approvedAt?: string
}

export type HandoffDraft = {
  summary: string
  patchPlan: string
  testPlan: string
  risks: string
  maintainerComment: string
  ready: boolean
}

export type MissionStage = {
  id: string
  name: string
  summary: string
  nextAction: string
  lanes: AgentLane[]
}

export type Mission = {
  id: string
  templateId: string
  title: string
  source: MissionSource
  repo: string
  branch: string
  goal: string
  constraints: string[]
  stages: MissionStage[]
  activeStageId: string
  evidence: EvidenceItem[]
  approvals: ApprovalGate[]
  outputs: HandoffDraft
  createdAt: string
  updatedAt: string
}

export type MissionTemplate = {
  id: string
  name: string
  description: string
  defaultGoal: string
  defaultConstraints: string[]
  stageBlueprints: Array<Pick<MissionStage, 'id' | 'name' | 'summary' | 'nextAction'>>
  approvalBlueprints: Array<Pick<ApprovalGate, 'id' | 'label' | 'riskLevel' | 'requiredBefore'>>
}

export type WorkspaceSettings = {
  schemaVersion: number
  density: 'comfortable' | 'compact'
}

export type WorkspaceState = {
  missions: Mission[]
  activeMissionId: string
  templates: MissionTemplate[]
  settings: WorkspaceSettings
}

export type ComposerInput = {
  templateId: string
  title: string
  sourceKind: MissionSourceKind
  sourceText: string
  goal: string
  branch: string
  constraints: string
}
