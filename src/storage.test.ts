import { beforeEach, describe, expect, it } from 'vitest'
import {
  createDefaultWorkspace,
  loadWorkspace,
  parseWorkspaceImport,
  previewWorkspaceImport,
  saveWorkspace,
  serializeWorkspaceExport,
} from './storage'

const storageKey = 'patchhive.workspace.v1'

describe('storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('falls back to default workspace when saved JSON is corrupt', () => {
    window.localStorage.setItem(storageKey, '{broken')

    expect(loadWorkspace().missions[0].title).toBe('pypdf XObject guard rescue')
  })

  it('migrates saved v4 workspaces to schema v5 without dropping missions', () => {
    const workspace = createDefaultWorkspace()
    const savedMission = {
      ...workspace.missions[0],
      title: 'Saved user mission',
      status: undefined,
      evidence: workspace.missions[0].evidence.map((item) => {
        const migratedItem = { ...item } as Partial<typeof item>
        delete migratedItem.stageId
        delete migratedItem.updatedAt
        return migratedItem
      }),
      outputs: {
        ...workspace.missions[0].outputs,
        fieldSources: undefined,
      },
    }

    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        ...workspace,
        missions: [savedMission],
        activeMissionId: savedMission.id,
        settings: {
          ...workspace.settings,
          schemaVersion: 4,
          missionStatusFilter: undefined,
        },
      }),
    )

    const migrated = loadWorkspace()

    expect(migrated.settings.schemaVersion).toBe(5)
    expect(migrated.settings.missionStatusFilter).toBe('all')
    expect(migrated.settings.mobilePanel).toBe('work')
    expect(migrated.settings.showGuidance).toBe(true)
    expect(migrated.missions[0].title).toBe('Saved user mission')
    expect(migrated.missions[0].status).toBe('active')
    expect(migrated.missions[0].evidence[0].updatedAt).toBeTruthy()
    expect(migrated.missions[0].outputs.fieldSources).toEqual({})
  })

  it('repairs an invalid active mission id and persists schema v4', () => {
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
    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? '{}').settings.schemaVersion).toBe(5)
  })

  it('serializes and parses workspace JSON imports through the current migration path', () => {
    const workspace = createDefaultWorkspace()
    const exported = serializeWorkspaceExport({
      ...workspace,
      settings: {
        ...workspace.settings,
        schemaVersion: 1,
      },
    })
    const imported = parseWorkspaceImport(exported)

    expect(imported.settings.schemaVersion).toBe(5)
    expect(imported.missions[0].title).toBe(workspace.missions[0].title)
  })

  it('previews workspace imports before replacement', () => {
    const preview = previewWorkspaceImport(serializeWorkspaceExport(createDefaultWorkspace()))

    expect(preview.schemaVersion).toBe(5)
    expect(preview.missionCount).toBe(1)
    expect(preview.evidenceCount).toBeGreaterThan(0)
    expect(preview.archivedCount).toBe(0)
  })

  it('rejects partial workspace imports before replacing current data', () => {
    expect(() =>
      parseWorkspaceImport(
        JSON.stringify({
          missions: [{ id: 'mission-1', title: 'Incomplete mission' }],
          activeMissionId: 'mission-1',
          settings: { schemaVersion: 4 },
        }),
      ),
    ).toThrow(/not a PatchHive workspace/i)
  })

  it('rejects JSON imports that are not PatchHive workspaces', () => {
    expect(() => parseWorkspaceImport('{"missions":"nope"}')).toThrow(/not a PatchHive workspace/i)
  })
})
