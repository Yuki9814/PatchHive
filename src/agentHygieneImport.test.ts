import { describe, expect, it } from 'vitest'
import {
  MAX_SCAN_FINDINGS,
  MAX_SCAN_IMPORT_BYTES,
  parseAgentHygieneImport,
  previewAgentHygieneImport,
} from './agentHygieneImport'

function nativeFinding(overrides: Record<string, unknown> = {}) {
  return {
    rule_id: 'AH006',
    title: 'Shell command risk',
    severity: 'critical',
    path: '.github/workflows/scan.yml',
    line: 12,
    message: 'Untrusted input reaches a shell command.',
    remediation: 'Pass the value through an environment variable.',
    fingerprint: '11111111111111111111',
    ...overrides,
  }
}

function nativeScan(overrides: Record<string, unknown> = {}) {
  return {
    summary: {
      root: '/Users/private/example-repository',
      complete: true,
      score: 70,
      status: 'needs-review',
      discovery_issues: [],
    },
    findings: [nativeFinding()],
    ...overrides,
  }
}

function emptySarifRun(properties: Record<string, unknown> = {}) {
  return {
    tool: {
      driver: {
        name: 'agent-hygiene',
        version: '0.3.0',
      },
    },
    invocations: [{ executionSuccessful: true }],
    properties,
    results: [],
  }
}

