import { createSeedMission, missionTemplates } from './templates'
import type { HandoffFieldSources, MissionStatus, MissionStatusFilter, WorkspaceState } from './types'

const STORAGE_KEY = 'patchhive.workspace.v1'
export const SCHEMA_VERSION = 5
export const MAX_WORKSPACE_IMPORT_BYTES = 1_000_000

export type WorkspaceImportPreview = {
  workspace: WorkspaceState
  missionCount: number
  evidenceCount: number
  archivedCount: number
  schemaVersion: number
  warnings: string[]
}

export function createDefaultWorkspace(): WorkspaceState {
  const seedMission = createSeedMission()

  return {
    missions: [seedMission],
    activeMissionId: seedMission.id,
    templates: missionTemplates,
    settings: {
      schemaVersion: SCHEMA_VERSION,
      density: 'compact',
      missionStatusFilter: 'all',
      mobilePanel: 'work',
      showGuidance: true,
    },
  }
}

function isMissionStatus(value: unknown): value is MissionStatus {
  return value === 'active' || value === 'ready' || value === 'archived'
}

function isMissionStatusFilter(value: unknown): value is MissionStatusFilter {
  return value === 'all' || isMissionStatus(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isLane(value: unknown) {
  if (!isRecord(value)) return false

  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.role === 'string' &&
    ['idle', 'scanning', 'drafting', 'waiting', 'ready', 'blocked'].includes(String(value.status)) &&
    typeof value.confidence === 'number' &&
    Array.isArray(value.findings) &&
    value.findings.every(
      (finding) =>
        isRecord(finding) &&
        typeof finding.id === 'string' &&
        typeof finding.text === 'string' &&
        typeof finding.createdAt === 'string',
    ) &&
    isStringArray(value.assignedEvidenceIds) &&
    typeof value.outputDraft === 'string'
  )
}

function isStage(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.summary === 'string' &&
    typeof value.nextAction === 'string' &&
    Array.isArray(value.lanes) &&
    value.lanes.every(isLane)
  )
}

function isEvidence(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    ['file', 'log', 'decision', 'link', 'diff'].includes(String(value.kind)) &&
    typeof value.title === 'string' &&
    typeof value.detail === 'string' &&
    typeof value.createdAt === 'string' &&
    (value.updatedAt === undefined || typeof value.updatedAt === 'string') &&
    (value.stageId === undefined || typeof value.stageId === 'string') &&
    (value.agentId === undefined || typeof value.agentId === 'string')
  )
}

function isApproval(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    ['low', 'medium', 'high'].includes(String(value.riskLevel)) &&
    typeof value.requiredBefore === 'string' &&
    typeof value.approved === 'boolean' &&
    (value.approvedAt === undefined || typeof value.approvedAt === 'string')
  )
}

function isOutputs(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.summary === 'string' &&
    typeof value.patchPlan === 'string' &&
    typeof value.testPlan === 'string' &&
    typeof value.risks === 'string' &&
    typeof value.maintainerComment === 'string' &&
    typeof value.ready === 'boolean' &&
    (value.fieldSources === undefined ||
      (isRecord(value.fieldSources) && Object.values(value.fieldSources).every(isStringArray)))
  )
}

function isMission(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.templateId === 'string' &&
    (value.status === undefined || isMissionStatus(value.status)) &&
    typeof value.title === 'string' &&
    isRecord(value.source) &&
    ['github-url', 'manual', 'diff-paste', 'log-paste'].includes(String(value.source.kind)) &&
    typeof value.repo === 'string' &&
    typeof value.branch === 'string' &&
    typeof value.goal === 'string' &&
    isStringArray(value.constraints) &&
    Array.isArray(value.stages) &&
    value.stages.length > 0 &&
    value.stages.every(isStage) &&
    typeof value.activeStageId === 'string' &&
    Array.isArray(value.evidence) &&
    value.evidence.every(isEvidence) &&
    Array.isArray(value.approvals) &&
    value.approvals.every(isApproval) &&
    isOutputs(value.outputs) &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  )
}

function isWorkspace(value: unknown): value is WorkspaceState {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as WorkspaceState
  return (
    Array.isArray(candidate.missions) &&
    candidate.missions.every(isMission) &&
    typeof candidate.activeMissionId === 'string' &&
    typeof candidate.settings?.schemaVersion === 'number'
  )
}

