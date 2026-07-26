import { mkdir, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

export const BENCHMARK_FINDING_COUNTS = [25, 100, 250]
export const BENCHMARK_SCOPE_FINGERPRINT = '0123456789abcdefabcd'

const severities = ['medium', 'low', 'info']

function severityFor(index) {
  return index === 0 ? 'high' : severities[(index - 1) % severities.length]
}

function ruleIdFor(index) {
  return `AH${String((index % 10) + 1).padStart(3, '0')}`
}

function fingerprintFor(index) {
  return (index + 1).toString(16).padStart(20, '0')
}

function normalizedFinding(index) {
  const sequence = String(index + 1).padStart(3, '0')

  return {
    ruleId: ruleIdFor(index),
    title: `Deterministic scanner finding ${sequence}`,
    severity: severityFor(index),
    path: `fixtures/path-${sequence}.yml`,
    line: index + 1,
    message: `Deterministic benchmark message ${sequence}.`,
    remediation: `Review deterministic benchmark remediation ${sequence}.`,
    fingerprint: fingerprintFor(index),
  }
}

export function createNativeScan(count) {
  const findings = Array.from({ length: count }, (_, index) => {
    const finding = normalizedFinding(index)

    return {
      rule_id: finding.ruleId,
      title: finding.title,
      severity: finding.severity,
      path: finding.path,
      line: finding.line,
      message: finding.message,
      remediation: finding.remediation,
      fingerprint: finding.fingerprint,
    }
  })

  return {
    schema_version: 1,
    tool: { name: 'agent-hygiene', version: '0.3.0' },
    summary: {
      scope_fingerprint: BENCHMARK_SCOPE_FINGERPRINT,
      complete: true,
      score: 88,
      status: 'benchmark',
      discovery_issues: [],
    },
    findings,
  }
}

export function createSarifScan(count) {
  const normalized = Array.from({ length: count }, (_, index) =>
    normalizedFinding(index),
  )
  const ruleIds = [...new Set(normalized.map((finding) => finding.ruleId))]

  return {
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'agent-hygiene',
            version: '0.3.0',
            semanticVersion: '0.3.0',
            rules: ruleIds.map((ruleId) => ({
              id: ruleId,
              shortDescription: { text: `Deterministic ${ruleId} finding` },
            })),
          },
        },
        invocations: [{ executionSuccessful: true }],
        properties: {
          score: 88,
          status: 'benchmark',
          scopeFingerprint: BENCHMARK_SCOPE_FINGERPRINT,
        },
        results: normalized.map((finding) => ({
          ruleId: finding.ruleId,
          level:
            finding.severity === 'high'
              ? 'error'
              : finding.severity === 'medium'
                ? 'warning'
                : 'note',
          message: {
            text: `${finding.message} Fix: ${finding.remediation}`,
          },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: finding.path },
                region: { startLine: finding.line },
              },
            },
          ],
          partialFingerprints: {
            'agentHygieneFingerprint/v1': finding.fingerprint,
          },
          properties: {
            severity: finding.severity,
            remediation: finding.remediation,
          },
        })),
      },
    ],
  }
}

export function createScanFixture(format, count) {
  if (!BENCHMARK_FINDING_COUNTS.includes(count)) {
    throw new Error(`Unsupported benchmark finding count: ${count}`)
  }

  if (format === 'json') return createNativeScan(count)
  if (format === 'sarif') return createSarifScan(count)
  throw new Error(`Unsupported benchmark format: ${format}`)
}

export async function writeFixtureSet(directory) {
  await mkdir(directory, { recursive: true })

  for (const count of BENCHMARK_FINDING_COUNTS) {
    for (const format of ['json', 'sarif']) {
      const extension = format === 'json' ? 'json' : 'sarif'
      const outputPath = path.join(
        directory,
        `agent-hygiene-${count}.${extension}`,
      )
      const payload = `${JSON.stringify(createScanFixture(format, count), null, 2)}\n`

      if (Buffer.byteLength(payload) > 1_000_000) {
        throw new Error(`${outputPath} exceeds PatchHive's 1 MB import limit.`)
      }

      await writeFile(outputPath, payload, 'utf8')
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const outputIndex = process.argv.indexOf('--output')
  const outputDirectory =
    outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined

  if (!outputDirectory) {
    throw new Error('Usage: node scripts/generate-scan-fixtures.mjs --output DIRECTORY')
  }

  await writeFixtureSet(path.resolve(outputDirectory))
}
