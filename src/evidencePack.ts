import {
  MAX_HANDOFF_PRIVACY_CHARACTERS,
  MAX_HANDOFF_PRIVACY_FINDINGS,
  runHandoffPrivacyPreflight,
  type HandoffPrivacyCategory,
} from './handoffPrivacy'
import { normalizeExternalUrl } from './safeUrl'
import {
  MAX_WORKSPACE_JSON_DEPTH,
  SCHEMA_VERSION,
  normalizeImportedMission,
} from './storage'
import type {
  AgentLane,
  ApprovalGate,
  EvidenceItem,
  EvidenceProvenance,
  HandoffFieldKey,
  Mission,
  MissionSource,
  MissionStage,
  WorkspaceState,
} from './types'

export const EVIDENCE_PACK_FORMAT = 'patchhive.evidence-pack.v1'
export const MAX_EVIDENCE_PACK_IMPORT_BYTES = 1_000_000

const EVIDENCE_PACK_SCHEMA_VERSION = 1
const EVIDENCE_PACK_CANONICALIZATION = 'patchhive-canonical-json-v1'
const EVIDENCE_PACK_HASH_ALGORITHM = 'SHA-256'
const EVIDENCE_PACK_AUTHENTICITY = 'unverified'
const REDACTION_ACTIONS = ['omit', 'redact'] as const
const FIXED_REDACTION_CATEGORY = 'omitted'
const PATH_REDACTION_CATEGORY = 'path'
const CONTROL_REDACTION_CATEGORY = 'control-character'
const FIELD_SOURCE_KEYS: HandoffFieldKey[] = [
  'summary',
  'patchPlan',
  'testPlan',
  'risks',
  'maintainerComment',
]

const HandoffPrivacyCategories = new Set<HandoffPrivacyCategory>([
  'private-key',
  'github-token',
  'aws-access-key-id',
  'bearer-token',
  'jwt',
  'credential-url',
  'credential-assignment',
])

const REDACTION_LABEL_PATTERN = /\[REDACTED: ([^\]]+)\]/gu

export type EvidencePackRedaction = {
  pointer: string
  category: string
  action: (typeof REDACTION_ACTIONS)[number]
}

export type EvidencePack = {
  format: typeof EVIDENCE_PACK_FORMAT
  schemaVersion: typeof EVIDENCE_PACK_SCHEMA_VERSION
  canonicalization: typeof EVIDENCE_PACK_CANONICALIZATION
  hashAlgorithm: typeof EVIDENCE_PACK_HASH_ALGORITHM
  authenticity: typeof EVIDENCE_PACK_AUTHENTICITY
  generatedAt: string
  workspaceSchemaVersion: number
  mission: Mission
  redactions: EvidencePackRedaction[]
  digest: string
}

export type EvidencePackVerification = {
  ok: true
  valid: true
  status: 'verified'
  pack: EvidencePack
  digest: string
}

type JsonRecord = Record<string, unknown>

