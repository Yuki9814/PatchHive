import { describe, expect, it } from 'vitest'
import {
  MAX_HANDOFF_PRIVACY_CHARACTERS,
  MAX_HANDOFF_PRIVACY_CREDENTIAL_VALUE_CHARACTERS,
  MAX_HANDOFF_PRIVACY_FINDINGS,
  runHandoffPrivacyPreflight,
} from './handoffPrivacy'

function githubToken(character = 'A') {
  return `ghp_${character.repeat(36)}`
}

function jwt(character = 'a') {
  return `eyJ${character.repeat(8)}.${character.repeat(12)}.${character.repeat(20)}`
}

describe('handoff privacy preflight', () => {
  it('detects and deterministically masks high-confidence secrets without returning raw matches', () => {
    const privateKey =
      '-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----'
    const github = githubToken()
    const aws = `AKIA${'B'.repeat(16)}`
    const bearer = `bearer-${'C'.repeat(24)}`
    const jsonWebToken = jwt()
    const credentialUrl = 'https://local-user:local-pass@example.com/report'
    const assignedPassword = 'Correct horse 7 battery'
    const assignedApiKey = 'LocalApiKey-123456'
    const markdown = [
      '# Handoff',
      privateKey,
      `GitHub credential: ${github}`,
      `AWS credential: ${aws}`,
      `Authorization: Bearer ${bearer}`,
      `Session: ${jsonWebToken}`,
      `Evidence: ${credentialUrl}`,
      `password = "${assignedPassword}"`,
      `OPENAI_API_KEY = '${assignedApiKey}'`,
    ].join('\n')

    const first = runHandoffPrivacyPreflight(markdown)
    const second = runHandoffPrivacyPreflight(markdown)

    expect(first).toEqual(second)
    expect(first.status).toBe('checked')

    if (first.status !== 'checked') {
      throw new Error('Expected a checked privacy preflight.')
    }

    expect(first.findings).toEqual([
      { category: 'private-key', line: 2 },
      { category: 'github-token', line: 5 },
      { category: 'aws-access-key-id', line: 6 },
      { category: 'bearer-token', line: 7 },
      { category: 'jwt', line: 8 },
      { category: 'credential-url', line: 9 },
      { category: 'credential-assignment', line: 10 },
      { category: 'credential-assignment', line: 11 },
    ])
    expect(first.redactedMarkdown).toContain('[REDACTED: private-key]')
    expect(first.redactedMarkdown).toContain('[REDACTED: github-token]')
    expect(first.redactedMarkdown).toContain(
      'https://[REDACTED: credential-url]@example.com/report',
    )
    expect(first.redactedMarkdown).toContain(
      'password = "[REDACTED: credential-assignment]"',
    )

    for (const secret of [
      privateKey,
      github,
      aws,
      bearer,
      jsonWebToken,
      'local-user',
      'local-pass',
      assignedPassword,
      assignedApiKey,
    ]) {
      expect(first.redactedMarkdown).not.toContain(secret)
      expect(JSON.stringify(first.findings)).not.toContain(secret)
    }
  })

  it('prefers the most contextual mask when patterns overlap', () => {
    const assignedToken = githubToken('D')
    const jsonWebToken = jwt()
    const embeddedToken = githubToken('E')
    const markdown = [
      `token = "${assignedToken}"`,
      `Authorization: Bearer ${jsonWebToken}`,
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      embeddedToken,
      '-----END OPENSSH PRIVATE KEY-----',
    ].join('\n')

    const result = runHandoffPrivacyPreflight(markdown)

    expect(result.status).toBe('checked')

    if (result.status !== 'checked') {
      throw new Error('Expected a checked privacy preflight.')
    }

    expect(result.findings).toEqual([
      { category: 'credential-assignment', line: 1 },
      { category: 'bearer-token', line: 2 },
      { category: 'private-key', line: 3 },
    ])
    expect(result.redactedMarkdown.match(/\[REDACTED:/g)).toHaveLength(3)
    expect(result.redactedMarkdown).not.toContain(assignedToken)
    expect(result.redactedMarkdown).not.toContain(jsonWebToken)
    expect(result.redactedMarkdown).not.toContain(embeddedToken)
  })

  it('preserves JWT segment limits and masks adjacent valid tokens', () => {
    const minimumJwt =
      `eyJ${'a'.repeat(7)}.${'b'.repeat(10)}.${'c'.repeat(16)}`
    const maximumJwt =
      `eyJ${'d'.repeat(1_024)}.${'e'.repeat(16_384)}.${'f'.repeat(4_096)}`
    const markdown = `${minimumJwt} ${maximumJwt}`
    const result = runHandoffPrivacyPreflight(markdown)

    expect(result.status).toBe('checked')

    if (result.status !== 'checked') {
      throw new Error('Expected a checked privacy preflight.')
    }

    expect(result.findings).toEqual([
      { category: 'jwt', line: 1 },
      { category: 'jwt', line: 1 },
    ])
    expect(result.redactedMarkdown).toBe(
      '[REDACTED: jwt] [REDACTED: jwt]',
    )
  })

  it('masks chained JWTs without exposing later segments', () => {
    const first = jwt('a')
    const second = jwt('b')
    const third = jwt('c')
    const markdown = `${first}-${second}-${third}`
    const result = runHandoffPrivacyPreflight(markdown)

    expect(result.status).toBe('checked')

    if (result.status !== 'checked') {
      throw new Error('Expected a checked privacy preflight.')
    }

    expect(result.findings).toEqual([
      { category: 'jwt', line: 1 },
    ])
    expect(result.redactedMarkdown).toBe('[REDACTED: jwt]')

    for (const token of [first, second, third]) {
      expect(result.redactedMarkdown).not.toContain(token)
    }
  })

  it('does not promote an incomplete nested JWT header to a finding', () => {
    const valid = jwt('d')
    const nestedHeader = `eyJ${'e'.repeat(7)}`
    const invalidTokens = [
      `${valid}-${nestedHeader}.short`,
      `${valid}-${nestedHeader}.${'f'.repeat(10)}.short`,
    ]

    for (const markdown of invalidTokens) {
      const result = runHandoffPrivacyPreflight(markdown)

      expect(result.status).toBe('checked')

      if (result.status !== 'checked') {
        throw new Error('Expected a checked privacy preflight.')
      }

      expect(result.findings).toEqual([
        { category: 'jwt', line: 1 },
      ])
      expect(result.redactedMarkdown.match(/\[REDACTED: jwt]/g)).toHaveLength(
        1,
      )
      expect(result.redactedMarkdown).not.toContain(valid)
      expect(result.redactedMarkdown).not.toContain(nestedHeader)
    }
  })

  it('does not create partial JWT candidates outside segment limits', () => {
    const invalidTokens = [
      `eyJ${'a'.repeat(6)}.${'b'.repeat(10)}.${'c'.repeat(16)}`,
      `eyJ${'a'.repeat(7)}.${'b'.repeat(9)}.${'c'.repeat(16)}`,
      `eyJ${'a'.repeat(7)}.${'b'.repeat(10)}.${'c'.repeat(15)}`,
      `eyJ${'a'.repeat(1_025)}.${'b'.repeat(10)}.${'c'.repeat(16)}`,
      `eyJ${'a'.repeat(7)}.${'b'.repeat(16_385)}.${'c'.repeat(16)}`,
      `eyJ${'a'.repeat(7)}.${'b'.repeat(10)}.${'c'.repeat(4_097)}`,
    ]
    const markdown = invalidTokens.join('\n')

    expect(runHandoffPrivacyPreflight(markdown)).toEqual({
      status: 'checked',
      redactedMarkdown: markdown,
      findings: [],
      checkedCharacters: markdown.length,
    })
  })

  it('preserves JWT word-boundary and extra-segment behavior', () => {
    const token = jwt()
    const markdown = [
      `prefix_${token}`,
      `prefix-${token}`,
      `${token}.extra`,
      `${token}-.extra`,
    ].join('\n')
    const result = runHandoffPrivacyPreflight(markdown)

    expect(result.status).toBe('checked')

    if (result.status !== 'checked') {
      throw new Error('Expected a checked privacy preflight.')
    }

    expect(result.findings).toEqual([
      { category: 'jwt', line: 2 },
      { category: 'jwt', line: 3 },
      { category: 'jwt', line: 4 },
    ])
    expect(result.redactedMarkdown).toContain(`prefix_${token}`)
    expect(result.redactedMarkdown).toContain('prefix-[REDACTED: jwt]')
    expect(result.redactedMarkdown).toContain('[REDACTED: jwt].extra')
    expect(result.redactedMarkdown).not.toContain(`${token}.extra`)
    expect(result.redactedMarkdown).not.toContain(`${token}-.extra`)
  })

  it('coalesces an earlier low-priority assignment with the full private-key range', () => {
    const privateMaterial = 'private-material-must-not-survive'
    const markdown = [
      'token = prefix-----BEGIN PRIVATE KEY-----',
      privateMaterial,
      '-----END PRIVATE KEY-----',
    ].join('\n')

    const result = runHandoffPrivacyPreflight(markdown)

    expect(result.status).toBe('checked')

    if (result.status !== 'checked') {
      throw new Error('Expected a checked privacy preflight.')
    }

    expect(result.findings).toEqual([
      { category: 'private-key', line: 1 },
    ])
    expect(result.redactedMarkdown).toContain('[REDACTED: private-key]')
    expect(result.redactedMarkdown).not.toContain('prefix')
    expect(result.redactedMarkdown).not.toContain(privateMaterial)
    expect(result.redactedMarkdown).not.toContain('BEGIN PRIVATE KEY')
    expect(result.redactedMarkdown).not.toContain('END PRIVATE KEY')
  })

  it(
    'redacts an unterminated private key in linear time at the input bound',
    () => {
      const begin = '-----BEGIN PRIVATE KEY-----\n'
      const repeats = Math.floor(
        MAX_HANDOFF_PRIVACY_CHARACTERS / begin.length,
      )
      const markdown = `${begin.repeat(repeats)}${'x'.repeat(
        MAX_HANDOFF_PRIVACY_CHARACTERS - begin.length * repeats,
      )}`
      const startedAt = performance.now()
      const result = runHandoffPrivacyPreflight(markdown)
      const elapsedMilliseconds = performance.now() - startedAt

      expect(elapsedMilliseconds).toBeLessThan(2_000)
      expect(result.status).toBe('checked')

      if (result.status !== 'checked') {
        throw new Error('Expected a checked privacy preflight.')
      }

      expect(result.findings).toEqual([
        { category: 'private-key', line: 1 },
      ])
      expect(result.redactedMarkdown).not.toContain('BEGIN PRIVATE KEY')
      expect(result.redactedMarkdown.match(/\n/g)?.length).toBe(repeats)
    },
    10_000,
  )

  it(
    'preserves a near-limit run of line breaks without a match-array spike',
    () => {
      const begin = '-----BEGIN PRIVATE KEY-----'
      const lineBreakCount =
        MAX_HANDOFF_PRIVACY_CHARACTERS - begin.length
      const markdown = `${begin}${'\n'.repeat(lineBreakCount)}`
      const startedAt = performance.now()
      const result = runHandoffPrivacyPreflight(markdown)
      const elapsedMilliseconds = performance.now() - startedAt

      expect(elapsedMilliseconds).toBeLessThan(2_000)
      expect(result.status).toBe('checked')

      if (result.status !== 'checked') {
        throw new Error('Expected a checked privacy preflight.')
      }

      expect(result.findings).toEqual([
        { category: 'private-key', line: 1 },
      ])
      expect(result.redactedMarkdown.startsWith('[REDACTED: private-key]'))
        .toBe(true)
      expect(result.redactedMarkdown.length).toBe(
        '[REDACTED: private-key]'.length + lineBreakCount,
      )
      expect(result.redactedMarkdown.endsWith('\n')).toBe(true)
    },
    10_000,
  )

  it(
    'bounds credential-name scanning on delimiter-free adversarial input',
    () => {
      const markdown = 'a-'
        .repeat(Math.ceil(MAX_HANDOFF_PRIVACY_CHARACTERS / 2))
        .slice(0, MAX_HANDOFF_PRIVACY_CHARACTERS)
      const startedAt = performance.now()
      const result = runHandoffPrivacyPreflight(markdown)
      const elapsedMilliseconds = performance.now() - startedAt

      expect(elapsedMilliseconds).toBeLessThan(2_000)
      expect(result).toEqual({
        status: 'checked',
        redactedMarkdown: markdown,
        findings: [],
        checkedCharacters: markdown.length,
      })
    },
    10_000,
  )

  it(
    'bounds JWT scanning when repeated header prefixes contain no separators',
    () => {
      const chunk = 'eyJaaaaaaaa-'
      const markdown = chunk
        .repeat(Math.ceil(MAX_HANDOFF_PRIVACY_CHARACTERS / chunk.length))
        .slice(0, MAX_HANDOFF_PRIVACY_CHARACTERS)
      const startedAt = performance.now()
      const result = runHandoffPrivacyPreflight(markdown)
      const elapsedMilliseconds = performance.now() - startedAt

      expect(elapsedMilliseconds).toBeLessThan(2_000)
      expect(result).toEqual({
        status: 'checked',
        redactedMarkdown: markdown,
        findings: [],
        checkedCharacters: markdown.length,
      })
    },
    10_000,
  )

  it(
    'bounds JWT scanning on a dense run of separators',
    () => {
      const markdown = '.'.repeat(MAX_HANDOFF_PRIVACY_CHARACTERS)
      const startedAt = performance.now()
      const result = runHandoffPrivacyPreflight(markdown)
      const elapsedMilliseconds = performance.now() - startedAt

      expect(elapsedMilliseconds).toBeLessThan(2_000)
      expect(result).toEqual({
        status: 'checked',
        redactedMarkdown: markdown,
        findings: [],
        checkedCharacters: markdown.length,
      })
    },
    10_000,
  )

  it(
    'bounds credential URL scanning when repeated URLs contain no at-sign',
    () => {
      const chunk = 'https://user:password'
      const markdown = chunk
        .repeat(Math.ceil(MAX_HANDOFF_PRIVACY_CHARACTERS / chunk.length))
        .slice(0, MAX_HANDOFF_PRIVACY_CHARACTERS)
      const startedAt = performance.now()
      const result = runHandoffPrivacyPreflight(markdown)
      const elapsedMilliseconds = performance.now() - startedAt

      expect(elapsedMilliseconds).toBeLessThan(2_000)
      expect(result).toEqual({
        status: 'checked',
        redactedMarkdown: markdown,
        findings: [],
        checkedCharacters: markdown.length,
      })
    },
    10_000,
  )

  it('redacts credentials in common HTTP and database connection URLs', () => {
    const schemes = [
      'http',
      'https',
      'postgres',
      'postgresql',
      'mysql',
      'mariadb',
      'redis',
      'rediss',
      'mongodb',
      'mongodb+srv',
    ]
    const markdown = schemes
      .map(
        (scheme) =>
          `${scheme}://alice:CorrectHorse7@localhost/example`,
      )
      .join('\n')

    const result = runHandoffPrivacyPreflight(markdown)

    expect(result.status).toBe('checked')

    if (result.status !== 'checked') {
      throw new Error('Expected a checked privacy preflight.')
    }

    expect(result.findings).toHaveLength(schemes.length)
    expect(
      result.findings.every(
        (finding) => finding.category === 'credential-url',
      ),
    ).toBe(true)

    for (const scheme of schemes) {
      expect(result.redactedMarkdown).toContain(
        `${scheme}://[REDACTED: credential-url]@localhost/example`,
      )
    }

    expect(result.redactedMarkdown).not.toContain('alice')
    expect(result.redactedMarkdown).not.toContain('CorrectHorse7')
  })

  it('redacts alphabetic password assignments while preserving placeholders and environment references', () => {
    const markdown = [
      'password = correcthorsebatterystaple',
      'database_passwd: anotherlettersonlysecret',
      'password = process.env.DB_PASSWORD',
      'passwd = ${DB_PASSWORD}',
      'password = your-password',
      'token = alphabeticonlyvalue',
    ].join('\n')

    const result = runHandoffPrivacyPreflight(markdown)

    expect(result.status).toBe('checked')

    if (result.status !== 'checked') {
      throw new Error('Expected a checked privacy preflight.')
    }

    expect(result.findings).toEqual([
      { category: 'credential-assignment', line: 1 },
      { category: 'credential-assignment', line: 2 },
    ])
    expect(result.redactedMarkdown).toContain(
      'password = [REDACTED: credential-assignment]',
    )
    expect(result.redactedMarkdown).toContain(
      'database_passwd: [REDACTED: credential-assignment]',
    )
    expect(result.redactedMarkdown).toContain(
      'password = process.env.DB_PASSWORD',
    )
    expect(result.redactedMarkdown).toContain('passwd = ${DB_PASSWORD}')
    expect(result.redactedMarkdown).toContain('password = your-password')
    expect(result.redactedMarkdown).toContain(
      'token = alphabeticonlyvalue',
    )
  })

  it('redacts bounded space-separated credential names', () => {
    const markdown = [
      'API key: "LiveApiKey-1234567890"',
      'secret access key = LiveSecretAccessKey-1234567890',
      'access token: LocalAccessToken-1234567890',
      'client secret = LocalClientSecret-1234567890',
      'secretaccesskey = CompactSecretAccessKey-1234567890',
      'secret_accesskey = LeftSeparatedSecret-1234567890',
      'secretaccess_key = RightSeparatedSecret-1234567890',
    ].join('\n')

    const result = runHandoffPrivacyPreflight(markdown)

    expect(result.status).toBe('checked')

    if (result.status !== 'checked') {
      throw new Error('Expected a checked privacy preflight.')
    }

    expect(result.findings).toEqual([
      { category: 'credential-assignment', line: 1 },
      { category: 'credential-assignment', line: 2 },
      { category: 'credential-assignment', line: 3 },
      { category: 'credential-assignment', line: 4 },
      { category: 'credential-assignment', line: 5 },
      { category: 'credential-assignment', line: 6 },
      { category: 'credential-assignment', line: 7 },
    ])
    expect(result.redactedMarkdown).not.toContain('LiveApiKey')
    expect(result.redactedMarkdown).not.toContain('LiveSecretAccessKey')
    expect(result.redactedMarkdown).not.toContain('LocalAccessToken')
    expect(result.redactedMarkdown).not.toContain('LocalClientSecret')
    expect(result.redactedMarkdown).not.toContain('CompactSecretAccessKey')
    expect(result.redactedMarkdown).not.toContain('LeftSeparatedSecret')
    expect(result.redactedMarkdown).not.toContain('RightSeparatedSecret')
  })

  it(
    'bounds space-separated credential-name scanning without an assignment delimiter',
    () => {
      const chunk = 'API key secret access key '
      const markdown = chunk
        .repeat(Math.ceil(MAX_HANDOFF_PRIVACY_CHARACTERS / chunk.length))
        .slice(0, MAX_HANDOFF_PRIVACY_CHARACTERS)
      const startedAt = performance.now()
      const result = runHandoffPrivacyPreflight(markdown)
      const elapsedMilliseconds = performance.now() - startedAt

      expect(elapsedMilliseconds).toBeLessThan(2_000)
      expect(result).toEqual({
        status: 'checked',
        redactedMarkdown: markdown,
        findings: [],
        checkedCharacters: markdown.length,
      })
    },
    10_000,
  )

  it('fails closed instead of partially masking an oversized unquoted credential value', () => {
    const oversizedValue =
      'A'.repeat(
        MAX_HANDOFF_PRIVACY_CREDENTIAL_VALUE_CHARACTERS,
      ) + 'TAIL-SECRET-MUST-NOT-SURVIVE'
    const markdown = `password = ${oversizedValue}`

    expect(runHandoffPrivacyPreflight(markdown)).toEqual({
      status: 'blocked',
      reason: 'credential-value-limit-exceeded',
      redactedMarkdown: '',
      findings: [],
      checkedCharacters: markdown.length,
      limit: MAX_HANDOFF_PRIVACY_CREDENTIAL_VALUE_CHARACTERS,
    })
  })

  it('fails closed for oversized or unterminated quoted credential values', () => {
    const oversizedValue =
      'A'.repeat(
        MAX_HANDOFF_PRIVACY_CREDENTIAL_VALUE_CHARACTERS,
      ) + 'TAIL-SECRET-MUST-NOT-SURVIVE'

    for (const markdown of [
      `password = "${oversizedValue}"`,
      `password = "${oversizedValue}`,
    ]) {
      expect(runHandoffPrivacyPreflight(markdown)).toEqual({
        status: 'blocked',
        reason: 'credential-value-limit-exceeded',
        redactedMarkdown: '',
        findings: [],
        checkedCharacters: markdown.length,
        limit: MAX_HANDOFF_PRIVACY_CREDENTIAL_VALUE_CHARACTERS,
      })
    }
  })

  it('keeps an escaped quote inside the fully masked credential value', () => {
    const markdown = String.raw`password = "abcdefgh\"TAIL-SECRET-MUST-NOT-SURVIVE"`
    const result = runHandoffPrivacyPreflight(markdown)

    expect(result.status).toBe('checked')

    if (result.status !== 'checked') {
      throw new Error('Expected a checked privacy preflight.')
    }

    expect(result.findings).toEqual([
      { category: 'credential-assignment', line: 1 },
    ])
    expect(result.redactedMarkdown).toBe(
      'password = "[REDACTED: credential-assignment]"',
    )
    expect(result.redactedMarkdown).not.toContain(
      'TAIL-SECRET-MUST-NOT-SURVIVE',
    )
  })

  it('fails closed when a quoted value has an ambiguous suffix', () => {
    const markdownValues = [
      'password = "abcdefgh"TAIL-SECRET-MUST-NOT-SURVIVE',
      'password = "abcdefgh-without-a-closing-quote',
    ]

    for (const markdown of markdownValues) {
      expect(runHandoffPrivacyPreflight(markdown)).toEqual({
        status: 'blocked',
        reason: 'credential-value-ambiguous',
        redactedMarkdown: '',
        findings: [],
        checkedCharacters: markdown.length,
        limit: MAX_HANDOFF_PRIVACY_CREDENTIAL_VALUE_CHARACTERS,
      })
    }
  })

  it('applies the public finding bound after overlap resolution', () => {
    const markdown = Array.from(
      { length: 300 },
      (_, index) => `token = "${githubToken(String(index % 10))}"`,
    ).join('\n')
    const result = runHandoffPrivacyPreflight(markdown)

    expect(result.status).toBe('checked')

    if (result.status !== 'checked') {
      throw new Error('Expected a checked privacy preflight.')
    }

    expect(result.findings).toHaveLength(300)
    expect(
      result.findings.every(
        (finding) => finding.category === 'credential-assignment',
      ),
    ).toBe(true)
  })

  it('ignores placeholders, short examples, environment references, and ordinary URLs', () => {
    const markdown = [
      'api_key = "your-api-key"',
      'token = process.env.ACCESS_TOKEN',
      'password = changeme',
      'secret: required-before-export',
      'Authorization: Bearer example',
      `Almost AWS: AKIA${'A'.repeat(15)}`,
      'Documentation: https://example.com/path',
    ].join('\n')

    const result = runHandoffPrivacyPreflight(markdown)

    expect(result).toEqual({
      status: 'checked',
      redactedMarkdown: markdown,
      findings: [],
      checkedCharacters: markdown.length,
    })
  })

  it('reports original line numbers across CRLF and lone carriage returns', () => {
    const github = githubToken('F')
    const aws = `ASIA${'G'.repeat(16)}`
    const markdown = `Header\r\nGitHub: ${github}\rAWS: ${aws}`
    const result = runHandoffPrivacyPreflight(markdown)

    expect(result.status).toBe('checked')

    if (result.status !== 'checked') {
      throw new Error('Expected a checked privacy preflight.')
    }

    expect(result.findings).toEqual([
      { category: 'github-token', line: 2 },
      { category: 'aws-access-key-id', line: 3 },
    ])
  })

  it('fails closed when the input or match count exceeds a bounded scan', () => {
    expect(
      runHandoffPrivacyPreflight(
        'a'.repeat(MAX_HANDOFF_PRIVACY_CHARACTERS + 1),
      ),
    ).toEqual({
      status: 'blocked',
      reason: 'input-too-large',
      redactedMarkdown: '',
      findings: [],
      checkedCharacters: 0,
      limit: MAX_HANDOFF_PRIVACY_CHARACTERS,
    })

    const repeatedTokens = Array.from(
      { length: MAX_HANDOFF_PRIVACY_FINDINGS + 1 },
      (_, index) => githubToken(String(index % 10)),
    ).join('\n')
    const result = runHandoffPrivacyPreflight(repeatedTokens)

    expect(result).toEqual({
      status: 'blocked',
      reason: 'finding-limit-exceeded',
      redactedMarkdown: '',
      findings: [],
      checkedCharacters: repeatedTokens.length,
      limit: MAX_HANDOFF_PRIVACY_FINDINGS,
    })
  })
})
