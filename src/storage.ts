import { createSeedMission, missionTemplates } from './templates'
import { normalizeExternalUrl } from './safeUrl'
import { deriveScanScopeId } from './scanIdentity'
import {
  MAX_RESOLUTION_NOTE_LENGTH,
  normalizeResolutionNote,
} from './scannerTriage'
import type {
  EvidenceProvenance,
  EvidenceTriageStatus,
  HandoffFieldSources,
  MissionStatus,
  MissionStatusFilter,
  Mission,
  ScanSeverity,
  WorkspaceState,
} from './types'

export const WORKSPACE_STORAGE_KEY = 'patchhive.workspace.v1'
export const SCHEMA_VERSION = 8
export const MAX_WORKSPACE_IMPORT_BYTES = 1_000_000
export const MAX_WORKSPACE_JSON_DEPTH = 64
export const WORKSPACE_RECOVERY_FORMAT = 'patchhive.storage-recovery.v1'

export type WorkspaceLoadResult =
  | {
      status: 'missing' | 'valid' | 'migrated'
      workspace: WorkspaceState
      storedRaw: string | null
    }
  | {
      status: 'corrupt'
      workspace: WorkspaceState
      rawPayload: string
      storedRaw: string
    }
  | {
      status: 'future-schema'
      workspace: WorkspaceState
      rawPayload: string
      schemaVersion: number
      storedRaw: string
    }
  | {
      status: 'unavailable'
      workspace: WorkspaceState
      errorName: string
    }

export type WorkspaceStorageExpectation =
  | {
      status: 'known'
      storedRaw: string | null
    }
  | {
      status: 'unknown'
    }

export type WorkspaceSaveResult =
  | { status: 'saved'; storedRaw: string }
  | { status: 'conflict'; actualRaw: string | null }
  | { status: 'quota'; errorName: string; observedRaw?: string | null }
  | { status: 'unavailable'; errorName: string; observedRaw?: string | null }

export type WorkspaceClearResult =
  | { status: 'saved'; storedRaw: null }
  | { status: 'conflict'; actualRaw: string | null }
  | { status: 'quota'; errorName: string; observedRaw?: string | null }
  | { status: 'unavailable'; errorName: string; observedRaw?: string | null }

export type WorkspaceImportPreview = {
  workspace: WorkspaceState
  missionCount: number
  evidenceCount: number
  archivedCount: number
  schemaVersion: number
  warnings: string[]
}

export function createDefaultWorkspace(): WorkspaceState {
  const seedMission = createSeedMission()

  return {
    missions: [seedMission],
    activeMissionId: seedMission.id,
    templates: missionTemplates,
    settings: {
      schemaVersion: SCHEMA_VERSION,
      density: 'compact',
      missionStatusFilter: 'all',
      mobilePanel: 'work',
      showGuidance: true,
    },
  }
}

function isMissionStatus(value: unknown): value is MissionStatus {
  return value === 'active' || value === 'ready' || value === 'archived'
}

