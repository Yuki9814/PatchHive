import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getHandoffBlockers } from './handoff'
import {
  MAX_WORKSPACE_JSON_DEPTH,
  SCHEMA_VERSION,
  WORKSPACE_RECOVERY_FORMAT,
  WORKSPACE_STORAGE_KEY,
  clearWorkspace,
  createDefaultWorkspace,
  loadWorkspace,
  normalizeImportedMission,
  parseWorkspaceImport,
  previewWorkspaceImport,
  saveWorkspace,
  serializeWorkspaceExport,
  serializeWorkspaceRecoveryEnvelope,
} from './storage'

const storageKey = WORKSPACE_STORAGE_KEY
type MutableRecord = Record<string, unknown>

const historicalSchemas = [
  { schemaVersion: 1, revision: 'bfc2e16' },
  { schemaVersion: 2, revision: 'f1c65fb' },
  { schemaVersion: 3, revision: '111ce60' },
  { schemaVersion: 4, revision: '7586ce4' },
  { schemaVersion: 5, revision: '647f8a4' },
  { schemaVersion: 6, revision: '746484c' },
  { schemaVersion: 7, revision: 'f0caa38' },
] as const

function asRecord(value: unknown) {
  return value as MutableRecord
}

function createHistoricalWorkspaceFixture(schemaVersion: number) {
  const fixture = asRecord(
    JSON.parse(serializeWorkspaceExport(createDefaultWorkspace())),
  )
  const settings = asRecord(fixture.settings)
  const mission = asRecord((fixture.missions as unknown[])[0])
  const evidence = asRecord((mission.evidence as unknown[])[0])
  const outputs = asRecord(mission.outputs)
  const importedAt = '2026-07-26T00:00:00.000Z'

  settings.schemaVersion = schemaVersion
  evidence.severity = 'high'
  evidence.triageStatus = 'resolved'
  evidence.resolutionNote = 'Legacy resolution note'
  evidence.provenance = {
    importer: 'agent-hygiene',
    format: 'json',
    sourceName: `schema-v${schemaVersion}.json`,
    toolName: 'agent-hygiene',
    producerStatus: 'declared',
    producerVersion: '0.5.0',
    sourceRevision: '1111111111111111111111111111111111111111',
    scanComplete: true,
    importedAt,
    scopeId: `scope-schema-v${schemaVersion}`,
    ruleId: 'AH002',
    fingerprint: '11111111111111111111',
    findingKey: `finding-schema-v${schemaVersion}`,
    resolution: {
      method: 'complete-rerun',
      format: 'json',
      sourceName: 'clean-rerun.json',
      producerStatus: 'declared',
      producerVersion: '0.5.0',
      sourceRevision: '2222222222222222222222222222222222222222',
      importedAt,
    },
  }

  if (schemaVersion < 2) {
    delete evidence.stageId
  }

  if (schemaVersion < 3) {
    delete settings.mobilePanel
    delete settings.showGuidance
  }

  if (schemaVersion < 5) {
    delete settings.missionStatusFilter
    delete mission.status
    delete evidence.updatedAt
    delete outputs.fieldSources
  }

  if (schemaVersion < 6) {
    delete evidence.severity
    delete evidence.triageStatus
    delete evidence.provenance
  }

  if (schemaVersion < 7) {
    delete evidence.resolutionNote
  }

  if (schemaVersion < 8 && evidence.provenance) {
    const provenance = asRecord(evidence.provenance)
    delete provenance.sourceRevision
    delete provenance.resolution
  }

  return fixture
}