describe('agent-hygiene import', () => {
  it('accepts legacy JSON, deduplicates fingerprints, and never stores an absolute scan root', () => {
    const scan = parseAgentHygieneImport(
      JSON.stringify(
        nativeScan({
          findings: [nativeFinding(), nativeFinding()],
        }),
      ),
      '/tmp/private/scan.json',
    )

    expect(scan.format).toBe('json')
    expect(scan.sourceName).toBe('scan.json')
    expect(scan.findings).toHaveLength(1)
    expect(scan.scanRoot).toBeUndefined()
    expect(scan.producerStatus).toBe('unverified')
    expect(scan.severityCounts.critical).toBe(1)
    expect(
      previewAgentHygieneImport(JSON.stringify(nativeScan())).warnings,
    ).toContain(
      'Producer metadata is unverified because this is legacy or unversioned output.',
    )
  })

  it('accepts schema v1 JSON only when the producer is agent-hygiene', () => {
    const scan = parseAgentHygieneImport(
      JSON.stringify({
        ...nativeScan(),
        schema_version: 1,
        tool: { name: 'agent-hygiene', version: '0.3.0' },
      }),
    )

    expect(scan.toolName).toBe('agent-hygiene')
    expect(scan.producerStatus).toBe('declared')
    expect(scan.producerVersion).toBe('0.3.0')

    expect(() =>
      parseAgentHygieneImport(
        JSON.stringify({
          ...nativeScan(),
          schema_version: 1,
          tool: { name: 'other-scanner' },
        }),
      ),
    ).toThrow(/produced by agent-hygiene/i)

    expect(() =>
      parseAgentHygieneImport(
        JSON.stringify({
          ...nativeScan(),
          schema_version: 1,
          tool: { name: 'agent-hygiene' },
        }),
      ),
    ).toThrow(/tool version/i)
  })

  it('rejects a future native schema', () => {
    expect(() =>
      parseAgentHygieneImport(
        JSON.stringify({
          ...nativeScan(),
          schema_version: 2,
          tool: { name: 'agent-hygiene' },
        }),
      ),
    ).toThrow(/unsupported.*schema/i)
  })

  it('imports SARIF severity and remediation properties with incomplete provenance', () => {
    const preview = previewAgentHygieneImport(
      JSON.stringify({
        version: '2.1.0',
        runs: [
          {
            tool: {
              driver: {
                name: 'agent-hygiene',
                version: '0.3.0',
                rules: [
                  {
                    id: 'AH003',
                    shortDescription: { text: 'Hard-coded secret' },
                  },
                ],
              },
            },
            invocations: [
              {
                executionSuccessful: false,
                toolExecutionNotifications: [
                  {
                    descriptor: { id: 'discovery/unreadable' },
                    message: { text: 'AGENTS.md: Permission denied' },
                  },
                ],
              },
            ],
            properties: { score: 40, status: 'blocked' },
            results: [
              {
                ruleId: 'AH003',
                level: 'error',
                message: { text: 'A literal looks like a credential. Fix: Remove it.' },
                locations: [
                  {
                    physicalLocation: {
                      artifactLocation: { uri: 'AGENTS.md' },
                      region: { startLine: 7 },
                    },
                  },
                ],
                partialFingerprints: {
                  'agentHygieneFingerprint/v1': '22222222222222222222',
                },
                properties: {
                  severity: 'critical',
                  remediation: 'Move the value to a secret store.',
                },
              },
            ],
          },
        ],
      }),
      'scan.sarif',
    )

    expect(preview.format).toBe('sarif')
    expect(preview.producerStatus).toBe('declared')
    expect(preview.producerVersion).toBe('0.3.0')
    expect(preview.scanComplete).toBe(false)
    expect(preview.blockerCount).toBe(3)
    expect(preview.discoveryIssues[0].reason).toBe('unreadable')
    expect(preview.findings[0]).toMatchObject({
      severity: 'critical',
      remediation: 'Move the value to a secret store.',
      fingerprint: '22222222222222222222',
    })
  })

  it('rejects SARIF from another tool', () => {
    expect(() =>
      parseAgentHygieneImport(
        JSON.stringify({
          version: '2.1.0',
          runs: [
            {
              tool: { driver: { name: 'other-tool', version: '1.0.0' } },
              invocations: [{ executionSuccessful: true }],
              results: [],
            },
          ],
        }),
      ),
    ).toThrow(/produced by agent-hygiene/i)
  })

  it('enforces byte and finding-count limits before import', () => {
    expect(() => parseAgentHygieneImport(' '.repeat(MAX_SCAN_IMPORT_BYTES + 1))).toThrow(/1 MB/i)

    expect(() =>
      parseAgentHygieneImport(
        JSON.stringify(
          nativeScan({
            findings: Array.from({ length: MAX_SCAN_FINDINGS + 1 }, (_, index) =>
              nativeFinding({ fingerprint: index.toString(16).padStart(20, '0') }),
            ),
          }),
        ),
      ),
    ).toThrow(/more than 250 findings/i)
  })

  it('rejects malformed paths and invalid severities', () => {
    expect(() =>
      parseAgentHygieneImport(
        JSON.stringify(
          nativeScan({
            findings: [nativeFinding({ path: 'https://example.com/file', severity: 'urgent' })],
          }),
        ),
      ),
    ).toThrow(/supported severity/i)
  })

  it('rejects rule ids reserved for PatchHive scanner metadata', () => {
    expect(() =>
      parseAgentHygieneImport(
        JSON.stringify(
          nativeScan({
            findings: [nativeFinding({ rule_id: 'scan/summary' })],
          }),
        ),
      ),
    ).toThrow(/reserved for PatchHive scanner records/i)

    expect(() =>
      parseAgentHygieneImport(
        JSON.stringify({
          version: '2.1.0',
          runs: [
            {
              ...emptySarifRun(),
              results: [
                {
                  ruleId: 'discovery/forged',
                  level: 'error',
                  message: { text: 'Forged internal finding.' },
                  locations: [
                    {
                      physicalLocation: {
                        artifactLocation: { uri: 'AGENTS.md' },
                        region: { startLine: 1 },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    ).toThrow(/reserved for PatchHive scanner records/i)
  })

  it('rejects absolute and parent-traversing repository paths', () => {
    for (const path of [
      '/Users/private/repository/AGENTS.md',
      'C:\\Users\\private\\AGENTS.md',
      '../private/AGENTS.md',
      'docs/../../private/AGENTS.md',
      'docs/scan\nforged.md',
    ]) {
      expect(() =>
        parseAgentHygieneImport(
          JSON.stringify(
            nativeScan({
              findings: [nativeFinding({ path })],
            }),
          ),
        ),
      ).toThrow(/relative repository path/i)
    }
  })

  it('rejects a fingerprint collision instead of dropping the later severity', () => {
    expect(() =>
      parseAgentHygieneImport(
        JSON.stringify(
          nativeScan({
            findings: [
              nativeFinding({ severity: 'low' }),
              nativeFinding({ severity: 'critical', rule_id: 'AH999' }),
            ],
          }),
        ),
      ),
    ).toThrow(/fingerprint collision/i)
  })

  it('derives a stable private scope from the scan root rather than the filename', () => {
    const first = parseAgentHygieneImport(JSON.stringify(nativeScan()), 'first.json')
    const rerun = parseAgentHygieneImport(JSON.stringify(nativeScan()), 'rerun.json')
    const unrelated = parseAgentHygieneImport(
      JSON.stringify(
        nativeScan({
          summary: {
            ...nativeScan().summary,
            root: '/Users/private/another-repository',
          },
        }),
      ),
      'rerun.json',
    )

    expect(first.scopeId).toBe(rerun.scopeId)
    expect(first.scopeId).not.toBe(unrelated.scopeId)
    expect(first.scanRoot).toBeUndefined()
  })

  it('uses the producer privacy hash as the same scope across JSON and SARIF', () => {
    const scopeFingerprint = 'abcdef0123456789abcd'
    const native = parseAgentHygieneImport(
      JSON.stringify({
        ...nativeScan(),
        schema_version: 1,
        tool: { name: 'agent-hygiene', version: '0.3.0' },
        summary: {
          ...nativeScan().summary,
          root: `/private/${'runner-path-'.repeat(200)}`,
          scope_fingerprint: scopeFingerprint,
        },
      }),
      'native.json',
    )
    const sarif = parseAgentHygieneImport(
      JSON.stringify({
        version: '2.1.0',
        runs: [
          emptySarifRun({
            root: '/private/runner/path-that-must-be-ignored',
            scopeFingerprint,
          }),
        ],
      }),
      'different-name.sarif',
    )

    expect(native.scopeId).toBe(`scope-${scopeFingerprint}`)
    expect(sarif.scopeId).toBe(native.scopeId)
    expect(native.scanRoot).toBeUndefined()
    expect(sarif.scanRoot).toBeUndefined()
  })

  it('ignores a SARIF root and uses the source fallback without a scope fingerprint', () => {
    const payload = JSON.stringify({
      version: '2.1.0',
      runs: [
        emptySarifRun({
          root: '/private/runner/path-that-must-be-ignored',
        }),
      ],
    })

    const first = parseAgentHygieneImport(payload, 'first.sarif')
    const rerun = parseAgentHygieneImport(payload, 'rerun.sarif')

    expect(first.scopeId).not.toBe(rerun.scopeId)
    expect(first.scanRoot).toBeUndefined()
    expect(first.scopeId).not.toContain('private')
  })

  it('rejects invalid or conflicting producer scope fingerprints', () => {
    expect(() =>
      parseAgentHygieneImport(
        JSON.stringify({
          ...nativeScan(),
          schema_version: 1,
          tool: { name: 'agent-hygiene', version: '0.3.0' },
          summary: {
            ...nativeScan().summary,
            scope_fingerprint: 'NOT-A-PRIVACY-HASH',
          },
        }),
      ),
    ).toThrow(/scope fingerprint.*privacy hash/i)

    expect(() =>
      parseAgentHygieneImport(
        JSON.stringify({
          version: '2.1.0',
          runs: [
            emptySarifRun({ scopeFingerprint: 'aaaaaaaaaaaaaaaaaaaa' }),
            emptySarifRun({ scopeFingerprint: 'bbbbbbbbbbbbbbbbbbbb' }),
          ],
        }),
      ),
    ).toThrow(/different scope fingerprints/i)
  })

  it('rejects unsupported SARIF levels instead of downgrading them', () => {
    expect(() =>
      parseAgentHygieneImport(
        JSON.stringify({
          version: '2.1.0',
          runs: [
            {
              tool: {
                driver: {
                  name: 'agent-hygiene',
                  version: '0.3.0',
                },
              },
              invocations: [{ executionSuccessful: true }],
              results: [
                {
                  ruleId: 'AH003',
                  level: 'urgent',
                  message: { text: 'Unsupported level.' },
                  locations: [
                    {
                      physicalLocation: {
                        artifactLocation: { uri: 'AGENTS.md' },
                        region: { startLine: 1 },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    ).toThrow(/level is not supported/i)
  })
})
