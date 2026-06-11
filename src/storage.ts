import { createSeedMission, missionTemplates } from './templates'
import type { HandoffFieldSources, MissionStatus, MissionStatusFilter, WorkspaceState } from './types'

const STORAGE_KEY = 'patchhive.workspace.v1'
const SCHEMA_VERSION = 5
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

function isWorkspace(value: unknown): value is WorkspaceState {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as WorkspaceState
  return (
    Array.isArray(candidate.missions) &&
    candidate.missions.every(
      (mission) =>
        mission &&
        typeof mission === 'object' &&
        typeof mission.id === 'string' &&
        typeof mission.title === 'string' &&
        Array.isArray(mission.stages) &&
        Array.isArray(mission.evidence) &&
        Array.isArray(mission.approvals),
    ) &&
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