describe('storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('isolates corrupt JSON without changing its original payload', () => {
    const rawPayload = '{broken'
    window.localStorage.setItem(storageKey, rawPayload)

    const loaded = loadWorkspace()

    expect(loaded.status).toBe('corrupt')
    expect('storedRaw' in loaded ? loaded.storedRaw : null).toBe(rawPayload)
    expect(loaded.workspace.missions[0].title).toBe('pypdf XObject guard rescue')
    expect(window.localStorage.getItem(storageKey)).toBe(rawPayload)
  })

  it('treats an empty saved string as corrupt without StrictMode-style overwrite', () => {
    window.localStorage.setItem(storageKey, '')

    const loaded = loadWorkspace()

    expect(loaded.status).toBe('corrupt')
    expect('rawPayload' in loaded ? loaded.rawPayload : null).toBe('')
    expect('storedRaw' in loaded ? loaded.storedRaw : null).toBe('')
    expect(window.localStorage.getItem(storageKey)).toBe('')
  })

  it('fails closed without coercing hostile enum-like objects', () => {
    const poison = { toString: null, valueOf: null }
    const mutators: Array<(workspace: MutableRecord) => void> = [
      (workspace) => {
        const mission = asRecord((workspace.missions as unknown[])[0])
        const stage = asRecord((mission.stages as unknown[])[0])
        const lane = asRecord((stage.lanes as unknown[])[0])
        lane.status = poison
      },
      (workspace) => {
        const mission = asRecord((workspace.missions as unknown[])[0])
        const evidence = asRecord((mission.evidence as unknown[])[0])
        evidence.kind = poison
      },
      (workspace) => {
        const mission = asRecord((workspace.missions as unknown[])[0])
        const evidence = asRecord((mission.evidence as unknown[])[0])
        evidence.severity = poison
      },
      (workspace) => {
        const mission = asRecord((workspace.missions as unknown[])[0])
        const evidence = asRecord((mission.evidence as unknown[])[0])
        evidence.triageStatus = poison
      },
      (workspace) => {
        const mission = asRecord((workspace.missions as unknown[])[0])
        const approval = asRecord((mission.approvals as unknown[])[0])
        approval.riskLevel = poison
      },
      (workspace) => {
        const mission = asRecord((workspace.missions as unknown[])[0])
        const source = asRecord(mission.source)
        source.kind = poison
      },
      (workspace) => {
        const mission = asRecord((workspace.missions as unknown[])[0])
        const evidence = asRecord((mission.evidence as unknown[])[0])
        evidence.provenance = {
          importer: 'agent-hygiene',
          format: poison,
        }
      },
      (workspace) => {
        const mission = asRecord((workspace.missions as unknown[])[0])
        const evidence = asRecord((mission.evidence as unknown[])[0])
        evidence.provenance = {
          importer: 'agent-hygiene',
          format: 'json',
          sourceName: 'scan.json',
          toolName: 'agent-hygiene',
          scanComplete: true,
          importedAt: '2026-07-28T00:00:00.000Z',
          resolution: {
            method: 'complete-rerun',
            format: poison,
          },
        }
      },
    ]

    for (const mutate of mutators) {
      const workspace = asRecord(
        JSON.parse(serializeWorkspaceExport(createDefaultWorkspace())),
      )
      mutate(workspace)
      const rawPayload = JSON.stringify(workspace)
      window.localStorage.setItem(storageKey, rawPayload)

      const loaded = loadWorkspace()

      expect(loaded.status).toBe('corrupt')
      expect('rawPayload' in loaded ? loaded.rawPayload : null).toBe(rawPayload)
    }
  })

  it('rejects excessive JSON nesting before parse while ignoring brackets in strings', () => {
    const deeplyNested = `${'['.repeat(10_000)}0${']'.repeat(10_000)}`
    window.localStorage.setItem(storageKey, deeplyNested)

    const loaded = loadWorkspace()

    expect(loaded.status).toBe('corrupt')
    expect('rawPayload' in loaded ? loaded.rawPayload : null).toBe(deeplyNested)
    expect(() => parseWorkspaceImport(deeplyNested)).toThrow(
      new RegExp(`maximum JSON nesting depth of ${MAX_WORKSPACE_JSON_DEPTH}`, 'i'),
    )

    const boundaryWorkspace = asRecord(
      JSON.parse(serializeWorkspaceExport(createDefaultWorkspace())),
    )
    let boundaryValue: unknown = 'literal [{\\"}] remains string content'

    for (let depth = 1; depth < MAX_WORKSPACE_JSON_DEPTH; depth += 1) {
      boundaryValue = [boundaryValue]
    }

    boundaryWorkspace.depthProbe = boundaryValue
    expect(() =>
      parseWorkspaceImport(JSON.stringify(boundaryWorkspace)),
    ).not.toThrow()
  })

  it('serializes a lossless recovery envelope for every UTF-16 code unit', () => {
    const rawPayload =
      `{"escaped":"quote: \\" slash: \\\\","lone":"${String.fromCharCode(0xd800)}"`
    const serialized = serializeWorkspaceRecoveryEnvelope(rawPayload, 'corrupt')
    const envelope = JSON.parse(serialized)

    expect(envelope).toEqual({
      format: WORKSPACE_RECOVERY_FORMAT,
      storageKey,
      payload: rawPayload,
      reason: 'corrupt',
    })
    expect(envelope.payload.charCodeAt(envelope.payload.length - 2)).toBe(0xd800)
    expect(serialized).toContain('\\ud800')
  })

  it('migrates saved v4 workspaces to schema v8 without dropping missions', () => {
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

    const loaded = loadWorkspace()
    const migrated = loaded.workspace

    expect(loaded.status).toBe('migrated')
    expect('storedRaw' in loaded ? loaded.storedRaw : null).toBe(
      window.localStorage.getItem(storageKey),
    )
    expect(migrated.settings.schemaVersion).toBe(8)
    expect(migrated.settings.missionStatusFilter).toBe('all')
    expect(migrated.settings.mobilePanel).toBe('work')
    expect(migrated.settings.showGuidance).toBe(true)
    expect(migrated.missions[0].title).toBe('Saved user mission')
    expect(migrated.missions[0].status).toBe('active')
    expect(migrated.missions[0].evidence[0].updatedAt).toBeTruthy()
    expect(migrated.missions[0].outputs.fieldSources).toEqual({})
  })

  it('normalizes one legacy mission through the workspace migration path', () => {
    const workspace = createDefaultWorkspace()
    const legacy = JSON.parse(JSON.stringify(workspace.missions[0])) as MutableRecord
    const legacyOutputs = asRecord(legacy.outputs)
    const legacyEvidence = (legacy.evidence as unknown[]).map((item) => {
      const evidence = asRecord(item)
      delete evidence.updatedAt
      return evidence
    })

    delete legacy.status
    delete legacyOutputs.fieldSources
    legacy.evidence = legacyEvidence

    const normalized = normalizeImportedMission(legacy, 4)

    expect(normalized.status).toBe('active')
    expect(normalized.outputs.fieldSources).toEqual({})
    expect(normalized.evidence[0].updatedAt).toBeTruthy()
    expect(() =>
      normalizeImportedMission(
        {
          ...legacy,
          source: {
            ...(legacy.source as MutableRecord),
            rawText: { invalid: true },
          },
        },
        4,
      ),
    ).toThrow(/valid Mission/i)
    expect(() => normalizeImportedMission(legacy, SCHEMA_VERSION + 1)).toThrow(
      /newer than supported/i,
    )
  })

  it('repairs an invalid active mission id and persists schema v8', () => {
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

    const loaded = loadWorkspace()
    const repaired = loaded.workspace

    expect(loaded.status).toBe('migrated')
    if (loaded.status !== 'migrated') {
      throw new Error('Expected migrated workspace')
    }

    const saveResult = saveWorkspace(repaired, {
      status: 'known',
      storedRaw: loaded.storedRaw,
    })

    expect(saveResult.status).toBe('saved')
    expect(repaired.activeMissionId).toBe(repaired.missions[0].id)
    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? '{}').settings.schemaVersion).toBe(8)
  })

  it('classifies missing, valid, and future-schema workspace payloads', () => {
    const missing = loadWorkspace()
    expect(missing.status).toBe('missing')
    expect('storedRaw' in missing ? missing.storedRaw : 'unavailable').toBeNull()

    const currentPayload = `\n${serializeWorkspaceExport(createDefaultWorkspace())}\n`
    window.localStorage.setItem(storageKey, currentPayload)
    const current = loadWorkspace()
    expect(current.status).toBe('valid')
    expect('storedRaw' in current ? current.storedRaw : null).toBe(currentPayload)

    const futurePayload = JSON.stringify({
      ...createDefaultWorkspace(),
      settings: {
        ...createDefaultWorkspace().settings,
        schemaVersion: 9,
      },
    })
    window.localStorage.setItem(storageKey, futurePayload)
    const future = loadWorkspace()

    expect(future.status).toBe('future-schema')
    expect('storedRaw' in future ? future.storedRaw : null).toBe(futurePayload)
    expect(future.workspace.settings.schemaVersion).toBe(8)
    expect(window.localStorage.getItem(storageKey)).toBe(futurePayload)
  })

  it('returns fail-visible results for quota and unavailable storage writes', () => {
    const workspace = createDefaultWorkspace()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    setItem.mockImplementationOnce(() => {
      throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
    })
    expect(saveWorkspace(workspace, { status: 'known', storedRaw: null })).toEqual({
      status: 'quota',
      errorName: 'QuotaExceededError',
      observedRaw: null,
    })

    setItem.mockImplementationOnce(() => {
      throw new DOMException('Storage disabled', 'SecurityError')
    })
    expect(saveWorkspace(workspace, { status: 'known', storedRaw: null })).toEqual({
      status: 'unavailable',
      errorName: 'SecurityError',
      observedRaw: null,
    })
  })

  it.each([
    {
      name: 'expected missing but found a string',
      expectedRaw: null,
      actualRaw: 'external',
    },
    {
      name: 'expected a string but found missing storage',
      expectedRaw: 'last-read',
      actualRaw: null,
    },
    {
      name: 'expected one string but found another',
      expectedRaw: 'last-read',
      actualRaw: 'external',
    },
  ])(
    'does not save when $name',
    ({ expectedRaw, actualRaw }) => {
      if (actualRaw !== null) {
        window.localStorage.setItem(storageKey, actualRaw)
      }
      const setItem = vi.spyOn(Storage.prototype, 'setItem')

      const result = saveWorkspace(createDefaultWorkspace(), {
        status: 'known',
        storedRaw: expectedRaw,
      })

      expect(result).toEqual({
        status: 'conflict',
        actualRaw,
      })
      expect(setItem).not.toHaveBeenCalled()
      expect(window.localStorage.getItem(storageKey)).toBe(actualRaw)
    },
  )

  it('saves only after exact missing or string expectations and returns the new raw', () => {
    const workspace = createDefaultWorkspace()
    const first = saveWorkspace(workspace, {
      status: 'known',
      storedRaw: null,
    })

    expect(first.status).toBe('saved')
    if (first.status !== 'saved') {
      throw new Error('Expected initial save')
    }
    expect(first.storedRaw).toBe(serializeWorkspaceExport(workspace))
    expect(window.localStorage.getItem(storageKey)).toBe(first.storedRaw)

    workspace.settings.showGuidance = false
    const second = saveWorkspace(workspace, {
      status: 'known',
      storedRaw: first.storedRaw,
    })

    expect(second.status).toBe('saved')
    expect(window.localStorage.getItem(storageKey)).toContain(
      '"showGuidance": false',
    )
  })

  it('allows an explicit unknown expectation to overwrite without a readable baseline', () => {
    window.localStorage.setItem(storageKey, 'unreadable baseline')
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage disabled', 'SecurityError')
    })

    const result = saveWorkspace(createDefaultWorkspace(), {
      status: 'unknown',
    })

    expect(result.status).toBe('saved')
    expect(getItem).not.toHaveBeenCalled()
    getItem.mockRestore()
    expect(window.localStorage.getItem(storageKey)).toContain(
      '"schemaVersion": 8',
    )
  })

  it('keeps the last exact expectation after quota failure so retry detects a conflict', () => {
    const workspace = createDefaultWorkspace()
    const originalRaw = serializeWorkspaceExport(workspace)
    window.localStorage.setItem(storageKey, originalRaw)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    setItem.mockImplementationOnce(() => {
      throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
    })
    const failed = saveWorkspace(workspace, {
      status: 'known',
      storedRaw: originalRaw,
    })
    expect(failed).toEqual({
      status: 'quota',
      errorName: 'QuotaExceededError',
      observedRaw: originalRaw,
    })

    window.localStorage.setItem(storageKey, 'external after quota')
    setItem.mockClear()
    const retried = saveWorkspace(workspace, {
      status: 'known',
      storedRaw: originalRaw,
    })

    expect(retried).toEqual({
      status: 'conflict',
      actualRaw: 'external after quota',
    })
    expect(setItem).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(storageKey)).toBe('external after quota')
  })

  it('removes storage only when the exact raw still matches', () => {
    window.localStorage.setItem(storageKey, 'isolated')
    expect(clearWorkspace('isolated')).toEqual({
      status: 'saved',
      storedRaw: null,
    })
    expect(window.localStorage.getItem(storageKey)).toBeNull()

    window.localStorage.setItem(storageKey, 'newer')
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem')
    expect(clearWorkspace('isolated')).toEqual({
      status: 'conflict',
      actualRaw: 'newer',
    })
    expect(removeItem).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(storageKey)).toBe('newer')

    window.localStorage.removeItem(storageKey)
    removeItem.mockClear()
    expect(clearWorkspace('isolated')).toEqual({
      status: 'conflict',
      actualRaw: null,
    })
    expect(removeItem).not.toHaveBeenCalled()
  })

  it('returns unavailable without removing when compare-before-remove cannot read', () => {
    window.localStorage.setItem(storageKey, 'isolated')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
      throw new DOMException('Storage disabled', 'SecurityError')
    })
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem')

    expect(clearWorkspace('isolated')).toEqual({
      status: 'unavailable',
      errorName: 'SecurityError',
    })
    expect(removeItem).not.toHaveBeenCalled()
  })

  it('returns unavailable when the browser denies storage reads', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
      throw new DOMException('Storage disabled', 'SecurityError')
    })

    const loaded = loadWorkspace()

    expect(loaded.status).toBe('unavailable')
    expect(loaded.workspace.missions).toHaveLength(1)
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

    expect(imported.settings.schemaVersion).toBe(8)
    expect(imported.missions[0].title).toBe(workspace.missions[0].title)
  })

  it('previews workspace imports before replacement', () => {
    const preview = previewWorkspaceImport(serializeWorkspaceExport(createDefaultWorkspace()))

    expect(preview.schemaVersion).toBe(8)
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

  it('rejects malformed nested mission data before it reaches the reducer', () => {
    const workspace = createDefaultWorkspace()
    const malformed = {
      ...workspace,
      missions: [
        {
          ...workspace.missions[0],
          stages: [
            {
              ...workspace.missions[0].stages[0],
              lanes: [{ ...workspace.missions[0].stages[0].lanes[0], confidence: 'high' }],
            },
          ],
        },
      ],
    }

    expect(() => parseWorkspaceImport(JSON.stringify(malformed))).toThrow(/not a PatchHive workspace/i)
  })

  it('rejects future workspace schemas instead of guessing a downgrade', () => {
    const workspace = createDefaultWorkspace()

    expect(() =>
      parseWorkspaceImport(
        JSON.stringify({
          ...workspace,
          settings: {
            ...workspace.settings,
            schemaVersion: 9,
          },
        }),
      ),
    ).toThrow(/newer than supported schema 8/i)
  })

  it('migrates v5 scanner provenance to an open triage state', () => {
    const workspace = createDefaultWorkspace()
    const mission = workspace.missions[0]
    const importedAt = '2026-07-26T00:00:00.000Z'
    const legacyEvidence = {
      ...mission.evidence[0],
      filePath: '/Users/private/repository/AGENTS.md:4',
      triageStatus: undefined,
      provenance: {
        importer: 'agent-hygiene' as const,
        format: 'json' as const,
        sourceName: 'scan.json',
        toolName: 'agent-hygiene' as const,
        scanComplete: true,
        importedAt,
        ruleId: 'AH001',
        scanRoot: '/Users/private/repository',
      },
    }
    const migrated = parseWorkspaceImport(
      JSON.stringify({
        ...workspace,
        missions: [{ ...mission, evidence: [legacyEvidence] }],
        settings: { ...workspace.settings, schemaVersion: 5 },
      }),
    )

    expect(migrated.settings.schemaVersion).toBe(8)
    expect(migrated.missions[0].evidence[0].triageStatus).toBe('open')
    expect(migrated.missions[0].evidence[0].provenance?.sourceName).toBe('scan.json')
    expect(migrated.missions[0].evidence[0].provenance?.scanRoot).toBeUndefined()
    expect(migrated.missions[0].evidence[0].filePath).toBeUndefined()
    expect(migrated.missions[0].evidence[0].provenance?.producerStatus).toBe('unverified')
    expect(migrated.missions[0].evidence[0].provenance?.scopeId).toMatch(/^scope-/)
  })

  it.each(historicalSchemas)(
    'migrates the schema v$schemaVersion storage shape from $revision with safe defaults',
    ({ schemaVersion }) => {
      const fixture = createHistoricalWorkspaceFixture(schemaVersion)
      const imported = parseWorkspaceImport(JSON.stringify(fixture))
      const evidence = imported.missions[0].evidence[0]

      expect(imported.settings).toMatchObject({
        schemaVersion: 8,
        density: 'compact',
        missionStatusFilter: 'all',
        mobilePanel: 'work',
        showGuidance: true,
      })
      expect(imported.missions[0].status).toBe('active')
      expect(imported.missions[0].outputs.fieldSources).toEqual({})
      expect(evidence.updatedAt).toBeTruthy()
      expect(evidence.stageId).toBe(imported.missions[0].activeStageId)

      if (schemaVersion < 6) {
        expect(evidence.provenance).toBeUndefined()
        expect(evidence.triageStatus).toBeUndefined()
      } else {
        expect(evidence.provenance?.sourceName).toBe(
          `schema-v${schemaVersion}.json`,
        )
        expect(evidence.provenance?.sourceRevision).toBeUndefined()
        expect(evidence.provenance?.resolution).toBeUndefined()
        expect(evidence.triageStatus).toBe('open')
        expect(evidence.resolutionNote).toBeUndefined()
      }
    },
  )

  it('keeps a v6 accepted scanner risk but blocks handoff until it has a note', () => {
    const workspace = createDefaultWorkspace()
    const mission = workspace.missions[0]
    const importedAt = '2026-07-26T00:00:00.000Z'
    const acceptedWithoutNote = {
      ...mission.evidence[0],
      id: 'accepted-without-note',
      severity: 'high' as const,
      triageStatus: 'accepted' as const,
      resolutionNote: undefined,
      provenance: {
        importer: 'agent-hygiene' as const,
        format: 'json' as const,
        sourceName: 'schema-v6.json',
        toolName: 'agent-hygiene' as const,
        producerStatus: 'declared' as const,
        producerVersion: '0.3.0',
        scanComplete: true,
        importedAt,
        scopeId: 'scope-schema-v6',
        ruleId: 'AH003',
        fingerprint: '11111111111111111111',
        findingKey: 'finding-schema-v6',
      },
    }
    const migrated = parseWorkspaceImport(
      JSON.stringify({
        ...workspace,
        missions: [{ ...mission, evidence: [acceptedWithoutNote] }],
        settings: { ...workspace.settings, schemaVersion: 6 },
      }),
    )
    const accepted = migrated.missions[0].evidence[0]

    expect(migrated.settings.schemaVersion).toBe(8)
    expect(accepted.triageStatus).toBe('accepted')
    expect(accepted.resolutionNote).toBeUndefined()
    expect(getHandoffBlockers(migrated.missions[0])).toContain(
      '1 accepted scanner risk(s) need a non-empty resolution note',
    )
  })

  it('reopens legacy resolved scanner risks without complete-rerun provenance', () => {
    const workspace = createDefaultWorkspace()
    const mission = workspace.missions[0]
    const importedAt = '2026-07-26T00:00:00.000Z'
    const legacyResolved = {
      ...mission.evidence[0],
      severity: 'high' as const,
      triageStatus: 'resolved' as const,
      provenance: {
        importer: 'agent-hygiene' as const,
        format: 'json' as const,
        sourceName: 'legacy-resolution.json',
        toolName: 'agent-hygiene' as const,
        producerStatus: 'declared' as const,
        producerVersion: '0.4.1',
        sourceRevision: '1111111111111111111111111111111111111111',
        scanComplete: true,
        importedAt,
        scopeId: 'scope-legacy-resolution',
        ruleId: 'AH002',
        fingerprint: '11111111111111111111',
        findingKey: 'finding-legacy-resolution',
      },
    }
    const migrated = parseWorkspaceImport(
      JSON.stringify({
        ...workspace,
        missions: [{ ...mission, evidence: [legacyResolved] }],
        settings: { ...workspace.settings, schemaVersion: 7 },
      }),
    )

    expect(migrated.missions[0].evidence[0].triageStatus).toBe('open')
    expect(migrated.missions[0].evidence[0].provenance?.resolution).toBeUndefined()
  })

  it('preserves a resolved scanner finding only with complete-rerun provenance', () => {
    const workspace = createDefaultWorkspace()
    const mission = workspace.missions[0]
    const importedAt = '2026-07-27T00:00:00.000Z'
    const rerunResolved = {
      ...mission.evidence[0],
      severity: 'high' as const,
      triageStatus: 'resolved' as const,
      provenance: {
        importer: 'agent-hygiene' as const,
        format: 'json' as const,
        sourceName: 'findings.json',
        toolName: 'agent-hygiene' as const,
        producerStatus: 'declared' as const,
        producerVersion: '0.5.0',
        sourceRevision: '1111111111111111111111111111111111111111',
        scanComplete: true,
        importedAt,
        scopeId: 'scope-complete-rerun',
        ruleId: 'AH002',
        fingerprint: '11111111111111111111',
        findingKey: 'finding-complete-rerun',
        resolution: {
          method: 'complete-rerun' as const,
          format: 'json' as const,
          sourceName: 'clean-rerun.json',
          producerStatus: 'declared' as const,
          producerVersion: '0.5.0',
          sourceRevision: '2222222222222222222222222222222222222222',
          importedAt,
        },
      },
    }
    const imported = parseWorkspaceImport(
      JSON.stringify({
        ...workspace,
        missions: [{ ...mission, evidence: [rerunResolved] }],
      }),
    )

    expect(imported.missions[0].evidence[0].triageStatus).toBe('resolved')
    expect(imported.missions[0].evidence[0].provenance?.resolution?.method).toBe(
      'complete-rerun',
    )
  })

  it('forces incomplete imported provenance back to open triage', () => {
    const workspace = createDefaultWorkspace()
    const mission = workspace.missions[0]
    const importedAt = '2026-07-26T00:00:00.000Z'
    const forgedResolvedSummary = {
      ...mission.evidence[0],
      severity: 'high' as const,
      triageStatus: 'resolved' as const,
      provenance: {
        importer: 'agent-hygiene' as const,
        format: 'json' as const,
        sourceName: 'incomplete.json',
        toolName: 'agent-hygiene' as const,
        producerStatus: 'declared' as const,
        scanComplete: false,
        importedAt,
        scopeId: 'scope-incomplete',
        ruleId: 'scan/summary',
      },
    }
    const imported = parseWorkspaceImport(
      JSON.stringify({
        ...workspace,
        missions: [{ ...mission, evidence: [forgedResolvedSummary] }],
      }),
    )

    expect(imported.missions[0].evidence[0].triageStatus).toBe('open')
  })

  it('repairs active-stage and evidence references while removing dangling assignments', () => {
    const workspace = createDefaultWorkspace()
    const mission = workspace.missions[0]
    const imported = parseWorkspaceImport(
      JSON.stringify({
        ...workspace,
        missions: [
          {
            ...mission,
            activeStageId: 'ghost-stage',
            evidence: mission.evidence.map((evidence, index) =>
              index === 0
                ? {
                    ...evidence,
                    stageId: 'ghost-stage',
                    agentId: 'ghost-agent',
                  }
                : evidence,
            ),
            stages: mission.stages.map((stage, stageIndex) =>
              stageIndex === 0
                ? {
                    ...stage,
                    lanes: stage.lanes.map((lane, laneIndex) =>
                      laneIndex === 0
                        ? { ...lane, assignedEvidenceIds: ['ghost-evidence'] }
                        : lane,
                    ),
                  }
                : stage,
            ),
          },
        ],
      }),
    )
    const repaired = imported.missions[0]

    expect(repaired.activeStageId).toBe(repaired.stages[0].id)
    expect(repaired.evidence[0].stageId).toBeUndefined()
    expect(repaired.evidence[0].agentId).toBeUndefined()
    expect(repaired.stages[0].lanes[0].assignedEvidenceIds).toEqual([])
  })

  it('rejects duplicate mission, stage, evidence, lane, approval, and finding ids', () => {
    const workspace = createDefaultWorkspace()
    const mission = workspace.missions[0]
    const duplicateCases = [
      { ...workspace, missions: [mission, mission] },
      {
        ...workspace,
        missions: [{ ...mission, stages: [mission.stages[0], mission.stages[0]] }],
      },
      {
        ...workspace,
        missions: [{ ...mission, evidence: [mission.evidence[0], mission.evidence[0]] }],
      },
      {
        ...workspace,
        missions: [
          {
            ...mission,
            stages: [
              {
                ...mission.stages[0],
                lanes: [mission.stages[0].lanes[0], mission.stages[0].lanes[0]],
              },
              ...mission.stages.slice(1),
            ],
          },
        ],
      },
      {
        ...workspace,
        missions: [{ ...mission, approvals: [mission.approvals[0], mission.approvals[0]] }],
      },
      {
        ...workspace,
        missions: [
          {
            ...mission,
            stages: [
              {
                ...mission.stages[0],
                lanes: [
                  {
                    ...mission.stages[0].lanes[0],
                    findings: [
                      mission.stages[0].lanes[0].findings[0],
                      mission.stages[0].lanes[0].findings[0],
                    ],
                  },
                  ...mission.stages[0].lanes.slice(1),
                ],
              },
              ...mission.stages.slice(1),
            ],
          },
        ],
      },
    ]

    duplicateCases.forEach((candidate) => {
      expect(() => parseWorkspaceImport(JSON.stringify(candidate))).toThrow(
        /not a PatchHive workspace/i,
      )
    })
  })
})
