import { beforeEach, describe, expect, it } from 'vitest'
import { getHandoffBlockers } from './handoff'
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

  it('migrates saved v4 workspaces to schema v7 without dropping missions', () => {
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

    expect(migrated.settings.schemaVersion).toBe(7)
    expect(migrated.settings.missionStatusFilter).toBe('all')
    expect(migrated.settings.mobilePanel).toBe('work')
    expect(migrated.settings.showGuidance).toBe(true)
    expect(migrated.missions[0].title).toBe('Saved user mission')
    expect(migrated.missions[0].status).toBe('active')
    expect(migrated.missions[0].evidence[0].updatedAt).toBeTruthy()
    expect(migrated.missions[0].outputs.fieldSources).toEqual({})
  })

  it('repairs an invalid active mission id and persists schema v7', () => {
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
    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? '{}').settings.schemaVersion).toBe(7)
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

    expect(imported.settings.schemaVersion).toBe(7)
    expect(imported.missions[0].title).toBe(workspace.missions[0].title)
  })

  it('previews workspace imports before replacement', () => {
    const preview = previewWorkspaceImport(serializeWorkspaceExport(createDefaultWorkspace()))

    expect(preview.schemaVersion).toBe(7)
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
            schemaVersion: 8,
          },
        }),
      ),
    ).toThrow(/newer than supported schema 7/i)
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

    expect(migrated.settings.schemaVersion).toBe(7)
    expect(migrated.missions[0].evidence[0].triageStatus).toBe('open')
    expect(migrated.missions[0].evidence[0].provenance?.sourceName).toBe('scan.json')
    expect(migrated.missions[0].evidence[0].provenance?.scanRoot).toBeUndefined()
    expect(migrated.missions[0].evidence[0].filePath).toBeUndefined()
    expect(migrated.missions[0].evidence[0].provenance?.producerStatus).toBe('unverified')
    expect(migrated.missions[0].evidence[0].provenance?.scopeId).toMatch(/^scope-/)
  })

  it.each([1, 2, 3, 4, 5, 6])(
    'imports schema v%i through the schema v7 migration path',
    (schemaVersion) => {
      const workspace = createDefaultWorkspace()
      const imported = parseWorkspaceImport(
        JSON.stringify({
          ...workspace,
          settings: {
            ...workspace.settings,
            schemaVersion,
          },
        }),
      )

      expect(imported.settings.schemaVersion).toBe(7)
      expect(imported.missions[0].id).toBe(workspace.missions[0].id)
      expect(imported.missions[0].evidence).toHaveLength(
        workspace.missions[0].evidence.length,
      )
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

    expect(migrated.settings.schemaVersion).toBe(7)
    expect(accepted.triageStatus).toBe('accepted')
    expect(accepted.resolutionNote).toBeUndefined()
    expect(getHandoffBlockers(migrated.missions[0])).toContain(
      '1 accepted scanner risk(s) need a non-empty resolution note',
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