function isMissionStatusFilter(value: unknown): value is MissionStatusFilter {
  return value === 'all' || isMissionStatus(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function hasUniqueIds(items: Array<{ id: string }>) {
  return new Set(items.map((item) => item.id)).size === items.length
}

function isScanSeverity(value: unknown): value is ScanSeverity {
  return (
    value === 'critical' ||
    value === 'high' ||
    value === 'medium' ||
    value === 'low' ||
    value === 'info'
  )
}

function isTriageStatus(value: unknown): value is EvidenceTriageStatus {
  return value === 'open' || value === 'accepted' || value === 'resolved'
}

function isScannerResolution(value: unknown) {
  return (
    isRecord(value) &&
    value.method === 'complete-rerun' &&
    (value.format === 'json' || value.format === 'sarif') &&
    typeof value.sourceName === 'string' &&
    (value.producerStatus === undefined ||
      value.producerStatus === 'declared' ||
      value.producerStatus === 'unverified') &&
    (value.producerVersion === undefined || typeof value.producerVersion === 'string') &&
    (value.sourceRevision === undefined ||
      (typeof value.sourceRevision === 'string' &&
        /^[0-9a-f]{7,64}$/.test(value.sourceRevision))) &&
    typeof value.importedAt === 'string'
  )
}

function isEvidenceProvenance(value: unknown): value is EvidenceProvenance {
  return (
    isRecord(value) &&
    value.importer === 'agent-hygiene' &&
    (value.format === 'json' || value.format === 'sarif') &&
    typeof value.sourceName === 'string' &&
    value.toolName === 'agent-hygiene' &&
    (value.producerStatus === undefined ||
      value.producerStatus === 'declared' ||
      value.producerStatus === 'unverified') &&
    (value.producerVersion === undefined || typeof value.producerVersion === 'string') &&
    (value.sourceRevision === undefined ||
      (typeof value.sourceRevision === 'string' &&
        /^[0-9a-f]{7,64}$/.test(value.sourceRevision))) &&
    typeof value.scanComplete === 'boolean' &&
    typeof value.importedAt === 'string' &&
    (value.scanRoot === undefined || typeof value.scanRoot === 'string') &&
    (value.scopeId === undefined || typeof value.scopeId === 'string') &&
    (value.ruleId === undefined || typeof value.ruleId === 'string') &&
    (value.fingerprint === undefined || typeof value.fingerprint === 'string') &&
    (value.findingKey === undefined || typeof value.findingKey === 'string') &&
    (value.resolution === undefined || isScannerResolution(value.resolution))
  )
}

function sanitizeEvidenceProvenance(provenance?: EvidenceProvenance) {
  if (!provenance) {
    return undefined
  }

  let decodedScanRoot = provenance.scanRoot

  if (decodedScanRoot) {
    try {
      decodedScanRoot = decodeURIComponent(decodedScanRoot)
    } catch {
      // Keep malformed percent escapes literal.
    }
  }

  const normalizedScanRoot = decodedScanRoot?.replaceAll('\\', '/')
  const hasUnsafeScanRoot =
    normalizedScanRoot !== undefined &&
    (normalizedScanRoot.startsWith('/') ||
      normalizedScanRoot === '~' ||
      normalizedScanRoot.startsWith('~/') ||
      /^[A-Za-z]:/.test(normalizedScanRoot) ||
      normalizedScanRoot.split('/').includes('..'))
  const scopeId =
    provenance.scopeId ?? deriveScanScopeId(provenance.scanRoot, provenance.sourceName)

  return {
    ...provenance,
    producerStatus: provenance.producerStatus ?? 'unverified',
    scanRoot: hasUnsafeScanRoot ? undefined : provenance.scanRoot,
    scopeId,
  }
}

function sanitizeScannerFilePath(filePath?: string) {
  if (!filePath) {
    return undefined
  }

  let decodedPath = filePath

  try {
    decodedPath = decodeURIComponent(filePath)
  } catch {
    // Keep malformed percent escapes literal.
  }

  const pathWithoutLine = decodedPath.replace(/:\d+$/, '')
  const normalized = pathWithoutLine.replaceAll('\\', '/')

  if (
    /[\r\n\t]/.test(filePath) ||
    normalized.startsWith('/') ||
    normalized === '~' ||
    normalized.startsWith('~/') ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split('/').includes('..') ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(normalized)
  ) {
    return undefined
  }

  return filePath
}

function isLane(value: unknown) {
  if (!isRecord(value)) return false

  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.role === 'string' &&
    (value.status === 'idle' ||
      value.status === 'scanning' ||
      value.status === 'drafting' ||
      value.status === 'waiting' ||
      value.status === 'ready' ||
      value.status === 'blocked') &&
    typeof value.confidence === 'number' &&
    Number.isFinite(value.confidence) &&
    Array.isArray(value.findings) &&
    value.findings.every(
      (finding) =>
        isRecord(finding) &&
        typeof finding.id === 'string' &&
        typeof finding.text === 'string' &&
        typeof finding.createdAt === 'string',
    ) &&
    isStringArray(value.assignedEvidenceIds) &&
    typeof value.outputDraft === 'string'
  )
}

function isStage(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.summary === 'string' &&
    typeof value.nextAction === 'string' &&
    Array.isArray(value.lanes) &&
    value.lanes.every(isLane)
  )
}

function isEvidence(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    (value.kind === 'file' ||
      value.kind === 'log' ||
      value.kind === 'decision' ||
      value.kind === 'link' ||
      value.kind === 'diff') &&
    typeof value.title === 'string' &&
    typeof value.detail === 'string' &&
    (value.sourceText === undefined || typeof value.sourceText === 'string') &&
    (value.url === undefined || typeof value.url === 'string') &&
    (value.filePath === undefined || typeof value.filePath === 'string') &&
    typeof value.createdAt === 'string' &&
    (value.updatedAt === undefined || typeof value.updatedAt === 'string') &&
    (value.stageId === undefined || typeof value.stageId === 'string') &&
    (value.agentId === undefined || typeof value.agentId === 'string') &&
    (value.severity === undefined || isScanSeverity(value.severity)) &&
    (value.triageStatus === undefined || isTriageStatus(value.triageStatus)) &&
    (value.resolutionNote === undefined ||
      (typeof value.resolutionNote === 'string' &&
        value.resolutionNote.length <= MAX_RESOLUTION_NOTE_LENGTH)) &&
    (value.provenance === undefined || isEvidenceProvenance(value.provenance))
  )
}

