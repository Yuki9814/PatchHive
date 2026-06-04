import { createSeedMission, missionTemplates } from './templates'
import type { WorkspaceState } from './types'

const STORAGE_KEY = 'patchhive.workspace.v1'
const SCHEMA_VERSION = 1

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
    candidate.settings?.schemaVersion === SCHEMA_VERSION
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

    return {
      ...parsed,
      templates: missionTemplates,
    }
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
