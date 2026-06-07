import { beforeEach, describe, expect, it } from 'vitest'
import { createDefaultWorkspace, loadWorkspace, saveWorkspace } from './storage'

const storageKey = 'patchhive.workspace.v1'

describe('storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('falls back to default workspace when saved JSON is corrupt', () => {
    window.localStorage.setItem(storageKey, '{broken')

    expect(loadWorkspace().missions[0].title).toBe('pypdf XObject guard rescue')
  })

  it('migrates saved v1 workspaces to schema v2 without dropping missions', () => {
    const workspace = createDefaultWorkspace()
    const savedMission = {
      ...workspace.missions[0],
      title: 'Saved user mission',
      evidence: workspace.missions[0].evidence.map((item) => {
        const migratedItem = { ...item }
        delete migratedItem.stageId
        return migratedItem
      }),
    }

    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        ...workspace,
        missions: [savedMission],
        activeMissionId: savedMission.id,
        settings: {
          ...workspace.settings,
          schemaVersion: 1,
        },
      }),
    )

    const migrated = loadWorkspace()

    expect(migrated.settings.schemaVersion).toBe(2)
    expect(migrated.missions[0].title).toBe('Saved user mission')
    expect(migrated.missions[0].evidence[0].stageId).toBe(migrated.missions[0].activeStageId)
  })

  it('repairs an invalid active mission id and persists schema v2', () => {
    const workspace = createDefaultWorkspace()
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        ...workspace,
        activeMissionId: 'missing',
        settings: {
          ...workspace.settings,
          schemaVersion: 1,
        },
      }),
    )

    const repaired = loadWorkspace()
    saveWorkspace(repaired)

    expect(repaired.activeMissionId).toBe(repaired.missions[0].id)
    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? '{}').settings.schemaVersion).toBe(2)
  })
})
