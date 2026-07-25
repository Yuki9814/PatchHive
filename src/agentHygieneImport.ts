import type { ScanSeverity } from './types'
import {
  canonicalFindingValue,
  deriveFindingKey,
  deriveScanScopeId,
} from './scanIdentity'

export const MAX_SCAN_IMPORT_BYTES = 1_000_000
export const MAX_SCAN_FINDINGS = 250

const MAX_DISCOVERY_ISSUES = 100
const MAX_SARIF_INVOCATIONS = 8
const MAX_TITLE_LENGTH = 240
const MAX_MESSAGE_LENGTH = 4_000
const MAX_PATH_LENGTH = 1_024
const MAX_RULE_ID_LENGTH = 120
const MAX_SOURCE_NAME_LENGTH = 160
const MAX_VERSION_LENGTH = 80
const SCAN_SEVERITIES = new Set<ScanSeverity>(['critical', 'high', 'medium', 'low', 'info'])
const SARIF_LEVELS = new Set(['error', 'warning', 'note', 'none'])
const AGENT_HYGIENE_FINGERPRINT = /^[a-f0-9]{20}$/
const AGENT_HYGIENE_SCOPE_FINGERPRINT = /^[a-f0-9]{20}$/

type UnknownRecord = Record<string, unknown>

export type AgentHygieneFinding = {
  ruleId: string
  title: string
  severity: ScanSeverity
  path: string
  line: number
  message: string
  remediation: string
  evidence?: string
  fingerprint?: string
  findingKey: string
}

export type AgentHygieneDiscoveryIssue = {
  path: string
  reason: string
  message: string
}

export type AgentHygieneScan = {
  format: 'json' | 'sarif'
  sourceName: string
  toolName: 'agent-hygiene'
  producerStatus: 'declared' | 'unverified'
  producerVersion?: string
  scanComplete: boolean
  scanRoot?: string
  scopeId: string
  score?: number
  status?: string
  findings: AgentHygieneFinding[]
  discoveryIssues: AgentHygieneDiscoveryIssue[]
  severityCounts: Record<ScanSeverity, number>
}

export type AgentHygieneImportPreview = AgentHygieneScan & {
  blockerCount: number
  warnings: string[]
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength
}

function hasUnsupportedControlCharacters(value: string) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127
  })
}