function migrateWorkspace(candidate: WorkspaceState): WorkspaceState {
  const activeMissionId = candidate.missions.some((mission) => mission.id === candidate.activeMissionId)
    ? candidate.activeMissionId
    : candidate.missions[0]?.id
  const defaultWorkspace = createDefaultWorkspace()
  const legacyEvidenceStageMigration = candidate.settings.schemaVersion < 4

  if (!activeMissionId) {
    return defaultWorkspace
  }

  return {
    ...candidate,
    activeMissionId,
    templates: missionTemplates,
    missions: candidate.missions.map((mission) => {
      const evidenceIds = new Set((mission.evidence ?? []).map((item) => item.id))
      const normalizeSources = (fieldSources?: HandoffFieldSources): HandoffFieldSources =>
        Object.fromEntries(
          Object.entries(fieldSources ?? {}).map(([field, ids]) => [
            field,
            Array.isArray(ids) ? ids.filter((id) => evidenceIds.has(id)) : [],
          ]),
        ) as HandoffFieldSources

      return {
        ...mission,
        status: isMissionStatus(mission.status) ? mission.status : 'active',
        evidence: (mission.evidence ?? []).map((item) => ({
          ...item,
          stageId: item.stageId || (legacyEvidenceStageMigration ? mission.activeStageId : undefined),
          agentId: item.agentId || undefined,
          updatedAt: item.updatedAt ?? item.createdAt ?? new Date().toISOString(),
        })),
        outputs: {
          summary: mission.outputs?.summary ?? mission.goal ?? '',
          patchPlan: mission.outputs?.patchPlan ?? '',
          testPlan: mission.outputs?.testPlan ?? '',
          risks: mission.outputs?.risks ?? 'Risk review pending.',
          maintainerComment: mission.outputs?.maintainerComment ?? '',
          fieldSources: normalizeSources(mission.outputs?.fieldSources),
          ready: mission.outputs?.ready ?? false,
        },
      }
    }),
    settings: {
      ...candidate.settings,
      schemaVersion: SCHEMA_VERSION,
      density: candidate.settings?.density ?? defaultWorkspace.settings.density,
      missionStatusFilter: isMissionStatusFilter(candidate.settings?.missionStatusFilter)
        ? candidate.settings.missionStatusFilter
        : defaultWorkspace.settings.missionStatusFilter,
      mobilePanel: candidate.settings?.mobilePanel ?? defaultWorkspace.settings.mobilePanel,
      showGuidance: candidate.settings?.showGuidance ?? defaultWorkspace.settings.showGuidance,
    },
  }
}

export function parseWorkspaceImport(rawJson: string): WorkspaceState {
  if (new Blob([rawJson]).size > MAX_WORKSPACE_IMPORT_BYTES) {
    throw new Error('Workspace import is too large for local preview.')
  }

  const parsed = JSON.parse(rawJson)

  if (!isWorkspace(parsed)) {
    throw new Error('Imported file is not a PatchHive workspace.')
  }

  return migrateWorkspace(parsed)
}

export function previewWorkspaceImport(rawJson: string): WorkspaceImportPreview {
  const workspace = parseWorkspaceImport(rawJson)
  const missionCount = workspace.missions.length
  const evidenceCount = workspace.missions.reduce((count, mission) => count + mission.evidence.length, 0)
  const archivedCount = workspace.missions.filter((mission) => mission.status === 'archived').length
  const warnings = [
    missionCount === 0 ? 'No missions were found in this workspace.' : '',
    evidenceCount === 0 ? 'No evidence records were found in this workspace.' : '',
  ].filter(Boolean)

  return {
    workspace,
    missionCount,
    evidenceCount,
    archivedCount,
    schemaVersion: workspace.settings.schemaVersion,
    warnings,
  }
}

export function serializeWorkspaceExport(state: WorkspaceState) {
  return JSON.stringify(
    {
      ...state,
      templates: missionTemplates,
      settings: {
        ...state.settings,
        schemaVersion: SCHEMA_VERSION,
      },
    },
    null,
    2,
  )
}

export function loadWorkspace(): WorkspaceState {
  if (typeof window === 'undefined') {
    return createDefaultWorkspace()
  }

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)

    if (!saved) {
      return createDefaultWorkspace()
    }

    const parsed = JSON.parse(saved)

    if (!isWorkspace(parsed)) {
      return createDefaultWorkspace()
    }

    return migrateWorkspace(parsed)
  } catch {
    return createDefaultWorkspace()
  }
}

export function saveWorkspace(state: WorkspaceState) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(
    STORAGE_KEY,
    serializeWorkspaceExport(state),
  )
}

export function clearWorkspace() {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.removeItem(STORAGE_KEY)
}