function isApproval(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    (value.riskLevel === 'low' ||
      value.riskLevel === 'medium' ||
      value.riskLevel === 'high') &&
    typeof value.requiredBefore === 'string' &&
    typeof value.approved === 'boolean' &&
    (value.approvedAt === undefined || typeof value.approvedAt === 'string')
  )
}

function isOutputs(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.summary === 'string' &&
    typeof value.patchPlan === 'string' &&
    typeof value.testPlan === 'string' &&
    typeof value.risks === 'string' &&
    typeof value.maintainerComment === 'string' &&
    typeof value.ready === 'boolean' &&
    (value.fieldSources === undefined ||
      (isRecord(value.fieldSources) && Object.values(value.fieldSources).every(isStringArray)))
  )
}

function isMission(value: unknown): value is Mission {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.templateId === 'string' &&
    (value.status === undefined || isMissionStatus(value.status)) &&
    typeof value.title === 'string' &&
    isRecord(value.source) &&
    (value.source.kind === 'github-url' ||
      value.source.kind === 'manual' ||
      value.source.kind === 'diff-paste' ||
      value.source.kind === 'log-paste') &&
    (value.source.url === undefined || typeof value.source.url === 'string') &&
    (value.source.rawText === undefined || typeof value.source.rawText === 'string') &&
    (value.source.parsedRepo === undefined || typeof value.source.parsedRepo === 'string') &&
    (value.source.parsedNumber === undefined || typeof value.source.parsedNumber === 'string') &&
    typeof value.repo === 'string' &&
    typeof value.branch === 'string' &&
    typeof value.goal === 'string' &&
    isStringArray(value.constraints) &&
    Array.isArray(value.stages) &&
    value.stages.length > 0 &&
    value.stages.every(isStage) &&
    typeof value.activeStageId === 'string' &&
    Array.isArray(value.evidence) &&
    value.evidence.every(isEvidence) &&
    Array.isArray(value.approvals) &&
    value.approvals.every(isApproval) &&
    isOutputs(value.outputs) &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  )
}

function isWorkspace(value: unknown): value is WorkspaceState {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as WorkspaceState
  const structurallyValid =
    Array.isArray(candidate.missions) &&
    candidate.missions.every(isMission) &&
    typeof candidate.activeMissionId === 'string' &&
    Number.isInteger(candidate.settings?.schemaVersion) &&
    candidate.settings.schemaVersion >= 1 &&
    candidate.settings.schemaVersion <= SCHEMA_VERSION

  if (!structurallyValid || !hasUniqueIds(candidate.missions)) {
    return false
  }

  return candidate.missions.every(
    (mission) =>
      hasUniqueIds(mission.stages) &&
      hasUniqueIds(mission.evidence) &&
      hasUniqueIds(mission.approvals) &&
      mission.stages.every(
        (stage) =>
          hasUniqueIds(stage.lanes) &&
          stage.lanes.every((lane) => hasUniqueIds(lane.findings)),
      ),
  )
}