function boundedString(
  value: unknown,
  label: string,
  maxLength: number,
  options: { allowEmpty?: boolean } = {},
) {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be text.`)
  }

  const normalized = value.trim()

  if (!options.allowEmpty && normalized.length === 0) {
    throw new Error(`${label} cannot be empty.`)
  }

  if (normalized.length > maxLength) {
    throw new Error(`${label} exceeds the ${maxLength.toLocaleString()} character limit.`)
  }

  if (hasUnsupportedControlCharacters(normalized)) {
    throw new Error(`${label} contains unsupported control characters.`)
  }

  return normalized
}

function optionalBoundedString(value: unknown, label: string, maxLength: number) {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  return boundedString(value, label, maxLength)
}

function normalizeSourceName(value: string) {
  const basename = value.trim().split(/[\\/]/).pop() || 'pasted scan'
  const plainName = [...basename]
    .map((character) => (character.charCodeAt(0) <= 32 ? ' ' : character))
    .join('')
    .trim()
  return boundedString(plainName || 'pasted scan', 'Import source name', MAX_SOURCE_NAME_LENGTH)
}

function normalizeScopeFingerprint(value: unknown, label: string) {
  const fingerprint = optionalBoundedString(value, label, 20)

  if (!fingerprint) {
    return undefined
  }

  if (!AGENT_HYGIENE_SCOPE_FINGERPRINT.test(fingerprint)) {
    throw new Error(`${label} must be a 20-character lowercase hexadecimal privacy hash.`)
  }

  return fingerprint
}

function deriveImportedScopeId(
  scopeFingerprint: string | undefined,
  legacyScanRoot: string | undefined,
  sourceName: string,
) {
  return scopeFingerprint
    ? `scope-${scopeFingerprint}`
    : deriveScanScopeId(legacyScanRoot, sourceName)
}

function isAbsoluteOrTraversingPath(path: string) {
  let decoded = path

  try {
    decoded = decodeURIComponent(path)
  } catch {
    // Malformed percent escapes stay literal and cannot become a decoded path.
  }

  const normalized = decoded.replaceAll('\\', '/')
  const segments = normalized.split('/')

  return (
    normalized.startsWith('/') ||
    normalized === '~' ||
    normalized.startsWith('~/') ||
    /^[A-Za-z]:/.test(normalized) ||
    segments.includes('..')
  )
}

function normalizePath(value: unknown, label: string) {
  const path = boundedString(value, label, MAX_PATH_LENGTH)
  let decodedPath = path

  try {
    decodedPath = decodeURIComponent(path)
  } catch {
    // The literal value is still bounded and rendered only as text.
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path) || /^[a-z][a-z0-9+.-]*:\/\//i.test(decodedPath)) {
    throw new Error(`${label} must be a repository path, not a URL.`)
  }

  if (/[\r\n\t]/.test(path) || isAbsoluteOrTraversingPath(path)) {
    throw new Error(`${label} must be a relative repository path without parent traversal.`)
  }

  return path
}

function normalizeLine(value: unknown, label: string) {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 10_000_000) {
    throw new Error(`${label} must be a positive line number.`)
  }

  return Number(value)
}

function normalizeSeverity(value: unknown, label: string): ScanSeverity {
  if (typeof value !== 'string' || !SCAN_SEVERITIES.has(value as ScanSeverity)) {
    throw new Error(`${label} is not a supported severity.`)
  }

  return value as ScanSeverity
}

function emptySeverityCounts(): Record<ScanSeverity, number> {
  return {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  }
}

function countSeverities(findings: AgentHygieneFinding[]) {
  return findings.reduce((counts, finding) => {
    counts[finding.severity] += 1
    return counts
  }, emptySeverityCounts())
}

function normalizeFingerprint(value: unknown, label: string) {
  const fingerprint = optionalBoundedString(value, label, MAX_TITLE_LENGTH)

  if (fingerprint && !AGENT_HYGIENE_FINGERPRINT.test(fingerprint)) {
    throw new Error(`${label} must be a 20-character lowercase hexadecimal value.`)
  }

  return fingerprint
}

function deduplicateFindings(findings: Omit<AgentHygieneFinding, 'findingKey'>[]) {
  const fingerprintValues = new Map<string, string>()
  const canonicalValues = new Set<string>()
  const normalized: AgentHygieneFinding[] = []

  findings.forEach((finding) => {
    const canonicalValue = canonicalFindingValue(finding)

    if (finding.fingerprint) {
      const previousValue = fingerprintValues.get(finding.fingerprint)

      if (previousValue && previousValue !== canonicalValue) {
        throw new Error(
          `Fingerprint collision: ${finding.fingerprint} identifies different normalized findings.`,
        )
      }

      fingerprintValues.set(finding.fingerprint, canonicalValue)
    }

    if (canonicalValues.has(canonicalValue)) {
      return
    }

    canonicalValues.add(canonicalValue)
    normalized.push({
      ...finding,
      findingKey: deriveFindingKey(finding),
    })
  })

  return normalized
}

function parseJsonFinding(
  value: unknown,
  index: number,
): Omit<AgentHygieneFinding, 'findingKey'> {
  if (!isRecord(value)) {
    throw new Error(`Finding ${index + 1} must be an object.`)
  }

  return {
    ruleId: boundedString(value.rule_id, `Finding ${index + 1} rule_id`, MAX_RULE_ID_LENGTH),
    title: boundedString(value.title, `Finding ${index + 1} title`, MAX_TITLE_LENGTH),
    severity: normalizeSeverity(value.severity, `Finding ${index + 1} severity`),
    path: normalizePath(value.path, `Finding ${index + 1} path`),
    line: normalizeLine(value.line, `Finding ${index + 1} line`),
    message: boundedString(value.message, `Finding ${index + 1} message`, MAX_MESSAGE_LENGTH),
    remediation:
      optionalBoundedString(
        value.remediation,
        `Finding ${index + 1} remediation`,
        MAX_MESSAGE_LENGTH,
      ) ?? 'Review the finding and document the maintainer decision.',
    evidence: optionalBoundedString(
      value.evidence,
      `Finding ${index + 1} evidence`,
      MAX_MESSAGE_LENGTH,
    ),
    fingerprint: normalizeFingerprint(
      value.fingerprint,
      `Finding ${index + 1} fingerprint`,
    ),
  }
}

function parseDiscoveryIssues(value: unknown): AgentHygieneDiscoveryIssue[] {
  if (value === undefined) {
    return []
  }

  if (!Array.isArray(value) || value.length > MAX_DISCOVERY_ISSUES) {
    throw new Error(`Scan discovery_issues must contain at most ${MAX_DISCOVERY_ISSUES} items.`)
  }

  return value.map((issue, index) => {
    if (!isRecord(issue)) {
      throw new Error(`Discovery issue ${index + 1} must be an object.`)
    }

    return {
      path: normalizePath(issue.path, `Discovery issue ${index + 1} path`),
      reason: boundedString(
        issue.reason,
        `Discovery issue ${index + 1} reason`,
        MAX_RULE_ID_LENGTH,
      ),
      message: boundedString(
        issue.message,
        `Discovery issue ${index + 1} message`,
        MAX_MESSAGE_LENGTH,
      ),
    }
  })
}

function parseNativeJson(parsed: UnknownRecord, sourceName: string): AgentHygieneScan {
  let producerStatus: AgentHygieneScan['producerStatus'] = 'unverified'
  let producerVersion: string | undefined

  if (parsed.schema_version !== undefined) {
    if (parsed.schema_version !== 1) {
      throw new Error('Unsupported agent-hygiene JSON schema version.')
    }

    if (
      !isRecord(parsed.tool) ||
      boundedString(parsed.tool.name, 'Scanner tool name', MAX_TITLE_LENGTH).toLowerCase() !==
        'agent-hygiene'
    ) {
      throw new Error('Versioned scan JSON must be produced by agent-hygiene.')
    }

    producerVersion = boundedString(
      parsed.tool.version,
      'Scanner tool version',
      MAX_VERSION_LENGTH,
    )
    producerStatus = 'declared'
  }

  if (!isRecord(parsed.summary) || !Array.isArray(parsed.findings)) {
    throw new Error('agent-hygiene JSON must contain summary and findings.')
  }

  if (typeof parsed.summary.complete !== 'boolean') {
    throw new Error('agent-hygiene JSON summary.complete must be true or false.')
  }

  if (parsed.findings.length > MAX_SCAN_FINDINGS) {
    throw new Error(`Scan contains more than ${MAX_SCAN_FINDINGS} findings.`)
  }

  const findings = deduplicateFindings(parsed.findings.map(parseJsonFinding))
  const score =
    typeof parsed.summary.score === 'number' &&
    Number.isFinite(parsed.summary.score) &&
    parsed.summary.score >= 0 &&
    parsed.summary.score <= 100
      ? parsed.summary.score
      : undefined
  const status = optionalBoundedString(parsed.summary.status, 'Scan status', MAX_TITLE_LENGTH)
  const discoveryIssues = parseDiscoveryIssues(parsed.summary.discovery_issues)
  const scopeFingerprint = normalizeScopeFingerprint(
    parsed.summary.scope_fingerprint,
    'Scan scope fingerprint',
  )
  const legacyScanRoot = scopeFingerprint
    ? undefined
    : optionalBoundedString(parsed.summary.root, 'Scan root', MAX_PATH_LENGTH)
  const scanComplete = parsed.summary.complete && discoveryIssues.length === 0

  return {
    format: 'json',
    sourceName,
    toolName: 'agent-hygiene',
    producerStatus,
    producerVersion,
    scanComplete,
    scopeId: deriveImportedScopeId(scopeFingerprint, legacyScanRoot, sourceName),
    score,
    status,
    findings,
    discoveryIssues,
    severityCounts: countSeverities(findings),
  }
}

function getSarifMessage(result: UnknownRecord, index: number) {
  if (!isRecord(result.message)) {
    throw new Error(`SARIF result ${index + 1} message must be an object.`)
  }

  return boundedString(
    result.message.text ?? result.message.markdown,
    `SARIF result ${index + 1} message`,
    MAX_MESSAGE_LENGTH,
  )
}

function splitSarifMessage(message: string) {
  const marker = ' Fix: '
  const markerIndex = message.lastIndexOf(marker)

  if (markerIndex < 0) {
    return {
      message,
      remediation: 'Review the SARIF rule guidance and document the maintainer decision.',
    }
  }

  return {
    message: message.slice(0, markerIndex).trim(),
    remediation: message.slice(markerIndex + marker.length).trim(),
  }
}

function sarifSeverity(value: string): ScanSeverity {
  switch (value) {
    case 'error':
      return 'high'
    case 'warning':
      return 'medium'
    case 'none':
      return 'info'
    case 'note':
      return 'low'
    default:
      return 'low'
  }
}

function getSarifSeverity(result: UnknownRecord, index: number) {
  if (typeof result.level !== 'string' || !SARIF_LEVELS.has(result.level)) {
    throw new Error(`SARIF result ${index + 1} level is not supported.`)
  }

  if (isRecord(result.properties) && result.properties.severity !== undefined) {
    return normalizeSeverity(
      result.properties.severity,
      `SARIF result ${index + 1} properties.severity`,
    )
  }

  return sarifSeverity(result.level)
}

function getSarifLocation(result: UnknownRecord, index: number) {
  if (!Array.isArray(result.locations) || !isRecord(result.locations[0])) {
    throw new Error(`SARIF result ${index + 1} needs a physical location.`)
  }

  const physicalLocation = result.locations[0].physicalLocation

  if (!isRecord(physicalLocation) || !isRecord(physicalLocation.artifactLocation)) {
    throw new Error(`SARIF result ${index + 1} needs an artifact location.`)
  }

  const region = isRecord(physicalLocation.region) ? physicalLocation.region : {}

  return {
    path: normalizePath(
      physicalLocation.artifactLocation.uri,
      `SARIF result ${index + 1} artifact URI`,
    ),
    line: normalizeLine(region.startLine ?? 1, `SARIF result ${index + 1} start line`),
  }
}

function getSarifFingerprint(result: UnknownRecord, index: number) {
  if (result.partialFingerprints === undefined) {
    return undefined
  }

  if (!isRecord(result.partialFingerprints)) {
    throw new Error(`SARIF result ${index + 1} partialFingerprints must be an object.`)
  }

  return normalizeFingerprint(
    result.partialFingerprints['agentHygieneFingerprint/v1'],
    `SARIF result ${index + 1} fingerprint`,
  )
}

function sarifRuleTitles(run: UnknownRecord) {
  if (!isRecord(run.tool) || !isRecord(run.tool.driver)) {
    throw new Error('SARIF run is missing tool.driver.')
  }

  const toolName = boundedString(run.tool.driver.name, 'SARIF tool name', MAX_TITLE_LENGTH)

  if (toolName.toLowerCase() !== 'agent-hygiene') {
    throw new Error('SARIF must be produced by agent-hygiene.')
  }

  const producerVersion = optionalBoundedString(
    run.tool.driver.semanticVersion ?? run.tool.driver.version,
    'SARIF tool version',
    MAX_VERSION_LENGTH,
  )
  const titles = new Map<string, string>()

  if (run.tool.driver.rules !== undefined) {
    if (!Array.isArray(run.tool.driver.rules) || run.tool.driver.rules.length > MAX_SCAN_FINDINGS) {
      throw new Error(`SARIF rules must contain at most ${MAX_SCAN_FINDINGS} items.`)
    }

    run.tool.driver.rules.forEach((rule, index) => {
      if (!isRecord(rule)) {
        throw new Error(`SARIF rule ${index + 1} must be an object.`)
      }

      const id = boundedString(rule.id, `SARIF rule ${index + 1} id`, MAX_RULE_ID_LENGTH)
      const shortDescription = isRecord(rule.shortDescription) ? rule.shortDescription.text : undefined
      const title =
        optionalBoundedString(shortDescription, `SARIF rule ${id} title`, MAX_TITLE_LENGTH) ??
        optionalBoundedString(rule.name, `SARIF rule ${id} name`, MAX_TITLE_LENGTH) ??
        id
      titles.set(id, title)
    })
  }

  return {
    titles,
    producerStatus: producerVersion ? ('declared' as const) : ('unverified' as const),
    producerVersion,
  }
}

function sarifExecution(run: UnknownRecord) {
  if (
    !Array.isArray(run.invocations) ||
    run.invocations.length === 0 ||
    run.invocations.length > MAX_SARIF_INVOCATIONS
  ) {
    throw new Error('agent-hygiene SARIF must include an invocation.')
  }

  const discoveryIssues: AgentHygieneDiscoveryIssue[] = []
  let scanComplete = true

  run.invocations.forEach((invocation, invocationIndex) => {
    if (!isRecord(invocation) || typeof invocation.executionSuccessful !== 'boolean') {
      throw new Error(`SARIF invocation ${invocationIndex + 1} must declare executionSuccessful.`)
    }

    scanComplete = scanComplete && invocation.executionSuccessful

    if (invocation.toolExecutionNotifications === undefined) {
      return
    }

    if (
      !Array.isArray(invocation.toolExecutionNotifications) ||
      invocation.toolExecutionNotifications.length > MAX_DISCOVERY_ISSUES
    ) {
      throw new Error(
        `SARIF invocation notifications must contain at most ${MAX_DISCOVERY_ISSUES} items.`,
      )
    }

    invocation.toolExecutionNotifications.forEach((notification, notificationIndex) => {
      if (!isRecord(notification) || !isRecord(notification.message)) {
        throw new Error(`SARIF notification ${notificationIndex + 1} must contain a message.`)
      }

      const descriptor = isRecord(notification.descriptor) ? notification.descriptor : {}
      const descriptorId =
        optionalBoundedString(
          descriptor.id,
          `SARIF notification ${notificationIndex + 1} descriptor`,
          MAX_RULE_ID_LENGTH,
        ) ?? 'discovery/unknown'
      const fullMessage = boundedString(
        notification.message.text,
        `SARIF notification ${notificationIndex + 1} message`,
        MAX_MESSAGE_LENGTH,
      )
      const separator = fullMessage.indexOf(': ')

      discoveryIssues.push({
        path:
          separator > 0
            ? normalizePath(fullMessage.slice(0, separator), `SARIF notification path`)
            : 'repository scan',
        reason: descriptorId.replace(/^discovery\//, ''),
        message: separator > 0 ? fullMessage.slice(separator + 2) : fullMessage,
      })
    })
  })

  return { scanComplete, discoveryIssues }
}

function parseSarif(parsed: UnknownRecord, sourceName: string): AgentHygieneScan {
  if (parsed.version !== '2.1.0' || !Array.isArray(parsed.runs) || parsed.runs.length === 0) {
    throw new Error('SARIF import must be version 2.1.0 with at least one run.')
  }

  if (parsed.runs.length > 8) {
    throw new Error('SARIF import contains too many runs.')
  }

  const allFindings: Omit<AgentHygieneFinding, 'findingKey'>[] = []
  const allDiscoveryIssues: AgentHygieneDiscoveryIssue[] = []
  let scanComplete = true
  let score: number | undefined
  let status: string | undefined
  let producerStatus: AgentHygieneScan['producerStatus'] = 'declared'
  let producerVersion: string | undefined
  let scopeFingerprint: string | undefined

  parsed.runs.forEach((run, runIndex) => {
    if (!isRecord(run)) {
      throw new Error(`SARIF run ${runIndex + 1} must be an object.`)
    }

    const driver = sarifRuleTitles(run)
    const execution = sarifExecution(run)
    const results = run.results ?? []

    if (!Array.isArray(results)) {
      throw new Error(`SARIF run ${runIndex + 1} results must be an array.`)
    }

    if (allFindings.length + results.length > MAX_SCAN_FINDINGS) {
      throw new Error(`Scan contains more than ${MAX_SCAN_FINDINGS} findings.`)
    }

    results.forEach((result, resultIndex) => {
      if (!isRecord(result)) {
        throw new Error(`SARIF result ${resultIndex + 1} must be an object.`)
      }

      const ruleId = boundedString(
        result.ruleId,
        `SARIF result ${resultIndex + 1} ruleId`,
        MAX_RULE_ID_LENGTH,
      )
      const messageParts = splitSarifMessage(getSarifMessage(result, resultIndex))
      const location = getSarifLocation(result, resultIndex)

      allFindings.push({
        ruleId,
        title: driver.titles.get(ruleId) ?? ruleId,
        severity: getSarifSeverity(result, resultIndex),
        path: location.path,
        line: location.line,
        message: messageParts.message,
        remediation:
          (isRecord(result.properties)
            ? optionalBoundedString(
                result.properties.remediation,
                `SARIF result ${resultIndex + 1} remediation`,
                MAX_MESSAGE_LENGTH,
              )
            : undefined) ?? messageParts.remediation,
        fingerprint: getSarifFingerprint(result, resultIndex),
      })
    })

    scanComplete = scanComplete && execution.scanComplete
    allDiscoveryIssues.push(...execution.discoveryIssues)
    producerStatus =
      producerStatus === 'declared' && driver.producerStatus === 'declared'
        ? 'declared'
        : 'unverified'

    if (
      producerVersion &&
      driver.producerVersion &&
      producerVersion !== driver.producerVersion
    ) {
      throw new Error('SARIF runs declare different agent-hygiene versions.')
    }

    producerVersion = producerVersion ?? driver.producerVersion

    if (allDiscoveryIssues.length > MAX_DISCOVERY_ISSUES) {
      throw new Error(`SARIF import contains more than ${MAX_DISCOVERY_ISSUES} discovery issues.`)
    }

    if (isRecord(run.properties)) {
      const runScopeFingerprint = normalizeScopeFingerprint(
        run.properties.scopeFingerprint,
        `SARIF run ${runIndex + 1} scope fingerprint`,
      )

      if (
        scopeFingerprint &&
        runScopeFingerprint &&
        scopeFingerprint !== runScopeFingerprint
      ) {
        throw new Error('SARIF runs declare different scope fingerprints.')
      }

      scopeFingerprint = scopeFingerprint ?? runScopeFingerprint

      if (
        score === undefined &&
        typeof run.properties.score === 'number' &&
        Number.isFinite(run.properties.score) &&
        run.properties.score >= 0 &&
        run.properties.score <= 100
      ) {
        score = run.properties.score
      }

      if (status === undefined) {
        status = optionalBoundedString(
          run.properties.status,
          'SARIF scan status',
          MAX_TITLE_LENGTH,
        )
      }
    }
  })

  const findings = deduplicateFindings(allFindings)

  return {
    format: 'sarif',
    sourceName,
    toolName: 'agent-hygiene',
    producerStatus,
    producerVersion,
    scanComplete: scanComplete && allDiscoveryIssues.length === 0,
    scopeId: deriveImportedScopeId(scopeFingerprint, undefined, sourceName),
    score,
    status,
    findings,
    discoveryIssues: allDiscoveryIssues,
    severityCounts: countSeverities(findings),
  }
}

export function parseAgentHygieneImport(
  rawJson: string,
  sourceName = 'pasted scan',
): AgentHygieneScan {
  if (byteLength(rawJson) > MAX_SCAN_IMPORT_BYTES) {
    throw new Error('Scan import exceeds the 1 MB local preview limit.')
  }

  if (!rawJson.trim()) {
    throw new Error('Paste agent-hygiene JSON or SARIF before previewing.')
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(rawJson)
  } catch {
    throw new Error('Scan import is not valid JSON.')
  }

  if (!isRecord(parsed)) {
    throw new Error('Scan import must be a JSON object.')
  }

  const normalizedSourceName = normalizeSourceName(sourceName)

  if (parsed.version === '2.1.0' || parsed.runs !== undefined) {
    return parseSarif(parsed, normalizedSourceName)
  }

  return parseNativeJson(parsed, normalizedSourceName)
}

export function previewAgentHygieneImport(
  rawJson: string,
  sourceName = 'pasted scan',
): AgentHygieneImportPreview {
  const scan = parseAgentHygieneImport(rawJson, sourceName)
  const blockerCount =
    scan.severityCounts.critical +
    scan.severityCounts.high +
    scan.discoveryIssues.length +
    (scan.scanComplete ? 0 : 1)
  const warnings = [
    scan.producerStatus === 'declared'
      ? ''
      : 'Producer metadata is unverified because this is legacy or unversioned output.',
    scan.scanComplete ? '' : 'The scan is incomplete and remains a handoff blocker.',
    scan.discoveryIssues.length > 0
      ? `${scan.discoveryIssues.length} discovery issue(s) require maintainer review.`
      : '',
    scan.findings.length === 0 ? 'The scan contains no findings.' : '',
  ].filter(Boolean)

  return {
    ...scan,
    blockerCount,
    warnings,
  }
}
