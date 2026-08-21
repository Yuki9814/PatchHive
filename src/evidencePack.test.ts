import { describe, expect, it, vi } from 'vitest'
import {
  EVIDENCE_PACK_FORMAT,
  MAX_EVIDENCE_PACK_IMPORT_BYTES,
  createEvidencePack,
  mergeEvidencePackIntoWorkspace,
  verifyEvidencePack,
  type EvidencePack,
} from './evidencePack'
import { createDefaultWorkspace } from './storage'

function asRecord(value: unknown) {
  return value as Record<string, unknown>
}

async function createFixture() {
  const workspace = createDefaultWorkspace()
  return {
    workspace,
    result: await createEvidencePack({
      mission: workspace.missions[0],
      generatedAt: '2026-08-21T00:00:00.000Z',
    }),
  }
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
      .join(',')}}`
  }

  return JSON.stringify(value) ?? ''
}

async function resign(value: EvidencePack, mutate: (candidate: Record<string, unknown>) => void) {
  const candidate = structuredClone(value) as unknown as Record<string, unknown>
  mutate(candidate)
  delete candidate.digest
  const digestBytes = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalize(candidate)),
  )
  candidate.digest = [...new Uint8Array(digestBytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return JSON.stringify(candidate)
}

describe('evidence pack', () => {
  it('creates a canonical, round-trippable SHA-256 envelope', async () => {
    const { result } = await createFixture()
    const parsed = JSON.parse(result.serialized) as Record<string, unknown>

    expect(Object.keys(parsed).sort()).toEqual([
      'authenticity',
      'canonicalization',
      'digest',
      'format',
      'generatedAt',
      'hashAlgorithm',
      'mission',
      'redactions',
      'schemaVersion',
      'workspaceSchemaVersion',
    ])
    expect(parsed.format).toBe(EVIDENCE_PACK_FORMAT)
    expect(result.serialized).toBe(JSON.stringify(parsed))

    const verified = await verifyEvidencePack(result.serialized, result.digest.toUpperCase())
    expect(verified.valid).toBe(true)
    expect(verified.digest).toBe(result.digest)
    expect(verified.pack.mission.source.rawText).toBeUndefined()
    expect(verified.pack.mission.evidence[0].sourceText).toBeUndefined()
    expect(verified.pack.mission.stages[0].lanes[0].findings).toEqual([])
    expect(verified.pack.mission.stages[0].lanes[0].outputDraft).toBe('')
  })

  it('rejects digest tampering and attacker-added nested fields even after rehashing', async () => {
    const { result } = await createFixture()
    const parsed = asRecord(JSON.parse(result.serialized))
    const mission = asRecord(parsed.mission)
    mission.unknown = 'reject me'

    const withoutDigest = { ...parsed }
    delete withoutDigest.digest
    const subtle = globalThis.crypto.subtle
    const bytes = new TextEncoder().encode(canonicalize(withoutDigest))
    const digestBytes = await subtle.digest('SHA-256', bytes)
    const digest = [...new Uint8Array(digestBytes)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
    parsed.digest = digest

    await expect(verifyEvidencePack(JSON.stringify(parsed))).rejects.toThrow(/unknown field/i)

    parsed.digest = result.digest.slice(0, -1) + (result.digest.endsWith('0') ? '1' : '0')
    await expect(verifyEvidencePack(JSON.stringify(parsed))).rejects.toThrow(/digest/i)
  })

  it('rejects invalid pack/workspace schemas, unknown top-level fields, invalid expected digests, and timestamps', async () => {
    const { result } = await createFixture()

    await expect(
      verifyEvidencePack(await resign(result.pack, (candidate) => {
        candidate.schemaVersion = 2
      })),
    ).rejects.toThrow(/pack schema/i)
    await expect(
      verifyEvidencePack(await resign(result.pack, (candidate) => {
        candidate.workspaceSchemaVersion = 9
      })),
    ).rejects.toThrow(/must match supported schema/i)
    await expect(
      verifyEvidencePack(await resign(result.pack, (candidate) => {
        candidate.workspaceSchemaVersion = 7
      })),
    ).rejects.toThrow(/must match supported schema/i)
    await expect(
      verifyEvidencePack(await resign(result.pack, (candidate) => {
        candidate.extra = true
      })),
    ).rejects.toThrow(/unknown field.*extra/i)
    await expect(verifyEvidencePack(result.serialized, 'not-a-digest')).rejects.toThrow(
      /expected.*64-character/i,
    )
    await expect(
      createEvidencePack({
        mission: result.pack.mission,
        generatedAt: 'not-a-timestamp',
      }),
    ).rejects.toThrow(/generatedAt.*ISO/i)
    await expect(
      verifyEvidencePack(await resign(result.pack, (candidate) => {
        candidate.generatedAt = 'not-a-timestamp'
      })),
    ).rejects.toThrow(/generatedAt.*ISO/i)
  })

  it('omits raw source fields and clears lane drafts while recording lane omissions', async () => {
    const workspace = createDefaultWorkspace()
    const mission = structuredClone(workspace.missions[0])
    const evidence = mission.evidence[0]
    evidence.sourceText = 'must never cross the pack boundary'
    evidence.provenance = {
      importer: 'agent-hygiene',
      format: 'json',
      sourceName: 'scan.json',
      toolName: 'agent-hygiene',
      scanComplete: true,
      importedAt: '2026-08-21T00:00:00.000Z',
      scanRoot: 'safe/relative/root',
    }
    mission.source.rawText = 'raw source must never cross the pack boundary'
    mission.stages[0].lanes[0].findings = [
      {
        id: 'finding-secret',
        text: 'draft finding',
        createdAt: '2026-08-21T00:00:00.000Z',
      },
    ]
    mission.stages[0].lanes[0].outputDraft = 'agent draft must be omitted'

    const result = await createEvidencePack({ mission })
    const serialized = result.serialized
    const packedEvidence = result.pack.mission.evidence[0]
    const packedProvenance = packedEvidence.provenance
    const packedLane = result.pack.mission.stages[0].lanes[0]

    expect(serialized).not.toContain('must never cross the pack boundary')
    expect(result.pack.mission.source.rawText).toBeUndefined()
    expect(packedEvidence.sourceText).toBeUndefined()
    expect(packedProvenance?.scanRoot).toBeUndefined()
    expect(packedLane.findings).toEqual([])
    expect(packedLane.outputDraft).toBe('')
    expect(result.pack.redactions).toEqual(
      expect.arrayContaining([
        {
          pointer: '/mission/source/rawText',
          category: 'omitted',
          action: 'omit',
        },
        {
          pointer: '/mission/evidence/0/sourceText',
          category: 'omitted',
          action: 'omit',
        },
        {
          pointer: '/mission/evidence/0/provenance/scanRoot',
          category: 'omitted',
          action: 'omit',
        },
        {
          pointer: '/mission/stages/0/lanes/0/findings',
          category: 'omitted',
          action: 'omit',
        },
        {
          pointer: '/mission/stages/0/lanes/0/outputDraft',
          category: 'omitted',
          action: 'omit',
        },
      ]),
    )
    await expect(verifyEvidencePack(serialized)).resolves.toMatchObject({ valid: true })
  })

  it('omits POSIX, Windows, UNC, home, file URLs, and once/twice encoded traversal paths', async () => {
    const unsafePaths = [
      '/Users/alice/private.txt',
      'C:\\Users\\alice\\private.txt',
      '\\\\server\\share\\private.txt',
      '~/private.txt',
      'file:///Users/alice/private.txt',
      'src/%2e%2e/secret.txt',
      'src/%252e%252e/secret.txt',
      'src/%25252e%25252e/secret.txt',
      'src/%ZZ/%2e%2e/secret.txt',
    ]

    for (const unsafePath of unsafePaths) {
      const mission = structuredClone(createDefaultWorkspace().missions[0])
      mission.evidence[0].filePath = unsafePath
      const result = await createEvidencePack({ mission })

      expect(result.pack.mission.evidence[0].filePath).toBeUndefined()
      expect(result.serialized).not.toContain(unsafePath)
      await expect(verifyEvidencePack(result.serialized)).resolves.toMatchObject({ valid: true })
    }
  })

  it('omits URLs containing sensitive query or fragment names', async () => {
    for (const url of [
      'https://example.com/report?utm_source=local#access_token=secret-value',
      'https://example.com/report?utm_source=local#signature=secret-value',
      'https://example.com/report?api_key=secret-value',
      'https://example.com/report?%252561pi_key=secret-value',
      'https://example.com/report?%ZZ%61pi_key=secret-value',
      'https://example.com/report?utm_source=local&code=secret-value',
    ]) {
      const mission = structuredClone(createDefaultWorkspace().missions[0])
      mission.source.url = url
      const result = await createEvidencePack({ mission })

      expect(result.pack.mission.source.url).toBeUndefined()
      expect(result.serialized).not.toContain('secret-value')
      await expect(verifyEvidencePack(result.serialized)).resolves.toMatchObject({ valid: true })
    }
  })

  it('cleans each supported credential category from retained mission text', async () => {
    const credentials = [
      {
        category: 'private-key',
        value: '-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----',
      },
      {
        category: 'github-token',
        value: `ghp_${'A'.repeat(36)}`,
      },
      {
        category: 'aws-access-key-id',
        value: `AKIA${'B'.repeat(16)}`,
      },
      {
        category: 'bearer-token',
        value: `Authorization: Bearer bearer-${'C'.repeat(24)}`,
      },
      {
        category: 'jwt',
        value: `eyJ${'a'.repeat(8)}.${'b'.repeat(12)}.${'c'.repeat(20)}`,
      },
      {
        category: 'credential-url',
        value: 'https://local-user:local-pass@example.com/report',
      },
      {
        category: 'credential-assignment',
        value: 'OPENAI_API_KEY = LocalApiKey-123456',
      },
    ] as const

    for (const credential of credentials) {
      const mission = structuredClone(createDefaultWorkspace().missions[0])
      mission.goal = `Review this local evidence: ${credential.value}`
      const result = await createEvidencePack({ mission })

      expect(result.serialized).not.toContain(credential.value)
      expect(result.pack.redactions).toContainEqual(
        expect.objectContaining({
          category: credential.category,
          pointer: '/mission/goal',
          action: 'redact',
        }),
      )
      await expect(verifyEvidencePack(result.serialized)).resolves.toMatchObject({ valid: true })
    }
  })

  it('rejects redaction changes after an attacker recomputes the digest', async () => {
    const workspace = createDefaultWorkspace()
    const mission = structuredClone(workspace.missions[0])
    mission.goal = `Keep ${`ghp_${'Z'.repeat(36)}`} out of the pack`
    const result = await createEvidencePack({ mission })
    const redactionRemoved = await resign(result.pack, (candidate) => {
      const redactions = candidate.redactions as Array<Record<string, unknown>>
      candidate.redactions = redactions.filter(
        (redaction) => redaction.category !== 'github-token',
      )
    })

    await expect(verifyEvidencePack(redactionRemoved)).rejects.toThrow(/redactions/i)
  })

  it('rejects non-canonical missions and forged or duplicate omission claims', async () => {
    const { result } = await createFixture()
    const nonCanonical = await resign(result.pack, (candidate) => {
      const mission = asRecord(candidate.mission)
      mission.activeStageId = 'ghost-stage'
      const evidence = mission.evidence as Array<Record<string, unknown>>
      evidence[0].stageId = 'ghost-stage'
    })

    await expect(verifyEvidencePack(nonCanonical)).rejects.toThrow(/not canonical/i)

    const sortRedactions = (redactions: Array<Record<string, unknown>>) =>
      redactions.sort((left, right) => {
        for (const key of ['pointer', 'category', 'action'] as const) {
          const leftValue = String(left[key])
          const rightValue = String(right[key])

          if (leftValue !== rightValue) {
            return leftValue < rightValue ? -1 : 1
          }
        }

        return 0
      })

    const forged = await resign(result.pack, (candidate) => {
      const redactions = candidate.redactions as Array<Record<string, unknown>>
      redactions.push({
        pointer: '/mission/title/url',
        category: 'url',
        action: 'omit',
      })
      candidate.redactions = sortRedactions(redactions)
    })
    await expect(verifyEvidencePack(forged)).rejects.toThrow(/redactions/i)

    const duplicated = await resign(result.pack, (candidate) => {
      const redactions = candidate.redactions as Array<Record<string, unknown>>
      redactions.push(structuredClone(redactions[0]))
      candidate.redactions = sortRedactions(redactions)
    })
    await expect(verifyEvidencePack(duplicated)).rejects.toThrow(/duplicate/i)

    const nonCanonicalIndex = await resign(result.pack, (candidate) => {
      const redactions = candidate.redactions as Array<Record<string, unknown>>
      redactions.push({
        pointer: '/mission/evidence/00/sourceText',
        category: 'omitted',
        action: 'omit',
      })
      candidate.redactions = sortRedactions(redactions)
    })
    await expect(verifyEvidencePack(nonCanonicalIndex)).rejects.toThrow(/redactions/i)
  })

  it('redacts spaced local paths and sensitive URLs embedded in text', async () => {
    const cases = [
      {
        text: 'Review /Users/alice/private report.txt before sharing.',
        forbidden: ['/Users/alice', 'report.txt'],
        category: 'path',
      },
      {
        text: 'Review /Users/alice/private and report.txt before sharing.',
        forbidden: ['/Users/alice', 'report.txt'],
        category: 'path',
      },
      {
        text: 'Review /Users/alice/private one two three four five six seven eight nine report.txt.',
        forbidden: ['/Users/alice', 'report.txt'],
        category: 'path',
      },
      {
        text: 'Review C:\\Users\\alice\\private report.txt before sharing.',
        forbidden: ['C:\\Users\\alice', 'report.txt'],
        category: 'path',
      },
      {
        text: 'path=/Users/alice/Private Documents/secret-report.txt',
        forbidden: ['/Users/alice', 'Documents/secret-report.txt'],
        category: 'path',
      },
      {
        text: '路径：C:\\Users\\alice\\Private Documents\\secret-report.txt。',
        forbidden: ['C:\\Users\\alice', 'Documents\\secret-report.txt'],
        category: 'path',
      },
      {
        text: '（/Users/alice/Private Documents/secret-report.txt）',
        forbidden: ['/Users/alice', 'Documents/secret-report.txt'],
        category: 'path',
      },
      {
        text: '（https://example.com/report?signature=secret-value）',
        forbidden: ['secret-value'],
        category: 'url',
      },
      {
        text: 'href="https://example.com/report?auth=secret-value"',
        forbidden: ['secret-value'],
        category: 'url',
      },
      {
        text: 'href="https://user:pass@example.com/?signature=secret-value"',
        forbidden: ['user:pass', 'secret-value'],
        category: 'credential-url',
      },
      {
        text: `href="https://example.com/?signature=${'x'.repeat(2_100)}"`,
        forbidden: ['signature=', 'x'.repeat(128)],
        category: 'url',
      },
      {
        text: 'url=https://example.com/report?code=secret-value',
        forbidden: ['secret-value'],
        category: 'url',
      },
      {
        text: '{"url":"https://example.com/report?api_key=secret-value"}',
        forbidden: ['secret-value'],
        category: 'url',
      },
    ] as const

    for (const example of cases) {
      const mission = structuredClone(createDefaultWorkspace().missions[0])
      mission.goal = example.text
      const result = await createEvidencePack({ mission })

      for (const forbidden of example.forbidden) {
        expect(result.serialized).not.toContain(forbidden)
      }
      expect(result.pack.redactions).toContainEqual(
        expect.objectContaining({
          pointer: '/mission/goal',
          category: example.category,
          action: 'redact',
        }),
      )
      await expect(verifyEvidencePack(result.serialized)).resolves.toMatchObject({ valid: true })
    }
  })

  it('rejects malformed bytes, duplicate keys, deep JSON, and oversized input', async () => {
    await expect(verifyEvidencePack(new Uint8Array([0xff, 0xfe]))).rejects.toThrow(/UTF-8/i)
    await expect(
      verifyEvidencePack('{"format":"patchhive.evidence-pack.v1","format":"duplicate"}'),
    ).rejects.toThrow(/duplicate/i)

    const deeplyNested = `${'['.repeat(80)}0${']'.repeat(80)}`
    await expect(verifyEvidencePack(deeplyNested)).rejects.toThrow(/nesting depth/i)
    await expect(verifyEvidencePack(' '.repeat(MAX_EVIDENCE_PACK_IMPORT_BYTES + 1))).rejects.toThrow(
      /too large/i,
    )
  })

  it('redacts credentials, omits unsafe URLs and paths, and rejects overflow', async () => {
    const workspace = createDefaultWorkspace()
    const mission = structuredClone(workspace.missions[0])
    mission.title = 'Use ghp_1234567890123456789012345678901234567890'
    mission.source.url = 'https://example.com/task?api_key=secret-value'
    mission.evidence[0].url = 'javascript:alert(1)'
    mission.evidence[0].filePath = '/Users/alice/private.txt'
    mission.evidence[0].provenance = {
      importer: 'agent-hygiene',
      format: 'json',
      sourceName: 'scan.json',
      toolName: 'agent-hygiene',
      scanComplete: true,
      importedAt: '2026-08-21T00:00:00.000Z',
      scanRoot: '/Users/alice/private-scan',
    }

    const result = await createEvidencePack({ mission })
    expect(result.pack.mission.title).toContain('[REDACTED: github-token]')
    expect(result.pack.mission.source.url).toBeUndefined()
    expect(result.pack.mission.evidence[0].filePath).toBeUndefined()
    expect(result.pack.redactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pointer: '/mission/evidence/0/url', action: 'omit' }),
        expect.objectContaining({ pointer: '/mission/evidence/0/filePath', action: 'omit' }),
        expect.objectContaining({
          pointer: '/mission/evidence/0/provenance/scanRoot',
          action: 'omit',
        }),
      ]),
    )
    await expect(verifyEvidencePack(result.serialized)).resolves.toMatchObject({ valid: true })

    const overflow = structuredClone(workspace.missions[0])
    overflow.goal = 'x'.repeat(2_000_001)
    await expect(createEvidencePack({ mission: overflow })).rejects.toThrow(/privacy text/i)
  })

  it('rejects exports larger than the verifier limit and invalid projections', async () => {
    const oversized = structuredClone(createDefaultWorkspace().missions[0])
    oversized.goal = '界'.repeat(350_000)

    await expect(createEvidencePack({ mission: oversized })).rejects.toThrow(
      /1 MB local verification limit/i,
    )

    const collision = structuredClone(createDefaultWorkspace().missions[0])
    const duplicate = structuredClone(collision.evidence[0])
    collision.evidence[0].id = `ghp_${'A'.repeat(36)}`
    duplicate.id = `ghp_${'B'.repeat(36)}`
    collision.evidence.push(duplicate)

    await expect(createEvidencePack({ mission: collision })).rejects.toThrow(
      /workspace validation/i,
    )

    const nonFinite = structuredClone(createDefaultWorkspace().missions[0])
    nonFinite.stages[0].lanes[0].confidence = Number.NaN
    await expect(createEvidencePack({ mission: nonFinite })).rejects.toThrow(
      /valid Mission|non-finite/i,
    )
  })

  it('merges by replacement or prepend without mutating the workspace', async () => {
    const { workspace, result } = await createFixture()
    const imported = structuredClone(result.pack.mission)
    imported.id = 'mission-imported'
    imported.title = 'Imported mission'
    const importedPack = { ...result.pack, mission: imported }
    const before = structuredClone(workspace)

    const replaced = mergeEvidencePackIntoWorkspace(workspace, result.pack)
    expect(replaced).not.toBe(workspace)
    expect(workspace).toEqual(before)
    expect(replaced.missions[0]).toEqual(result.pack.mission)
    expect(replaced.activeMissionId).toBe(result.pack.mission.id)

    const appended = mergeEvidencePackIntoWorkspace(workspace, importedPack)
    expect(appended.missions[0]).toEqual(imported)
    expect(appended.activeMissionId).toBe(imported.id)
    expect(appended.missions).toHaveLength(workspace.missions.length + 1)
  })

  it('fails closed when Web Crypto is unavailable', async () => {
    const { workspace } = await createFixture()
    const originalCrypto = globalThis.crypto
    vi.stubGlobal('crypto', undefined)

    await expect(createEvidencePack({ mission: workspace.missions[0] })).rejects.toThrow(/Web Crypto/i)

    vi.stubGlobal('crypto', originalCrypto)
  })
})