function migrateWorkspace(candidate: WorkspaceState): WorkspaceState {
  const activeMissionId = candidate.missions.some((mission) => mission.id === candidate.activeMissionId)
    ? candidate.activeMissionId
    : candidate.missions[0]?.id
  const defaultWorkspace = createDefaultWorkspace()
  const legacyEvidenceStageMigration = candidate.settings.schemaVersion < 4

  if (!activeMissionId) {
    return defaultWorkspace
  }

  return {
    ...candidate,
    activeMissionId,
    templates: missionTemplates,
    missions: candidate.missions.map((mission) => {
      const stageIds = new Set(mission.stages.map((stage) => stage.id))
      const activeStageId = stageIds.has(mission.activeStageId)
        ? mission.activeStageId
        : mission.stages[0].id
      const laneIdsByStage = new Map(
        mission.stages.map((stage) => [
          stage.id,
          new Set(stage.lanes.map((lane) => lane.id)),
        ]),
      )
      const allLaneIds = new Set(
        mission.stages.flatMap((stage) => stage.lanes.map((lane) => lane.id)),
      )
      const evidence = (mission.evidence ?? []).map((item) => {
        const provenance = sanitizeEvidenceProvenance(item.provenance)
        const candidateStageId =
          item.stageId || (legacyEvidenceStageMigration ? activeStageId : undefined)
        const stageId =
          candidateStageId && stageIds.has(candidateStageId)
            ? candidateStageId
            : undefined
        const validLaneIds = stageId
          ? (laneIdsByStage.get(stageId) ?? new Set<string>())
          : allLaneIds
        const agentId =
          item.agentId && validLaneIds.has(item.agentId)
            ? item.agentId
            : undefined
        const candidateTriageStatus =
          provenance && !provenance.scanComplete
            ? 'open' as const
            : isTriageStatus(item.triageStatus)
              ? item.triageStatus
              : provenance
                ? 'open'
                : undefined
        const isScannerRisk =
          Boolean(
            provenance?.ruleId &&
              provenance.ruleId !== 'scan/summary' &&
              !provenance.ruleId.startsWith('discovery/'),
          )
        const triageStatus =
          isScannerRisk &&
          candidateTriageStatus === 'resolved' &&
          provenance?.resolution?.method !== 'complete-rerun'
            ? 'open'
            : candidateTriageStatus
        const normalizedProvenance = provenance
          ? {
              ...provenance,
              resolution:
                isScannerRisk &&
                triageStatus === 'resolved' &&
                provenance.resolution?.method === 'complete-rerun'
                  ? provenance.resolution
                  : undefined,
            }
          : undefined

        return {
          ...item,
          url: item.url ? normalizeExternalUrl(item.url) : undefined,
          filePath: provenance
            ? sanitizeScannerFilePath(item.filePath)
            : item.filePath,
          stageId,
          agentId,
          triageStatus,
          resolutionNote:
            provenance && triageStatus === 'accepted'
              ? normalizeResolutionNote(item.resolutionNote)
              : undefined,
          provenance: normalizedProvenance,
          updatedAt: item.updatedAt ?? item.createdAt ?? new Date().toISOString(),
        }
      })
      const evidenceIds = new Set(evidence.map((item) => item.id))
      const normalizeSources = (fieldSources?: HandoffFieldSources): HandoffFieldSources =>
        Object.fromEntries(
          Object.entries(fieldSources ?? {}).map(([field, ids]) => [
            field,
            Array.isArray(ids) ? ids.filter((id) => evidenceIds.has(id)) : [],
          ]),
        ) as HandoffFieldSources

      return {
        ...mission,
        activeStageId,
        status: isMissionStatus(mission.status) ? mission.status : 'active',
        evidence,
        stages: mission.stages.map((stage) => ({
          ...stage,
          lanes: stage.lanes.map((lane) => ({
            ...lane,
            assignedEvidenceIds: lane.assignedEvidenceIds.filter((id) =>
              evidenceIds.has(id),
            ),
          })),
        })),
        outputs: {
          summary: mission.outputs?.summary ?? mission.goal ?? '',
          patchPlan: mission.outputs?.patchPlan ?? '',
          testPlan: mission.outputs?.testPlan ?? '',
          risks: mission.outputs?.risks ?? 'Risk review pending.',
          maintainerComment: mission.outputs?.maintainerComment ?? '',
          fieldSources: normalizeSources(mission.outputs?.fieldSources),
          ready: mission.outputs?.ready ?? false,
        },
      }
    }),
    settings: {
      ...candidate.settings,
      schemaVersion: SCHEMA_VERSION,
      density:
        candidate.settings?.density === 'comfortable' ||
        candidate.settings?.density === 'compact'
          ? candidate.settings.density
          : defaultWorkspace.settings.density,
      missionStatusFilter: isMissionStatusFilter(candidate.settings?.missionStatusFilter)
        ? candidate.settings.missionStatusFilter
        : defaultWorkspace.settings.missionStatusFilter,
      mobilePanel:
        candidate.settings?.mobilePanel === 'missions' ||
        candidate.settings?.mobilePanel === 'work' ||
        candidate.settings?.mobilePanel === 'inspector'
          ? candidate.settings.mobilePanel
          : defaultWorkspace.settings.mobilePanel,
      showGuidance:
        typeof candidate.settings?.showGuidance === 'boolean'
          ? candidate.settings.showGuidance
          : defaultWorkspace.settings.showGuidance,
    },
  }
}