type SanitizationState = {
  checkedCharacters: number
  findingCount: number
  redactions: EvidencePackRedaction[]
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function pointerFor(pointer: string, key: string | number) {
  const escaped = String(key).replaceAll('~', '~0').replaceAll('/', '~1')
  return `${pointer}/${escaped}`
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`
  }

  if (isRecord(value)) {
    const entries = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => {
        const serializedKey = JSON.stringify(key)
        const serializedValue = canonicalize(value[key])

        return `${serializedKey}:${serializedValue}`
      })

    return `{${entries.join(',')}}`
  }

  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('Evidence pack contains a non-finite number.')
  }

  const serialized = JSON.stringify(value)

  if (serialized === undefined) {
    throw new Error('Evidence pack contains a non-JSON value.')
  }

  return serialized
}

function cloneJson<T>(value: T): T {
  return JSON.parse(canonicalize(value)) as T
}

async function digestCanonicalJson(value: string) {
  let subtle: SubtleCrypto | undefined

  try {
    subtle = globalThis.crypto?.subtle
  } catch {
    subtle = undefined
  }

  if (!subtle || typeof subtle.digest !== 'function') {
    throw new Error('Web Crypto SHA-256 is unavailable; evidence pack verification is disabled.')
  }

  const bytes = new TextEncoder().encode(value)
  const digest = await subtle.digest('SHA-256', bytes)

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false
  }

  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value,
    )
  ) {
    return false
  }

  return !Number.isNaN(Date.parse(value))
}

function addRedaction(
  state: SanitizationState,
  pointer: string,
  category: string,
  action: EvidencePackRedaction['action'],
) {
  if (
    !state.redactions.some(
      (redaction) =>
        redaction.pointer === pointer &&
        redaction.category === category &&
        redaction.action === action,
    )
  ) {
    state.redactions.push({ pointer, category, action })
  }
}

function addOmission(
  state: SanitizationState,
  pointer: string,
  shouldRecord: boolean,
) {
  if (shouldRecord) {
    addRedaction(state, pointer, FIXED_REDACTION_CATEGORY, 'omit')
  }
}

function sortRedactions(redactions: EvidencePackRedaction[]) {
  const compare = (left: string, right: string) =>
    left < right ? -1 : left > right ? 1 : 0

  return [...redactions].sort(
    (left, right) =>
      compare(left.pointer, right.pointer) ||
      compare(left.category, right.category) ||
      compare(left.action, right.action),
  )
}

function decodeRepeatedly(value: string) {
  let decoded = value

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded)

      if (next === decoded) {
        return { decoded, stable: true }
      }

      decoded = next
    } catch {
      return {
        decoded,
        stable: !/%[0-9a-f]{2}/iu.test(decoded),
      }
    }
  }

  return { decoded, stable: false }
}

function hasControlCharacter(value: string, includeWhitespace = false) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0)

    if (includeWhitespace) {
      return code <= 31 || code === 127
    }

    return (
      (code <= 8 || (code >= 11 && code <= 12) || (code >= 14 && code <= 31)) ||
      code === 127
    )
  })
}

function isDangerousPath(value: string) {
  const { decoded, stable } = decodeRepeatedly(value)
  const normalized = decoded.replaceAll('\\', '/')

  return (
    !stable ||
    hasControlCharacter(value, true) ||
    hasControlCharacter(decoded, true) ||
    normalized === '~' ||
    normalized.startsWith('~/') ||
    normalized.startsWith('/') ||
    normalized.startsWith('//') ||
    /^[A-Za-z]:/.test(normalized) ||
    /^file:/i.test(normalized) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(normalized) ||
    normalized.split('/').includes('..')
  )
}

function isDangerousTextPathToken(value: string) {
  const { decoded } = decodeRepeatedly(value)
  const normalized = decoded.replaceAll('\\', '/')

  if (/^(?:https?|mailto):/i.test(normalized)) {
    return false
  }

  return isDangerousPath(value)
}

function hasEmbeddedDangerousPath(value: string) {
  const withoutUrls = value.replace(/https?:\/\/[^\s"'`<>]+/giu, '')
  const candidates: string[] = []
  const posix = withoutUrls.match(/(?:^|[=：:"'])(\/(?!\/).*)/u)?.[1]

  if (posix) {
    candidates.push(posix)
  }

  for (const pattern of [
    /(~\/[^\s"'`<>]*)/giu,
    /([A-Za-z]:[\\/][^\s"'`<>]*)/gu,
    /(\\\\[^\s"'`<>]*)/gu,
    /(file:\/\/[^\s"'`<>]*)/giu,
  ]) {
    for (const match of withoutUrls.matchAll(pattern)) {
      if (match[1]) {
        candidates.push(match[1])
      }
    }
  }

  return candidates.some(isDangerousPath)
}

function stripTokenPunctuation(value: string) {
  const leading =
    value.match(/^["'`([{<（【《〈「『〔［｛“‘]*/u)?.[0] ?? ''
  const trailing =
    value.match(/[.,;:!?)}\]>"'`。，、；：！？）】》〉」』〕］｝”’…]*$/u)?.[0] ?? ''
  const end = value.length - trailing.length

  return {
    leading,
    core: value.slice(leading.length, end),
    trailing,
  }
}

function getUrlRedactionCategory(value: string) {
  try {
    const parsed = new URL(value)

    if (parsed.username || parsed.password) {
      return 'credential-url'
    }
  } catch {
    // Invalid URL-like text still fails closed under the generic URL category.
  }

  return 'url'
}

function deriveLabels(
  value: string,
  pointer: string,
  state: SanitizationState,
) {
  REDACTION_LABEL_PATTERN.lastIndex = 0

  for (const match of value.matchAll(REDACTION_LABEL_PATTERN)) {
    const category = match[1]

    if (
      category &&
      (HandoffPrivacyCategories.has(category as HandoffPrivacyCategory) ||
        category === PATH_REDACTION_CATEGORY ||
        category === 'url' ||
        category === CONTROL_REDACTION_CATEGORY)
    ) {
      addRedaction(state, pointer, category, 'redact')
    }
  }
}

function checkPrivacy(
  value: string,
  state: SanitizationState,
) {
  if (
    state.checkedCharacters + value.length > MAX_HANDOFF_PRIVACY_CHARACTERS
  ) {
    throw new Error(
      `Evidence pack privacy text exceeds the ${MAX_HANDOFF_PRIVACY_CHARACTERS}-character limit.`,
    )
  }

  const result = runHandoffPrivacyPreflight(value)

  if (result.status === 'blocked') {
    throw new Error(
      `Evidence pack privacy preflight blocked export (${result.reason}).`,
    )
  }

  state.checkedCharacters += value.length
  state.findingCount += result.findings.length

  if (state.findingCount > MAX_HANDOFF_PRIVACY_FINDINGS) {
    throw new Error(
      `Evidence pack privacy findings exceed the ${MAX_HANDOFF_PRIVACY_FINDINGS}-finding limit.`,
    )
  }

  return result.redactedMarkdown
}

function sanitizeText(
  value: string,
  pointer: string,
  state: SanitizationState,
) {
  const urlSafeValue = value.replace(
    /https?:\/\/[^\s"'`<>]+/giu,
    (candidate) => {
      const { core, trailing } = stripTokenPunctuation(candidate)
      const normalizedUrl = normalizeExternalUrl(core)

      if (normalizedUrl && !hasSensitiveUrlParameter(normalizedUrl)) {
        return candidate
      }

      const category = getUrlRedactionCategory(core)
      addRedaction(state, pointer, category, 'redact')
      return `[REDACTED: ${category}]${trailing}`
    },
  )

  let sanitized = checkPrivacy(urlSafeValue, state)
  let pathContinuation = false
  let previousTokenEnd = 0

  sanitized = [...sanitized]
    .map((character) => {
      const code = character.charCodeAt(0)
      const unsafe =
        code <= 8 ||
        (code >= 11 && code <= 12) ||
        (code >= 14 && code <= 31) ||
        code === 127

      return unsafe
        ? `[REDACTED: ${CONTROL_REDACTION_CATEGORY}]`
        : character
    })
    .join('')

  sanitized = sanitized.replace(/\S+/gu, (token, offset: number) => {
    const gap = sanitized.slice(previousTokenEnd, offset)
    previousTokenEnd = offset + token.length

    if (/[\r\n]/u.test(gap)) {
      pathContinuation = false
    }

    const { leading, core, trailing } = stripTokenPunctuation(token)

    if (!core) {
      pathContinuation = false
      return token
    }

    let embeddedUrlRedacted = false
    let embeddedUrlCategory = 'url'
    const urlSafeCore = core.replace(
      /https?:\/\/[^\s"'`<>]+/giu,
      (candidate) => {
        const normalizedUrl = normalizeExternalUrl(candidate)

        if (normalizedUrl && !hasSensitiveUrlParameter(normalizedUrl)) {
          return candidate
        }

        embeddedUrlRedacted = true
        embeddedUrlCategory = getUrlRedactionCategory(candidate)
        return `[REDACTED: ${embeddedUrlCategory}]`
      },
    )

    if (embeddedUrlRedacted) {
      pathContinuation = false
      addRedaction(state, pointer, embeddedUrlCategory, 'redact')
      return `${leading}${urlSafeCore}${trailing}`
    }

    const isDangerousPathToken =
      isDangerousTextPathToken(core) || hasEmbeddedDangerousPath(urlSafeCore)

    if (!pathContinuation && !isDangerousPathToken) {
      return token
    }

    pathContinuation = trailing.length === 0
    addRedaction(state, pointer, PATH_REDACTION_CATEGORY, 'redact')
    return `${leading}[REDACTED: ${PATH_REDACTION_CATEGORY}]${trailing}`
  })

  deriveLabels(sanitized, pointer, state)

  return sanitized
}

function sanitizeUrl(
  value: string,
  pointer: string,
  state: SanitizationState,
) {
  const normalized = normalizeExternalUrl(value)

  if (!normalized || hasSensitiveUrlParameter(normalized)) {
    addRedaction(state, pointer, 'url', 'omit')
    return undefined
  }

  return sanitizeText(normalized, pointer, state)
}

function sanitizeFilePath(
  value: string,
  pointer: string,
  state: SanitizationState,
) {
  if (isDangerousPath(value)) {
    addRedaction(state, pointer, PATH_REDACTION_CATEGORY, 'omit')
    return undefined
  }

  const checked = sanitizeText(value, pointer, state)

  if (isDangerousPath(checked)) {
    addRedaction(state, pointer, PATH_REDACTION_CATEGORY, 'omit')
    return undefined
  }

  return checked
}

function hasSensitiveUrlParameter(value: string) {
  let parsed: URL

  try {
    parsed = new URL(value)
  } catch {
    return true
  }

  const isSensitiveName = (name: string) => {
    const { decoded: decodedName, stable } = decodeRepeatedly(name)

    if (!stable) {
      return true
    }

    const normalized = decodedName.toLowerCase().replaceAll(/[-_\s]/gu, '')

    return (
      normalized === 'token' ||
      normalized.includes('token') ||
      normalized.includes('apikey') ||
      normalized.includes('signature') ||
      normalized.includes('secret') ||
      normalized.includes('password') ||
      normalized.includes('auth') ||
      normalized.includes('code')
    )
  }

  for (const [name] of parsed.searchParams) {
    if (isSensitiveName(name)) {
      return true
    }
  }

  const fragment = parsed.hash.replace(/^#/u, '')

  for (const segment of fragment.split(/[&;]/u)) {
    const name = segment.split('=', 1)[0] ?? ''

    if (name && isSensitiveName(name)) {
      return true
    }
  }

  return false
}

function sanitizeProvenance(
  provenance: EvidenceProvenance,
  pointer: string,
  state: SanitizationState,
): EvidenceProvenance {
  addOmission(
    state,
    pointerFor(pointer, 'scanRoot'),
    provenance.scanRoot !== undefined,
  )

  const result: EvidenceProvenance = {
    importer: provenance.importer,
    format: provenance.format,
    sourceName: sanitizeText(
      provenance.sourceName,
      pointerFor(pointer, 'sourceName'),
      state,
    ),
    toolName: provenance.toolName,
    scanComplete: provenance.scanComplete,
    importedAt: sanitizeText(
      provenance.importedAt,
      pointerFor(pointer, 'importedAt'),
      state,
    ),
  }

  if (provenance.producerStatus !== undefined) {
    result.producerStatus = provenance.producerStatus
  }

  if (provenance.producerVersion !== undefined) {
    result.producerVersion = sanitizeText(
      provenance.producerVersion,
      pointerFor(pointer, 'producerVersion'),
      state,
    )
  }

  if (provenance.sourceRevision !== undefined) {
    result.sourceRevision = sanitizeText(
      provenance.sourceRevision,
      pointerFor(pointer, 'sourceRevision'),
      state,
    )
  }

  if (provenance.scopeId !== undefined) {
    result.scopeId = sanitizeText(
      provenance.scopeId,
      pointerFor(pointer, 'scopeId'),
      state,
    )
  }

  if (provenance.ruleId !== undefined) {
    result.ruleId = sanitizeText(
      provenance.ruleId,
      pointerFor(pointer, 'ruleId'),
      state,
    )
  }

  if (provenance.fingerprint !== undefined) {
    result.fingerprint = sanitizeText(
      provenance.fingerprint,
      pointerFor(pointer, 'fingerprint'),
      state,
    )
  }

  if (provenance.findingKey !== undefined) {
    result.findingKey = sanitizeText(
      provenance.findingKey,
      pointerFor(pointer, 'findingKey'),
      state,
    )
  }

  if (provenance.resolution !== undefined) {
    result.resolution = {
      method: provenance.resolution.method,
      format: provenance.resolution.format,
      sourceName: sanitizeText(
        provenance.resolution.sourceName,
        pointerFor(pointerFor(pointer, 'resolution'), 'sourceName'),
        state,
      ),
      importedAt: sanitizeText(
        provenance.resolution.importedAt,
        pointerFor(pointerFor(pointer, 'resolution'), 'importedAt'),
        state,
      ),
    }

    if (provenance.resolution.producerStatus !== undefined) {
      result.resolution.producerStatus = provenance.resolution.producerStatus
    }

    if (provenance.resolution.producerVersion !== undefined) {
      result.resolution.producerVersion = sanitizeText(
        provenance.resolution.producerVersion,
        pointerFor(pointerFor(pointer, 'resolution'), 'producerVersion'),
        state,
      )
    }

    if (provenance.resolution.sourceRevision !== undefined) {
      result.resolution.sourceRevision = sanitizeText(
        provenance.resolution.sourceRevision,
        pointerFor(pointerFor(pointer, 'resolution'), 'sourceRevision'),
        state,
      )
    }
  }

  return result
}

function projectSource(
  source: MissionSource,
  pointer: string,
  state?: SanitizationState,
): MissionSource {
  const result: MissionSource = {
    kind: source.kind,
  }

  const text = (value: string, valuePointer: string) =>
    state ? sanitizeText(value, valuePointer, state) : value

  if (state) {
    addOmission(
      state,
      pointerFor(pointer, 'rawText'),
      source.rawText !== undefined,
    )
  }

  if (source.url !== undefined) {
    const normalized = state
      ? sanitizeUrl(source.url, pointerFor(pointer, 'url'), state)
      : source.url

    if (normalized !== undefined) {
      result.url = normalized
    }
  }

  if (source.parsedRepo !== undefined) {
    result.parsedRepo = text(
      source.parsedRepo,
      pointerFor(pointer, 'parsedRepo'),
    )
  }

  if (source.parsedNumber !== undefined) {
    result.parsedNumber = text(
      source.parsedNumber,
      pointerFor(pointer, 'parsedNumber'),
    )
  }

  return result
}

function projectLane(
  lane: AgentLane,
  pointer: string,
  state?: SanitizationState,
): AgentLane {
  const text = (value: string, key: string) =>
    state ? sanitizeText(value, pointerFor(pointer, key), state) : value

  if (state) {
    addOmission(state, pointerFor(pointer, 'findings'), lane.findings.length > 0)
    addOmission(state, pointerFor(pointer, 'outputDraft'), Boolean(lane.outputDraft))
  }

  return {
    id: text(lane.id, 'id'),
    name: text(lane.name, 'name'),
    role: text(lane.role, 'role'),
    status: lane.status,
    confidence: lane.confidence,
    findings: state ? [] : cloneJson(lane.findings),
    assignedEvidenceIds: lane.assignedEvidenceIds.map((id, index) =>
      state
        ? sanitizeText(id, pointerFor(pointerFor(pointer, 'assignedEvidenceIds'), index), state)
        : id,
    ),
    outputDraft: state ? '' : lane.outputDraft,
  }
}

function projectStage(
  stage: MissionStage,
  pointer: string,
  state?: SanitizationState,
): MissionStage {
  const text = (value: string, key: string) =>
    state ? sanitizeText(value, pointerFor(pointer, key), state) : value

  return {
    id: text(stage.id, 'id'),
    name: text(stage.name, 'name'),
    summary: text(stage.summary, 'summary'),
    nextAction: text(stage.nextAction, 'nextAction'),
    lanes: stage.lanes.map((lane, index) =>
      projectLane(lane, pointerFor(pointerFor(pointer, 'lanes'), index), state),
    ),
  }
}

function projectEvidence(
  item: EvidenceItem,
  pointer: string,
  state?: SanitizationState,
): EvidenceItem {
  const text = (value: string, key: string) =>
    state ? sanitizeText(value, pointerFor(pointer, key), state) : value
  const result: EvidenceItem = {
    id: text(item.id, 'id'),
    kind: item.kind,
    title: text(item.title, 'title'),
    detail: text(item.detail, 'detail'),
    createdAt: text(item.createdAt, 'createdAt'),
    updatedAt: text(item.updatedAt ?? item.createdAt, 'updatedAt'),
  }

  if (state) {
    addOmission(
      state,
      pointerFor(pointer, 'sourceText'),
      item.sourceText !== undefined,
    )
  }

  if (item.url !== undefined) {
    const normalized = state
      ? sanitizeUrl(item.url, pointerFor(pointer, 'url'), state)
      : item.url

    if (normalized !== undefined) {
      result.url = normalized
    }
  }

  if (item.filePath !== undefined) {
    const filePath = state
      ? sanitizeFilePath(item.filePath, pointerFor(pointer, 'filePath'), state)
      : item.filePath

    if (filePath !== undefined) {
      result.filePath = filePath
    }
  }

  if (item.stageId !== undefined) {
    result.stageId = text(item.stageId, 'stageId')
  }

  if (item.agentId !== undefined) {
    result.agentId = text(item.agentId, 'agentId')
  }

  if (item.severity !== undefined) {
    result.severity = item.severity
  }

  if (item.triageStatus !== undefined) {
    result.triageStatus = item.triageStatus
  }

  if (item.resolutionNote !== undefined) {
    result.resolutionNote = text(item.resolutionNote, 'resolutionNote')
  }

  if (item.provenance !== undefined) {
    result.provenance = state
      ? sanitizeProvenance(item.provenance, pointerFor(pointer, 'provenance'), state)
      : cloneJson(item.provenance)
  }

  return result
}

function projectApproval(
  approval: ApprovalGate,
  pointer: string,
  state?: SanitizationState,
): ApprovalGate {
  const text = (value: string, key: string) =>
    state ? sanitizeText(value, pointerFor(pointer, key), state) : value
  const result: ApprovalGate = {
    id: text(approval.id, 'id'),
    label: text(approval.label, 'label'),
    riskLevel: approval.riskLevel,
    requiredBefore: text(approval.requiredBefore, 'requiredBefore'),
    approved: approval.approved,
  }

  if (approval.approvedAt !== undefined) {
    result.approvedAt = text(approval.approvedAt, 'approvedAt')
  }

  return result
}

function projectOutputs(
  mission: Mission,
  pointer: string,
  state?: SanitizationState,
) {
  const outputs = mission.outputs
  const text = (value: string, key: string) =>
    state ? sanitizeText(value, pointerFor(pointer, key), state) : value
  const fieldSources: Record<string, string[]> = {}

  for (const field of FIELD_SOURCE_KEYS) {
    const ids = outputs.fieldSources?.[field]

    if (ids !== undefined) {
      fieldSources[field] = ids.map((id, index) =>
        state
          ? sanitizeText(
              id,
              pointerFor(pointerFor(pointerFor(pointer, 'fieldSources'), field), index),
              state,
            )
          : id,
      )
    }
  }

  return {
    summary: text(outputs.summary, 'summary'),
    patchPlan: text(outputs.patchPlan, 'patchPlan'),
    testPlan: text(outputs.testPlan, 'testPlan'),
    risks: text(outputs.risks, 'risks'),
    maintainerComment: text(outputs.maintainerComment, 'maintainerComment'),
    fieldSources,
    ready: outputs.ready,
  }
}

function projectMission(
  mission: Mission,
  state?: SanitizationState,
): Mission {
  const text = (value: string, pointer: string) =>
    state ? sanitizeText(value, pointer, state) : value

  return {
    id: text(mission.id, '/mission/id'),
    templateId: text(mission.templateId, '/mission/templateId'),
    status: mission.status,
    title: text(mission.title, '/mission/title'),
    source: projectSource(mission.source, '/mission/source', state),
    repo: text(mission.repo, '/mission/repo'),
    branch: text(mission.branch, '/mission/branch'),
    goal: text(mission.goal, '/mission/goal'),
    constraints: mission.constraints.map((constraint, index) =>
      state
        ? sanitizeText(constraint, pointerFor('/mission/constraints', index), state)
        : constraint,
    ),
    stages: mission.stages.map((stage, index) =>
      projectStage(stage, pointerFor('/mission/stages', index), state),
    ),
    activeStageId: text(mission.activeStageId, '/mission/activeStageId'),
    evidence: mission.evidence.map((item, index) =>
      projectEvidence(item, pointerFor('/mission/evidence', index), state),
    ),
    approvals: mission.approvals.map((approval, index) =>
      projectApproval(approval, pointerFor('/mission/approvals', index), state),
    ),
    outputs: projectOutputs(mission, '/mission/outputs', state),
    createdAt: text(mission.createdAt, '/mission/createdAt'),
    updatedAt: text(mission.updatedAt, '/mission/updatedAt'),
  }
}

function createEnvelopeWithoutDigest(
  mission: Mission,
  redactions: EvidencePackRedaction[],
  generatedAt: string,
): Omit<EvidencePack, 'digest'> {
  return {
    format: EVIDENCE_PACK_FORMAT,
    schemaVersion: EVIDENCE_PACK_SCHEMA_VERSION,
    canonicalization: EVIDENCE_PACK_CANONICALIZATION,
    hashAlgorithm: EVIDENCE_PACK_HASH_ALGORITHM,
    authenticity: EVIDENCE_PACK_AUTHENTICITY,
    generatedAt,
    workspaceSchemaVersion: SCHEMA_VERSION,
    mission,
    redactions: sortRedactions(redactions),
  }
}

function recordNormalizationOmissions(
  original: Mission,
  normalized: Mission,
  state: SanitizationState,
) {
  original.evidence.forEach((item, index) => {
    const normalizedItem = normalized.evidence[index]
    const pointer = pointerFor('/mission/evidence', index)

    if (item.url !== undefined && normalizedItem?.url === undefined) {
      addRedaction(state, pointerFor(pointer, 'url'), 'url', 'omit')
    }

    if (item.filePath !== undefined && normalizedItem?.filePath === undefined) {
      addRedaction(
        state,
        pointerFor(pointer, 'filePath'),
        PATH_REDACTION_CATEGORY,
        'omit',
      )
    }

    if (
      item.provenance?.scanRoot !== undefined &&
      normalizedItem?.provenance?.scanRoot === undefined
    ) {
      addOmission(
        state,
        pointerFor(pointerFor(pointer, 'provenance'), 'scanRoot'),
        true,
      )
    }
  })
}

export async function createEvidencePack({
  mission,
  generatedAt = new Date().toISOString(),
}: {
  mission: Mission
  generatedAt?: string
}): Promise<{ pack: EvidencePack; serialized: string; digest: string }> {
  if (!isIsoTimestamp(generatedAt)) {
    throw new Error('Evidence pack generatedAt must be an ISO timestamp.')
  }

  const normalizedMission = normalizeImportedMission(mission, SCHEMA_VERSION)
  const state: SanitizationState = {
    checkedCharacters: 0,
    findingCount: 0,
    redactions: [],
  }
  recordNormalizationOmissions(mission, normalizedMission, state)
  const projectedMission = projectMission(normalizedMission, state)
  const validatedProjectedMission = cloneJson(
    normalizeImportedMission(projectedMission, SCHEMA_VERSION),
  )

  if (
    canonicalize(validatedProjectedMission) !== canonicalize(projectedMission)
  ) {
    throw new Error(
      'Evidence pack privacy-safe projection is not a valid self-contained Mission.',
    )
  }

  const withoutDigest = createEnvelopeWithoutDigest(
    validatedProjectedMission,
    state.redactions,
    generatedAt,
  )
  const digest = await digestCanonicalJson(canonicalize(withoutDigest))
  const pack: EvidencePack = { ...withoutDigest, digest }
  const serialized = canonicalize(pack)

  if (new TextEncoder().encode(serialized).byteLength > MAX_EVIDENCE_PACK_IMPORT_BYTES) {
    throw new Error('Evidence pack exceeds the 1 MB local verification limit.')
  }

  return { pack, serialized, digest }
}

class StrictJsonParser {
  private index = 0
  private readonly input: string

  public constructor(input: string) {
    this.input = input
  }

  public parse() {
    const value = this.parseValue(0)
    this.skipWhitespace()

    if (this.index !== this.input.length) {
      throw new Error('Evidence pack JSON has trailing content.')
    }

    return value
  }

  private skipWhitespace() {
    while (
      this.input[this.index] === ' ' ||
      this.input[this.index] === '\n' ||
      this.input[this.index] === '\r' ||
      this.input[this.index] === '\t'
    ) {
      this.index += 1
    }
  }

  private parseValue(depth: number): unknown {
    this.skipWhitespace()

    if (depth > MAX_WORKSPACE_JSON_DEPTH) {
      throw new Error(
        `Evidence pack JSON exceeds the maximum nesting depth of ${MAX_WORKSPACE_JSON_DEPTH}.`,
      )
    }

    const character = this.input[this.index]

    if (character === '{') {
      return this.parseObject(depth + 1)
    }

    if (character === '[') {
      return this.parseArray(depth + 1)
    }

    if (character === '"') {
      return this.parseString()
    }

    if (this.input.startsWith('true', this.index)) {
      this.index += 4
      return true
    }

    if (this.input.startsWith('false', this.index)) {
      this.index += 5
      return false
    }

    if (this.input.startsWith('null', this.index)) {
      this.index += 4
      return null
    }

    return this.parseNumber()
  }

  private parseObject(depth: number) {
    this.index += 1
    this.skipWhitespace()
    const result: JsonRecord = Object.create(null) as JsonRecord
    const keys = new Set<string>()

    if (this.input[this.index] === '}') {
      this.index += 1
      return result
    }

    while (this.index < this.input.length) {
      this.skipWhitespace()

      if (this.input[this.index] !== '"') {
        throw new Error('Evidence pack JSON object keys must be quoted strings.')
      }

      const key = this.parseString()

      if (keys.has(key)) {
        throw new Error(`Evidence pack JSON contains a duplicate object key: ${key}.`)
      }

      keys.add(key)
      this.skipWhitespace()

      if (this.input[this.index] !== ':') {
        throw new Error('Evidence pack JSON object is missing a colon.')
      }

      this.index += 1
      result[key] = this.parseValue(depth)
      this.skipWhitespace()

      if (this.input[this.index] === '}') {
        this.index += 1
        return result
      }

      if (this.input[this.index] !== ',') {
        throw new Error('Evidence pack JSON object is missing a comma.')
      }

      this.index += 1
    }

    throw new Error('Evidence pack JSON object is unterminated.')
  }

  private parseArray(depth: number) {
    this.index += 1
    this.skipWhitespace()
    const result: unknown[] = []

    if (this.input[this.index] === ']') {
      this.index += 1
      return result
    }

    while (this.index < this.input.length) {
      result.push(this.parseValue(depth))
      this.skipWhitespace()

      if (this.input[this.index] === ']') {
        this.index += 1
        return result
      }

      if (this.input[this.index] !== ',') {
        throw new Error('Evidence pack JSON array is missing a comma.')
      }

      this.index += 1
    }

    throw new Error('Evidence pack JSON array is unterminated.')
  }

  private parseString() {
    const start = this.index
    this.index += 1
    let escaped = false

    while (this.index < this.input.length) {
      const character = this.input[this.index]

      if (escaped) {
        if (character === 'u') {
          const hexadecimal = this.input.slice(this.index + 1, this.index + 5)

          if (!/^[0-9a-f]{4}$/iu.test(hexadecimal)) {
            throw new Error('Evidence pack JSON contains an invalid Unicode escape.')
          }

          this.index += 5
        } else if (!/["\\/bfnrt]/u.test(character)) {
          throw new Error('Evidence pack JSON contains an invalid escape sequence.')
        } else {
          this.index += 1
        }

        escaped = false
        continue
      }

      if (character === '\\') {
        escaped = true
        this.index += 1
        continue
      }

      if (character === '"') {
        this.index += 1
        return JSON.parse(this.input.slice(start, this.index)) as string
      }

      if (character.charCodeAt(0) <= 31) {
        throw new Error('Evidence pack JSON contains an unescaped control character.')
      }

      this.index += 1
    }

    throw new Error('Evidence pack JSON string is unterminated.')
  }

  private parseNumber() {
    const numberPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/uy
    numberPattern.lastIndex = this.index
    const match = numberPattern.exec(this.input)

    if (!match) {
      throw new Error('Evidence pack JSON contains an invalid value.')
    }

    this.index += match[0].length
    const value = Number(match[0])

    if (!Number.isFinite(value)) {
      throw new Error('Evidence pack JSON number is not finite.')
    }

    return value
  }
}

function decodeInput(input: string | Uint8Array) {
  const bytes =
    typeof input === 'string'
      ? new TextEncoder().encode(input)
      : input

  if (bytes.byteLength > MAX_EVIDENCE_PACK_IMPORT_BYTES) {
    throw new Error('Evidence pack import is too large for local preview.')
  }

  if (typeof input === 'string') {
    return input
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('Evidence pack input is not valid UTF-8.')
  }
}

function assertExactKeys(value: JsonRecord, keys: readonly string[], path: string) {
  const allowed = new Set(keys)

  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`Evidence pack contains an unknown field at ${path}/${key}.`)
    }
  }
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string') {
    throw new Error(`Evidence pack field ${path} must be a string.`)
  }
}

function assertOptionalString(value: unknown, path: string) {
  if (value !== undefined) {
    assertString(value, path)
  }
}

function assertStringArray(value: unknown, path: string) {
  if (!Array.isArray(value)) {
    throw new Error(`Evidence pack field ${path} must be an array.`)
  }

  value.forEach((item, index) => assertString(item, `${path}/${index}`))
}

function assertSource(source: unknown, path: string) {
  if (!isRecord(source)) {
    throw new Error(`Evidence pack field ${path} must be an object.`)
  }

  assertExactKeys(source, ['kind', 'url', 'parsedRepo', 'parsedNumber'], path)
  assertString(source.kind, pointerFor(path, 'kind'))
  assertOptionalString(source.url, pointerFor(path, 'url'))
  assertOptionalString(source.parsedRepo, pointerFor(path, 'parsedRepo'))
  assertOptionalString(source.parsedNumber, pointerFor(path, 'parsedNumber'))
}

function assertLane(lane: unknown, path: string) {
  if (!isRecord(lane)) {
    throw new Error(`Evidence pack field ${path} must be an object.`)
  }

  assertExactKeys(
    lane,
    ['id', 'name', 'role', 'status', 'confidence', 'findings', 'assignedEvidenceIds', 'outputDraft'],
    path,
  )
  assertString(lane.id, pointerFor(path, 'id'))
  assertString(lane.name, pointerFor(path, 'name'))
  assertString(lane.role, pointerFor(path, 'role'))
  assertString(lane.status, pointerFor(path, 'status'))

  if (typeof lane.confidence !== 'number' || !Number.isFinite(lane.confidence)) {
    throw new Error(`Evidence pack field ${path}/confidence must be a finite number.`)
  }

  if (!Array.isArray(lane.findings)) {
    throw new Error(`Evidence pack field ${path}/findings must be an array.`)
  }

  lane.findings.forEach((finding, index) => {
    if (!isRecord(finding)) {
      throw new Error(`Evidence pack field ${path}/findings/${index} must be an object.`)
    }

    const findingPath = pointerFor(pointerFor(path, 'findings'), index)
    assertExactKeys(finding, ['id', 'text', 'createdAt'], findingPath)
    assertString(finding.id, pointerFor(findingPath, 'id'))
    assertString(finding.text, pointerFor(findingPath, 'text'))
    assertString(finding.createdAt, pointerFor(findingPath, 'createdAt'))
  })

  assertStringArray(lane.assignedEvidenceIds, pointerFor(path, 'assignedEvidenceIds'))
  assertString(lane.outputDraft, pointerFor(path, 'outputDraft'))
}

function assertStage(stage: unknown, path: string) {
  if (!isRecord(stage)) {
    throw new Error(`Evidence pack field ${path} must be an object.`)
  }

  assertExactKeys(stage, ['id', 'name', 'summary', 'nextAction', 'lanes'], path)
  assertString(stage.id, pointerFor(path, 'id'))
  assertString(stage.name, pointerFor(path, 'name'))
  assertString(stage.summary, pointerFor(path, 'summary'))
  assertString(stage.nextAction, pointerFor(path, 'nextAction'))

  if (!Array.isArray(stage.lanes)) {
    throw new Error(`Evidence pack field ${path}/lanes must be an array.`)
  }

  stage.lanes.forEach((lane, index) =>
    assertLane(lane, pointerFor(pointerFor(path, 'lanes'), index)),
  )
}

function assertResolution(value: unknown, path: string) {
  if (!isRecord(value)) {
    throw new Error(`Evidence pack field ${path} must be an object.`)
  }

  assertExactKeys(
    value,
    [
      'method',
      'format',
      'sourceName',
      'producerStatus',
      'producerVersion',
      'sourceRevision',
      'importedAt',
    ],
    path,
  )
  assertString(value.method, pointerFor(path, 'method'))
  assertString(value.format, pointerFor(path, 'format'))
  assertString(value.sourceName, pointerFor(path, 'sourceName'))
  assertOptionalString(value.producerStatus, pointerFor(path, 'producerStatus'))
  assertOptionalString(value.producerVersion, pointerFor(path, 'producerVersion'))
  assertOptionalString(value.sourceRevision, pointerFor(path, 'sourceRevision'))
  assertString(value.importedAt, pointerFor(path, 'importedAt'))
}

function assertProvenance(value: unknown, path: string) {
  if (!isRecord(value)) {
    throw new Error(`Evidence pack field ${path} must be an object.`)
  }

  assertExactKeys(
    value,
    [
      'importer',
      'format',
      'sourceName',
      'toolName',
      'producerStatus',
      'producerVersion',
      'sourceRevision',
      'scanComplete',
      'importedAt',
      'scopeId',
      'ruleId',
      'fingerprint',
      'findingKey',
      'resolution',
    ],
    path,
  )
  assertString(value.importer, pointerFor(path, 'importer'))
  assertString(value.format, pointerFor(path, 'format'))
  assertString(value.sourceName, pointerFor(path, 'sourceName'))
  assertString(value.toolName, pointerFor(path, 'toolName'))
  assertOptionalString(value.producerStatus, pointerFor(path, 'producerStatus'))
  assertOptionalString(value.producerVersion, pointerFor(path, 'producerVersion'))
  assertOptionalString(value.sourceRevision, pointerFor(path, 'sourceRevision'))

  if (typeof value.scanComplete !== 'boolean') {
    throw new Error(`Evidence pack field ${path}/scanComplete must be a boolean.`)
  }

  assertString(value.importedAt, pointerFor(path, 'importedAt'))
  assertOptionalString(value.scopeId, pointerFor(path, 'scopeId'))
  assertOptionalString(value.ruleId, pointerFor(path, 'ruleId'))
  assertOptionalString(value.fingerprint, pointerFor(path, 'fingerprint'))
  assertOptionalString(value.findingKey, pointerFor(path, 'findingKey'))

  if (value.resolution !== undefined) {
    assertResolution(value.resolution, pointerFor(path, 'resolution'))
  }
}

function assertEvidence(value: unknown, path: string) {
  if (!isRecord(value)) {
    throw new Error(`Evidence pack field ${path} must be an object.`)
  }

  assertExactKeys(
    value,
    [
      'id',
      'kind',
      'title',
      'detail',
      'url',
      'filePath',
      'stageId',
      'agentId',
      'severity',
      'triageStatus',
      'resolutionNote',
      'provenance',
      'createdAt',
      'updatedAt',
    ],
    path,
  )
  assertString(value.id, pointerFor(path, 'id'))
  assertString(value.kind, pointerFor(path, 'kind'))
  assertString(value.title, pointerFor(path, 'title'))
  assertString(value.detail, pointerFor(path, 'detail'))
  assertOptionalString(value.url, pointerFor(path, 'url'))
  assertOptionalString(value.filePath, pointerFor(path, 'filePath'))
  assertOptionalString(value.stageId, pointerFor(path, 'stageId'))
  assertOptionalString(value.agentId, pointerFor(path, 'agentId'))
  assertOptionalString(value.severity, pointerFor(path, 'severity'))
  assertOptionalString(value.triageStatus, pointerFor(path, 'triageStatus'))
  assertOptionalString(value.resolutionNote, pointerFor(path, 'resolutionNote'))

  if (value.provenance !== undefined) {
    assertProvenance(value.provenance, pointerFor(path, 'provenance'))
  }

  assertString(value.createdAt, pointerFor(path, 'createdAt'))
  assertOptionalString(value.updatedAt, pointerFor(path, 'updatedAt'))
}

function assertApproval(value: unknown, path: string) {
  if (!isRecord(value)) {
    throw new Error(`Evidence pack field ${path} must be an object.`)
  }

  assertExactKeys(value, ['id', 'label', 'riskLevel', 'requiredBefore', 'approved', 'approvedAt'], path)
  assertString(value.id, pointerFor(path, 'id'))
  assertString(value.label, pointerFor(path, 'label'))
  assertString(value.riskLevel, pointerFor(path, 'riskLevel'))
  assertString(value.requiredBefore, pointerFor(path, 'requiredBefore'))

  if (typeof value.approved !== 'boolean') {
    throw new Error(`Evidence pack field ${path}/approved must be a boolean.`)
  }

  assertOptionalString(value.approvedAt, pointerFor(path, 'approvedAt'))
}

function assertOutputs(value: unknown, path: string) {
  if (!isRecord(value)) {
    throw new Error(`Evidence pack field ${path} must be an object.`)
  }

  assertExactKeys(
    value,
    ['summary', 'patchPlan', 'testPlan', 'risks', 'maintainerComment', 'fieldSources', 'ready'],
    path,
  )
  assertString(value.summary, pointerFor(path, 'summary'))
  assertString(value.patchPlan, pointerFor(path, 'patchPlan'))
  assertString(value.testPlan, pointerFor(path, 'testPlan'))
  assertString(value.risks, pointerFor(path, 'risks'))
  assertString(value.maintainerComment, pointerFor(path, 'maintainerComment'))

  if (!isRecord(value.fieldSources)) {
    throw new Error(`Evidence pack field ${path}/fieldSources must be an object.`)
  }

  assertExactKeys(value.fieldSources, FIELD_SOURCE_KEYS, pointerFor(path, 'fieldSources'))

  for (const field of FIELD_SOURCE_KEYS) {
    const ids = value.fieldSources[field]

    if (ids !== undefined) {
      assertStringArray(ids, pointerFor(pointerFor(path, 'fieldSources'), field))
    }
  }

  if (typeof value.ready !== 'boolean') {
    throw new Error(`Evidence pack field ${path}/ready must be a boolean.`)
  }
}

function assertMission(value: unknown, path = '/mission') {
  if (!isRecord(value)) {
    throw new Error(`Evidence pack field ${path} must be an object.`)
  }

  assertExactKeys(
    value,
    [
      'id',
      'templateId',
      'status',
      'title',
      'source',
      'repo',
      'branch',
      'goal',
      'constraints',
      'stages',
      'activeStageId',
      'evidence',
      'approvals',
      'outputs',
      'createdAt',
      'updatedAt',
    ],
    path,
  )
  assertString(value.id, pointerFor(path, 'id'))
  assertString(value.templateId, pointerFor(path, 'templateId'))
  assertOptionalString(value.status, pointerFor(path, 'status'))
  assertString(value.title, pointerFor(path, 'title'))
  assertSource(value.source, pointerFor(path, 'source'))
  assertString(value.repo, pointerFor(path, 'repo'))
  assertString(value.branch, pointerFor(path, 'branch'))
  assertString(value.goal, pointerFor(path, 'goal'))
  assertStringArray(value.constraints, pointerFor(path, 'constraints'))

  if (!Array.isArray(value.stages)) {
    throw new Error(`Evidence pack field ${path}/stages must be an array.`)
  }

  value.stages.forEach((stage, index) =>
    assertStage(stage, pointerFor(pointerFor(path, 'stages'), index)),
  )
  assertString(value.activeStageId, pointerFor(path, 'activeStageId'))

  if (!Array.isArray(value.evidence)) {
    throw new Error(`Evidence pack field ${path}/evidence must be an array.`)
  }

  value.evidence.forEach((item, index) =>
    assertEvidence(item, pointerFor(pointerFor(path, 'evidence'), index)),
  )

  if (!Array.isArray(value.approvals)) {
    throw new Error(`Evidence pack field ${path}/approvals must be an array.`)
  }

  value.approvals.forEach((approval, index) =>
    assertApproval(approval, pointerFor(pointerFor(path, 'approvals'), index)),
  )
  assertOutputs(value.outputs, pointerFor(path, 'outputs'))
  assertString(value.createdAt, pointerFor(path, 'createdAt'))
  assertString(value.updatedAt, pointerFor(path, 'updatedAt'))
}

function assertRedactions(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error('Evidence pack redactions must be an array.')
  }

  const redactions: EvidencePackRedaction[] = []

  value.forEach((candidate, index) => {
    if (!isRecord(candidate)) {
      throw new Error(`Evidence pack redaction ${index} must be an object.`)
    }

    const path = `/redactions/${index}`
    assertExactKeys(candidate, ['pointer', 'category', 'action'], path)
    assertString(candidate.pointer, pointerFor(path, 'pointer'))
    assertString(candidate.category, pointerFor(path, 'category'))
    assertString(candidate.action, pointerFor(path, 'action'))

    const pointer = candidate.pointer
    const category = candidate.category
    const action = candidate.action

    if (
      !pointer.startsWith('/') ||
      !/^\/mission(?:\/|$)/u.test(pointer)
    ) {
      throw new Error(`Evidence pack redaction pointer ${pointer} is invalid.`)
    }

    if (!REDACTION_ACTIONS.includes(action as EvidencePackRedaction['action'])) {
      throw new Error(`Evidence pack redaction action ${action} is invalid.`)
    }

    redactions.push({
      pointer,
      category,
      action: action as EvidencePackRedaction['action'],
    })
  })

  const sorted = sortRedactions(redactions)

  if (canonicalize(sorted) !== canonicalize(redactions)) {
    throw new Error('Evidence pack redactions are not in stable order.')
  }

  const unique = new Set(redactions.map((redaction) => canonicalize(redaction)))

  if (unique.size !== redactions.length) {
    throw new Error('Evidence pack redactions contain duplicate entries.')
  }

  return redactions
}

function assertOriginalUrlAndPathSafety(mission: unknown) {
  if (!isRecord(mission) || !isRecord(mission.source)) {
    return
  }

  const sourceUrl = mission.source.url

  if (
    typeof sourceUrl === 'string' &&
    (!normalizeExternalUrl(sourceUrl) || hasSensitiveUrlParameter(sourceUrl))
  ) {
    throw new Error('Evidence pack contains an unsafe source URL.')
  }

  if (Array.isArray(mission.evidence)) {
    mission.evidence.forEach((candidate) => {
      if (!isRecord(candidate)) {
        return
      }

      if (
        typeof candidate.url === 'string' &&
        (!normalizeExternalUrl(candidate.url) || hasSensitiveUrlParameter(candidate.url))
      ) {
        throw new Error('Evidence pack contains an unsafe evidence URL.')
      }

      if (typeof candidate.filePath === 'string' && isDangerousPath(candidate.filePath)) {
        throw new Error('Evidence pack contains an unsafe file path.')
      }
    })
  }
}

function omissionIsAllowed(
  redaction: EvidencePackRedaction,
  mission: Mission,
) {
  if (redaction.action !== 'omit') {
    return false
  }

  if (
    redaction.category === FIXED_REDACTION_CATEGORY &&
    redaction.pointer === '/mission/source/rawText'
  ) {
    return mission.source.rawText === undefined
  }

  if (
    redaction.category === 'url' &&
    redaction.pointer === '/mission/source/url'
  ) {
    return mission.source.url === undefined
  }

  const evidenceMatch = redaction.pointer.match(
    /^\/mission\/evidence\/(0|[1-9]\d*)\/(sourceText|url|filePath|provenance\/scanRoot)$/u,
  )

  if (evidenceMatch) {
    const item = mission.evidence[Number(evidenceMatch[1])]
    const field = evidenceMatch[2]

    if (!item) {
      return false
    }

    if (field === 'sourceText') {
      return (
        redaction.category === FIXED_REDACTION_CATEGORY &&
        item.sourceText === undefined
      )
    }

    if (field === 'url') {
      return redaction.category === 'url' && item.url === undefined
    }

    if (field === 'filePath') {
      return (
        redaction.category === PATH_REDACTION_CATEGORY &&
        item.filePath === undefined
      )
    }

    return (
      redaction.category === FIXED_REDACTION_CATEGORY &&
      item.provenance !== undefined &&
      item.provenance.scanRoot === undefined
    )
  }

  const laneMatch = redaction.pointer.match(
    /^\/mission\/stages\/(0|[1-9]\d*)\/lanes\/(0|[1-9]\d*)\/(findings|outputDraft)$/u,
  )

  if (!laneMatch || redaction.category !== FIXED_REDACTION_CATEGORY) {
    return false
  }

  const lane =
    mission.stages[Number(laneMatch[1])]?.lanes[Number(laneMatch[2])]

  return laneMatch[3] === 'findings'
    ? lane?.findings.length === 0
    : lane?.outputDraft === ''
}

function validateEnvelopeTopLevel(value: unknown): asserts value is JsonRecord {
  if (!isRecord(value)) {
    throw new Error('Evidence pack envelope must be a JSON object.')
  }

  assertExactKeys(
    value,
    [
      'format',
      'schemaVersion',
      'canonicalization',
      'hashAlgorithm',
      'authenticity',
      'generatedAt',
      'workspaceSchemaVersion',
      'mission',
      'redactions',
      'digest',
    ],
    '',
  )
  assertString(value.format, '/format')
  assertString(value.canonicalization, '/canonicalization')
  assertString(value.hashAlgorithm, '/hashAlgorithm')
  assertString(value.authenticity, '/authenticity')
  assertString(value.generatedAt, '/generatedAt')
  assertString(value.digest, '/digest')

  if (value.format !== EVIDENCE_PACK_FORMAT) {
    throw new Error('Evidence pack format is unsupported.')
  }

  if (value.schemaVersion !== EVIDENCE_PACK_SCHEMA_VERSION) {
    throw new Error(`Evidence pack schema ${String(value.schemaVersion)} is unsupported.`)
  }

  if (value.canonicalization !== EVIDENCE_PACK_CANONICALIZATION) {
    throw new Error('Evidence pack canonicalization is unsupported.')
  }

  if (value.hashAlgorithm !== EVIDENCE_PACK_HASH_ALGORITHM) {
    throw new Error('Evidence pack hash algorithm is unsupported.')
  }

  if (value.authenticity !== EVIDENCE_PACK_AUTHENTICITY) {
    throw new Error('Evidence pack authenticity must be unverified.')
  }

  if (!isIsoTimestamp(value.generatedAt)) {
    throw new Error('Evidence pack generatedAt must be an ISO timestamp.')
  }

  if (
    typeof value.workspaceSchemaVersion !== 'number' ||
    !Number.isInteger(value.workspaceSchemaVersion) ||
    value.workspaceSchemaVersion < 1
  ) {
    throw new Error('Evidence pack workspace schema version is invalid.')
  }

  if (value.workspaceSchemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Evidence pack workspace schema ${value.workspaceSchemaVersion} must match supported schema ${SCHEMA_VERSION}.`,
    )
  }

  if (!/^[0-9a-f]{64}$/iu.test(value.digest as string)) {
    throw new Error('Evidence pack digest must be a 64-character hexadecimal SHA-256 digest.')
  }
}

function createVerification(
  pack: EvidencePack,
  digest: string,
): EvidencePackVerification {
  return {
    ok: true,
    valid: true,
    status: 'verified',
    pack,
    digest,
  }
}

export async function verifyEvidencePack(
  input: string | Uint8Array,
  expectedDigest?: string,
): Promise<EvidencePackVerification> {
  if (
    expectedDigest !== undefined &&
    !/^[0-9a-f]{64}$/iu.test(expectedDigest)
  ) {
    throw new Error('Expected evidence pack digest must be a 64-character hexadecimal SHA-256 digest.')
  }

  const rawJson = decodeInput(input)
  const parsed: unknown = new StrictJsonParser(rawJson).parse()
  validateEnvelopeTopLevel(parsed)

  const digest = await digestCanonicalJson(
    canonicalize({
      format: parsed.format,
      schemaVersion: parsed.schemaVersion,
      canonicalization: parsed.canonicalization,
      hashAlgorithm: parsed.hashAlgorithm,
      authenticity: parsed.authenticity,
      generatedAt: parsed.generatedAt,
      workspaceSchemaVersion: parsed.workspaceSchemaVersion,
      mission: parsed.mission,
      redactions: parsed.redactions,
    }),
  )

  if (digest !== String(parsed.digest).toLowerCase()) {
    throw new Error('Evidence pack digest does not match its canonical envelope.')
  }

  if (expectedDigest !== undefined && digest !== expectedDigest.toLowerCase()) {
    throw new Error('Evidence pack digest does not match the expected digest.')
  }

  assertMission(parsed.mission)
  const suppliedRedactions = assertRedactions(parsed.redactions)
  assertOriginalUrlAndPathSafety(parsed.mission)

  const normalizedMission = normalizeImportedMission(
    parsed.mission,
    parsed.workspaceSchemaVersion as number,
  )
  const rawProjection = projectMission(normalizedMission)

  if (canonicalize(parsed.mission) !== canonicalize(rawProjection)) {
    throw new Error(
      'Evidence pack mission is not canonical for its declared workspace schema.',
    )
  }

  const state: SanitizationState = {
    checkedCharacters: 0,
    findingCount: 0,
    redactions: [],
  }
  const sanitizedMission = projectMission(normalizedMission, state)

  if (canonicalize(rawProjection) !== canonicalize(sanitizedMission)) {
    throw new Error(
      'Evidence pack mission is not the canonical privacy-safe projection.',
    )
  }

  const carriedOmissions = suppliedRedactions.filter((redaction) =>
    omissionIsAllowed(redaction, normalizedMission),
  )
  const expectedRedactions = sortRedactions([
    ...state.redactions,
    ...carriedOmissions,
  ])

  if (canonicalize(expectedRedactions) !== canonicalize(suppliedRedactions)) {
    throw new Error('Evidence pack redactions do not match the canonical projection.')
  }

  const pack = parsed as unknown as EvidencePack

  return createVerification(pack, digest)
}

function isVerification(value: EvidencePackVerification | EvidencePack): value is EvidencePackVerification {
  const candidate = value as unknown as JsonRecord
  return isRecord(candidate) && candidate.ok === true && isRecord(candidate.pack)
}

export function mergeEvidencePackIntoWorkspace(
  workspace: WorkspaceState,
  verificationOrPack: EvidencePackVerification | EvidencePack,
): WorkspaceState {
  const pack = isVerification(verificationOrPack)
    ? verificationOrPack.pack
    : verificationOrPack
  const mission = cloneJson(pack.mission)
  const existingIndex = workspace.missions.findIndex((item) => item.id === mission.id)

  const missions =
    existingIndex >= 0
      ? workspace.missions.map((item, index) =>
          index === existingIndex ? mission : item,
        )
      : [mission, ...workspace.missions]

  return {
    ...workspace,
    missions,
    activeMissionId: mission.id,
  }
}
