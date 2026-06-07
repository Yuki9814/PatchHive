import { createSeedMission, missionTemplates } from './templates'
import type { WorkspaceState } from './types'

const STORAGE_KEY = 'patchhive.workspace.v1'
const SCHEMA_VERSION = 2

export function createDefaultWorkspace(): WorkspaceState {
  const seedMission = createSeedMission()

  return {
    missions: [seedMission],
    activeMissionId: seedMission.id,
    templates: missionTemplates,
    settings: {
      schemaVersion: SCHEMA_VERSION,
      density: 'compact',
    },
  }
}

function isWorkspace(value: unknown): value is WorkspaceState {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as WorkspaceState
  return (
    Array.isArray(candidate.missions) &&
    typeof candidate.activeMissionId === 'string' &&
    typeof candidate.settings?.schemaVersion === 'number'
  )
}

function migrateWorkspace(candidate: WorkspaceState): WorkspaceState {
  const activeMissionId = candidate.missions.some((mission) => mission.id === candidate.activeMissionId)
    ? candidate.activeMissionId
    : candidate.missions[0]?.id
  const defaultWorkspace = createDefaultWorkspace()

  if (!activeMissionId) {
    return defaultWorkspace
  }

  return {
    ...candidate,
    activeMissionId,
    templates: missionTemplates,
    missions: candidate.missions.map((mission) => ({
      ...mission,
      evidence: (mission.evidence ?? []).map((item) => ({
        ...item,
        stageId: item.stageId ?? mission.activeStageId,
      })),
      outputs: {
        summary: mission.outputs?.summary ?? mission.goal ?? '',
        patchPlan: mission.outputs?.patchPlan ?? '',
        testPlan: mission.outputs?.testPlan ?? '',
        risks: mission.outputs?.risks ?? 'Risk review pending.',
        maintainerComment: mission.outputs?.maintainerComment ?? '',
        ready: mission.outputs?.ready ?? false,
      },
    })),
    settings: {
      ...candidate.settings,
      schemaVersion: SCHEMA_VERSION,
    },
  }
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
    JSON.stringify({
      ...state,
      templates: missionTemplates,
      settings: {
        ...state.settings,
        schemaVersion: SCHEMA_VERSION,
      },
    }),
  )
}

export function clearWorkspace() {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.removeItem(STORAGE_KEY)
}