/**
 * Normalize one mission through the same validation and migration path used
 * for workspace imports. Evidence packs intentionally carry a single mission
 * rather than a complete workspace, so this small wrapper gives them the
 * exact legacy-schema behavior without changing the current workspace schema.
 */
export function normalizeImportedMission(
  candidate: unknown,
  workspaceSchemaVersion = SCHEMA_VERSION,
): Mission {
  if (
    !Number.isInteger(workspaceSchemaVersion) ||
    workspaceSchemaVersion < 1
  ) {
    throw new Error(
      `Workspace schema ${String(workspaceSchemaVersion)} is invalid.`,
    )
  }

  if (workspaceSchemaVersion > SCHEMA_VERSION) {
    throw new Error(
      `Workspace schema ${workspaceSchemaVersion} is newer than supported schema ${SCHEMA_VERSION}.`,
    )
  }

  if (!isMission(candidate)) {
    throw new Error('Imported evidence pack mission is not a valid Mission.')
  }

  const wrapper: WorkspaceState = {
    missions: [candidate],
    activeMissionId: candidate.id,
    templates: missionTemplates,
    settings: {
      schemaVersion: workspaceSchemaVersion,
      density: 'compact',
      missionStatusFilter: 'all',
      mobilePanel: 'work',
      showGuidance: true,
    },
  }

  if (!isWorkspace(wrapper)) {
    throw new Error('Imported evidence pack mission failed workspace validation.')
  }

  const migrated = migrateWorkspace(wrapper)
  const mission = migrated.missions[0]

  if (!mission) {
    throw new Error('Imported evidence pack mission is empty.')
  }

  return mission
}

function exceedsWorkspaceJsonDepth(rawJson: string) {
  let depth = 0
  let inString = false
  let escaped = false

  for (const character of rawJson) {
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }

    if (character === '"') {
      inString = true
    } else if (character === '{' || character === '[') {
      depth += 1

      if (depth > MAX_WORKSPACE_JSON_DEPTH) {
        return true
      }
    } else if (character === '}' || character === ']') {
      depth -= 1
    }
  }

  return false
}

export function parseWorkspaceImport(rawJson: string): WorkspaceState {
  if (new Blob([rawJson]).size > MAX_WORKSPACE_IMPORT_BYTES) {
    throw new Error('Workspace import is too large for local preview.')
  }

  if (exceedsWorkspaceJsonDepth(rawJson)) {
    throw new Error(
      `Workspace import exceeds the maximum JSON nesting depth of ${MAX_WORKSPACE_JSON_DEPTH}.`,
    )
  }

  const parsed = JSON.parse(rawJson)

  if (
    isRecord(parsed) &&
    isRecord(parsed.settings) &&
    typeof parsed.settings.schemaVersion === 'number' &&
    parsed.settings.schemaVersion > SCHEMA_VERSION
  ) {
    throw new Error(
      `Workspace schema ${parsed.settings.schemaVersion} is newer than supported schema ${SCHEMA_VERSION}.`,
    )
  }

  if (!isWorkspace(parsed)) {
    throw new Error('Imported file is not a PatchHive workspace.')
  }

  return migrateWorkspace(parsed)
}

export function previewWorkspaceImport(rawJson: string): WorkspaceImportPreview {
  const workspace = parseWorkspaceImport(rawJson)
  const missionCount = workspace.missions.length
  const evidenceCount = workspace.missions.reduce((count, mission) => count + mission.evidence.length, 0)
  const archivedCount = workspace.missions.filter((mission) => mission.status === 'archived').length
  const warnings = [
    missionCount === 0 ? 'No missions were found in this workspace.' : '',
    evidenceCount === 0 ? 'No evidence records were found in this workspace.' : '',
  ].filter(Boolean)

  return {
    workspace,
    missionCount,
    evidenceCount,
    archivedCount,
    schemaVersion: workspace.settings.schemaVersion,
    warnings,
  }
}

export function serializeWorkspaceExport(state: WorkspaceState) {
  return JSON.stringify(
    {
      ...state,
      templates: missionTemplates,
      settings: {
        ...state.settings,
        schemaVersion: SCHEMA_VERSION,
      },
    },
    null,
    2,
  )
}

export function serializeWorkspaceRecoveryEnvelope(
  payload: string,
  reason: 'corrupt' | 'future-schema',
) {
  return JSON.stringify(
    {
      format: WORKSPACE_RECOVERY_FORMAT,
      storageKey: WORKSPACE_STORAGE_KEY,
      payload,
      reason,
    },
    null,
    2,
  )
}

function getStorageErrorName(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    typeof error.name === 'string' &&
    error.name
      ? error.name
      : 'UnknownError'
  )
}

function classifyStorageWriteError(
  error: unknown,
  observedRaw?: string | null,
): Extract<WorkspaceSaveResult, { status: 'quota' | 'unavailable' }> {
  const errorName = getStorageErrorName(error)
  const errorCode =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'number'
      ? error.code
      : undefined
  const quotaExceeded =
    errorName === 'QuotaExceededError' ||
    errorName === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    errorCode === 22 ||
    errorCode === 1014

  if (quotaExceeded) {
    return {
      status: 'quota',
      errorName,
      ...(observedRaw !== undefined ? { observedRaw } : {}),
    }
  }

  return {
    status: 'unavailable',
    errorName,
    ...(observedRaw !== undefined ? { observedRaw } : {}),
  }
}

export function loadWorkspace(): WorkspaceLoadResult {
  const workspace = createDefaultWorkspace()

  if (typeof window === 'undefined') {
    return {
      status: 'unavailable',
      workspace,
      errorName: 'WindowUnavailable',
    }
  }

  let saved: string | null

  try {
    saved = window.localStorage.getItem(WORKSPACE_STORAGE_KEY)
  } catch (error) {
    return {
      status: 'unavailable',
      workspace,
      errorName: getStorageErrorName(error),
    }
  }

  if (saved === null) {
    return { status: 'missing', workspace, storedRaw: null }
  }

  if (exceedsWorkspaceJsonDepth(saved)) {
    return {
      status: 'corrupt',
      workspace,
      rawPayload: saved,
      storedRaw: saved,
    }
  }

  try {
    const parsed: unknown = JSON.parse(saved)

    if (
      isRecord(parsed) &&
      isRecord(parsed.settings) &&
      typeof parsed.settings.schemaVersion === 'number' &&
      parsed.settings.schemaVersion > SCHEMA_VERSION
    ) {
      return {
        status: 'future-schema',
        workspace,
        rawPayload: saved,
        schemaVersion: parsed.settings.schemaVersion,
        storedRaw: saved,
      }
    }

    if (!isWorkspace(parsed)) {
      return {
        status: 'corrupt',
        workspace,
        rawPayload: saved,
        storedRaw: saved,
      }
    }

    const migratedWorkspace = migrateWorkspace(parsed)

    return {
      status:
        parsed.settings.schemaVersion === SCHEMA_VERSION ? 'valid' : 'migrated',
      workspace: migratedWorkspace,
      storedRaw: saved,
    }
  } catch {
    return {
      status: 'corrupt',
      workspace,
      rawPayload: saved,
      storedRaw: saved,
    }
  }
}

export function saveWorkspace(
  state: WorkspaceState,
  expectation: WorkspaceStorageExpectation,
): WorkspaceSaveResult {
  if (typeof window === 'undefined') {
    return {
      status: 'unavailable',
      errorName: 'WindowUnavailable',
    }
  }

  const serialized = serializeWorkspaceExport(state)
  let observedRaw: string | null | undefined

  if (expectation.status === 'known') {
    try {
      observedRaw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY)
    } catch (error) {
      return {
        status: 'unavailable',
        errorName: getStorageErrorName(error),
      }
    }

    if (observedRaw !== expectation.storedRaw) {
      return {
        status: 'conflict',
        actualRaw: observedRaw,
      }
    }
  }

  try {
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, serialized)
    return { status: 'saved', storedRaw: serialized }
  } catch (error) {
    return classifyStorageWriteError(error, observedRaw)
  }
}

export function clearWorkspace(expectedRaw: string | null): WorkspaceClearResult {
  if (typeof window === 'undefined') {
    return {
      status: 'unavailable',
      errorName: 'WindowUnavailable',
    }
  }

  let observedRaw: string | null

  try {
    observedRaw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY)
  } catch (error) {
    return {
      status: 'unavailable',
      errorName: getStorageErrorName(error),
    }
  }

  if (observedRaw !== expectedRaw) {
    return {
      status: 'conflict',
      actualRaw: observedRaw,
    }
  }

  try {
    window.localStorage.removeItem(WORKSPACE_STORAGE_KEY)
    return { status: 'saved', storedRaw: null }
  } catch (error) {
    return classifyStorageWriteError(error, observedRaw)
  }
}
