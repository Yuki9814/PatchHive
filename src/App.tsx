import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import './App.css'
import { Inspector } from './components/Inspector'
import { MissionComposer } from './components/MissionComposer'
import { MissionSidebar } from './components/MissionSidebar'
import { MissionWorkspace } from './components/MissionWorkspace'
import {
  StorageRecoveryBanner,
  type StorageRecoveryIssue,
} from './components/StorageRecoveryBanner'
import { filterAndSortEvidence } from './evidenceView'
import type {
  EvidenceSeverityFilter,
  EvidenceTriageFilter,
} from './evidenceView'
import { buildHandoffMarkdown, getHandoffBlockers, getNextStageGateBlocker } from './handoff'
import { runHandoffPrivacyPreflight } from './handoffPrivacy'
import { getHandoffFieldStatuses, getMissionHealth } from './missionHealth'
import {
  MAX_WORKSPACE_IMPORT_BYTES,
  WORKSPACE_STORAGE_KEY,
  clearWorkspace,
  loadWorkspace,
  previewWorkspaceImport,
  saveWorkspace,
  serializeWorkspaceExport,
  serializeWorkspaceRecoveryEnvelope,
  type WorkspaceLoadResult,
  type WorkspaceSaveResult,
  type WorkspaceStorageExpectation,
} from './storage'
import { parseGithubSource } from './templates'
import { normalizeExternalUrl } from './safeUrl'
import type { ChangeEvent, FormEvent } from 'react'
import { workspaceReducer } from './workspaceReducer'
import {
  createComposerInput,
  emptyEvidenceForm,
  formatExportTimestamp,
  getActiveMission,
  getTemplate,
  type EvidenceFilter,
  type EvidenceForm,
} from './workspaceUi'

type InspectorPanel = 'evidence' | 'approvals' | 'handoff'
type IsolatedRecoveryPayload = {
  rawPayload: string
  reason: 'corrupt' | 'future-schema'
}

function getInitialStorageIssue(
  loadResult: WorkspaceLoadResult,
): StorageRecoveryIssue | null {
  if (loadResult.status === 'corrupt') {
    return {
      status: 'corrupt',
      rawPayload: loadResult.rawPayload,
    }
  }

  if (loadResult.status === 'future-schema') {
    return {
      status: 'future-schema',
      rawPayload: loadResult.rawPayload,
      schemaVersion: loadResult.schemaVersion,
    }
  }

  if (loadResult.status === 'unavailable') {
    return {
      status: 'unavailable',
      errorName: loadResult.errorName,
      operation: 'read',
    }
  }

  return null
}

function getStorageWriteIssue(
  saveResult: WorkspaceSaveResult,
): StorageRecoveryIssue | null {
  if (saveResult.status === 'saved') {
    return null
  }

  if (saveResult.status === 'unavailable') {
    return {
      ...saveResult,
      operation: 'write',
    }
  }

  return saveResult
}

function getInitialStorageExpectation(
  loadResult: WorkspaceLoadResult,
): WorkspaceStorageExpectation {
  if (loadResult.status === 'unavailable') {
    return { status: 'unknown' }
  }

  return {
    status: 'known',
    storedRaw: loadResult.storedRaw,
  }
}

function downloadLocalFile(contents: string, type: string, fileName: string) {
  const blob = new Blob([contents], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

function App() {
  const [initialLoad] = useState<WorkspaceLoadResult>(() => loadWorkspace())
  const [state, dispatch] = useReducer(workspaceReducer, initialLoad.workspace)
  const [composerOpen, setComposerOpen] = useState(false)
  const [composer, setComposer] = useState(() => createComposerInput())
  const [evidenceForm, setEvidenceForm] = useState<EvidenceForm>(() => emptyEvidenceForm())
  const [evidenceFilter, setEvidenceFilter] = useState<EvidenceFilter>('all')
  const [evidenceStageFilter, setEvidenceStageFilter] = useState('all')
  const [evidenceAgentFilter, setEvidenceAgentFilter] = useState('all')
  const [evidenceSeverityFilter, setEvidenceSeverityFilter] =
    useState<EvidenceSeverityFilter>('all')
  const [evidenceTriageFilter, setEvidenceTriageFilter] =
    useState<EvidenceTriageFilter>('all')
  const [editingEvidenceId, setEditingEvidenceId] = useState<string | null>(null)
  const [findingDrafts, setFindingDrafts] = useState<Record<string, string>>({})
  const [statusMessage, setStatusMessage] = useState('Workspace loaded.')
  const [handoffPrivacyPreflightEnabled, setHandoffPrivacyPreflightEnabled] =
    useState(false)
  const [storageIssue, setStorageIssue] = useState<StorageRecoveryIssue | null>(
    () => getInitialStorageIssue(initialLoad),
  )
  const [isolatedRecovery, setIsolatedRecovery] =
    useState<IsolatedRecoveryPayload | null>(
      initialLoad.status === 'corrupt' ||
        initialLoad.status === 'future-schema'
        ? {
            rawPayload: initialLoad.rawPayload,
            reason: initialLoad.status,
          }
        : null,
    )
  const importInputRef = useRef<HTMLInputElement>(null)
  const newMissionButtonRef = useRef<HTMLButtonElement>(null)
  const persistedWorkspaceRef = useRef<string | null>(
    initialLoad.status === 'valid'
      ? serializeWorkspaceExport(initialLoad.workspace)
      : null,
  )
  const expectedStoredRawRef = useRef<WorkspaceStorageExpectation>(
    getInitialStorageExpectation(initialLoad),
  )
  const isolatedPayloadLocked =
    storageIssue?.status === 'corrupt' ||
    storageIssue?.status === 'future-schema'
  const storageMutationLocked =
    isolatedPayloadLocked || storageIssue?.status === 'conflict'
  const storageAutoSaveBlocked = storageIssue !== null

  useEffect(() => {
    const handleExternalStorageChange = (event: StorageEvent) => {
      if (event.key !== WORKSPACE_STORAGE_KEY && event.key !== null) {
        return
      }

      if (event.storageArea !== null) {
        try {
          if (event.storageArea !== window.localStorage) {
            return
          }
        } catch {
          return
        }
      }

      const expectation = expectedStoredRawRef.current

      if (
        expectation.status === 'known' &&
        event.newValue === expectation.storedRaw
      ) {
        return
      }

      setStorageIssue((currentIssue) =>
        currentIssue?.status === 'conflict'
          ? currentIssue
          : { status: 'conflict' },
      )
      setStatusMessage(
        'Another tab or PatchHive version changed the stored workspace. This tab did not overwrite it.',
      )
    }

    window.addEventListener('storage', handleExternalStorageChange)

    return () => {
      window.removeEventListener('storage', handleExternalStorageChange)
    }
  }, [])

  useEffect(() => {
    if (storageAutoSaveBlocked) {
      return
    }

    const snapshot = serializeWorkspaceExport(state)

    if (persistedWorkspaceRef.current === snapshot) {
      return
    }

    const result = saveWorkspace(state, expectedStoredRawRef.current)

    if (result.status === 'saved') {
      persistedWorkspaceRef.current = snapshot
      expectedStoredRawRef.current = {
        status: 'known',
        storedRaw: result.storedRaw,
      }
      return
    }

    if (
      (result.status === 'quota' || result.status === 'unavailable') &&
      result.observedRaw !== undefined
    ) {
      expectedStoredRawRef.current = {
        status: 'known',
        storedRaw: result.observedRaw,
      }
    }

    const issue = getStorageWriteIssue(result)
    let cancelled = false

    queueMicrotask(() => {
      if (!cancelled) {
        setStorageIssue(issue)
        if (result.status === 'conflict') {
          setStatusMessage(
            'Another tab or PatchHive version changed the stored workspace. This tab did not overwrite it.',
          )
        }
      }
    })

    return () => {
      cancelled = true
    }
  }, [state, storageAutoSaveBlocked])

  const closeComposer = useCallback(() => {
    setComposerOpen(false)
    newMissionButtonRef.current?.focus()
  }, [])

  const openComposer = useCallback(() => {
    setComposerOpen(true)
  }, [])

  const activeMission = getActiveMission(state.missions, state.activeMissionId)
  const activeStage = activeMission?.stages.find((stage) => stage.id === activeMission.activeStageId)
  const derivedWorkspace = useMemo(() => {
    if (!activeMission || !activeStage) {
      return null
    }

    const handoffBlockers = getHandoffBlockers(activeMission)

    return {
      handoffMarkdown: buildHandoffMarkdown(activeMission),
      handoffReady: handoffBlockers.length === 0,
      handoffBlockers,
      missionHealth: getMissionHealth(activeMission, handoffBlockers),
      handoffFieldStatusMap: Object.fromEntries(
        getHandoffFieldStatuses(activeMission).map((field) => [field.key, field]),
      ),
      nextStageGateBlocker: getNextStageGateBlocker(activeMission),
      filteredEvidence: filterAndSortEvidence(activeMission.evidence, {
        kind: evidenceFilter,
        stageId: evidenceStageFilter,
        agentId: evidenceAgentFilter,
        severity: evidenceSeverityFilter,
        triage: evidenceTriageFilter,
      }),
      unlinkedEvidenceCount: activeMission.evidence.filter(
        (evidence) => !evidence.stageId && !evidence.agentId,
      ).length,
    }
  }, [
    activeMission,
    activeStage,
    evidenceAgentFilter,
    evidenceFilter,
    evidenceSeverityFilter,
    evidenceStageFilter,
    evidenceTriageFilter,
  ])
  const handoffPrivacyPreflight = useMemo(
    () =>
      handoffPrivacyPreflightEnabled && derivedWorkspace
        ? runHandoffPrivacyPreflight(derivedWorkspace.handoffMarkdown)
        : null,
    [derivedWorkspace, handoffPrivacyPreflightEnabled],
  )

  if (!activeMission || !activeStage || !derivedWorkspace) {
    return (
      <main className="empty-app">
        <h1>PatchHive</h1>
        <p>No missions are available. Reset the workspace to restore seed data.</p>
        <button type="button" onClick={() => dispatch({ type: 'reset-workspace' })}>
          Reset workspace
        </button>
      </main>
    )
  }

  const {
    filteredEvidence,
    handoffBlockers,
    handoffFieldStatusMap,
    handoffMarkdown,
    handoffReady,
    missionHealth,
    nextStageGateBlocker,
    unlinkedEvidenceCount,
  } = derivedWorkspace
  const exportHandoffMarkdown = handoffPrivacyPreflightEnabled
    ? handoffPrivacyPreflight?.status === 'checked'
      ? handoffPrivacyPreflight.redactedMarkdown
      : ''
    : handoffMarkdown

  const handleTemplateChange = (templateId: string) => {
    setComposer(createComposerInput(getTemplate(templateId)))
  }

  const openInspectorPanel = (panel: InspectorPanel) => {
    dispatch({ type: 'update-settings', settings: { mobilePanel: 'inspector' } })
    window.requestAnimationFrame(() => {
      const target = document.getElementById(`panel-${panel}`)

      if (typeof target?.scrollIntoView === 'function') {
        target.scrollIntoView({ block: 'start' })
      }
    })
  }

  const createMission = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!composer.title.trim() || !composer.goal.trim() || !composer.sourceText.trim()) {
      setStatusMessage('Title, goal, and source are required before a mission can start.')
      return
    }

    if (composer.sourceKind === 'github-url' && !parseGithubSource(composer.sourceText).parsedRepo) {
      setStatusMessage('Paste a GitHub issue or PR URL before starting this mission.')
      return
    }

    dispatch({ type: 'create-mission', input: composer })
    closeComposer()
    setComposer(createComposerInput(getTemplate(composer.templateId)))
    setStatusMessage('Mission created and selected.')
  }

  const submitEvidence = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!evidenceForm.title.trim() || !evidenceForm.detail.trim()) {
      setStatusMessage('Evidence needs a title and detail.')
      return
    }

    const normalizedEvidenceUrl = evidenceForm.url.trim()
      ? normalizeExternalUrl(evidenceForm.url)
      : undefined

    if (evidenceForm.url.trim() && !normalizedEvidenceUrl) {
      setStatusMessage('Evidence links must use an http or https URL without embedded credentials.')
      return
    }

    const evidencePayload = {
      kind: evidenceForm.kind,
      title: evidenceForm.title.trim(),
      detail: evidenceForm.detail.trim(),
      sourceText: evidenceForm.sourceText.trim() || undefined,
      url: normalizedEvidenceUrl,
      filePath: evidenceForm.filePath.trim() || undefined,
      stageId: evidenceForm.stageId || undefined,
      agentId: evidenceForm.agentId || undefined,
    }

    if (editingEvidenceId) {
      dispatch({
        type: 'update-evidence',
        missionId: activeMission.id,
        evidenceId: editingEvidenceId,
        evidence: evidencePayload,
      })
      setStatusMessage('Evidence updated.')
    } else {
      dispatch({
        type: 'add-evidence',
        missionId: activeMission.id,
        evidence: evidencePayload,
      })
      setStatusMessage('Evidence attached to the mission.')
    }

    setEditingEvidenceId(null)
    setEvidenceForm(emptyEvidenceForm())
  }

  const startEvidenceEdit = (evidenceId: string) => {
    const evidence = activeMission.evidence.find((item) => item.id === evidenceId)

    if (!evidence) {
      setStatusMessage('Evidence record was not found.')
      return
    }

    setEditingEvidenceId(evidenceId)
    setEvidenceForm({
      kind: evidence.kind,
      title: evidence.title,
      detail: evidence.detail,
      sourceText: evidence.sourceText ?? '',
      url: evidence.url ?? '',
      filePath: evidence.filePath ?? '',
      stageId: evidence.stageId ?? '',
      agentId: evidence.agentId ?? '',
    })
    openInspectorPanel('evidence')
    setStatusMessage('Evidence loaded for editing.')
  }

  const cancelEvidenceEdit = () => {
    setEditingEvidenceId(null)
    setEvidenceForm(emptyEvidenceForm())
    setStatusMessage('Evidence edit cancelled.')
  }

  const deleteEvidence = (evidenceId: string) => {
    const evidence = activeMission.evidence.find((item) => item.id === evidenceId)

    if (evidence?.provenance?.importer === 'agent-hygiene') {
      setStatusMessage('Imported scanner evidence remains immutable.')
      return
    }

    if (!window.confirm('Delete this evidence record? Handoff source links for it will be removed.')) {
      setStatusMessage('Evidence deletion cancelled.')
      return
    }

    dispatch({ type: 'delete-evidence', missionId: activeMission.id, evidenceId })

    if (editingEvidenceId === evidenceId) {
      setEditingEvidenceId(null)
      setEvidenceForm(emptyEvidenceForm())
    }

    setStatusMessage('Evidence deleted.')
  }

  const addFinding = (stageId: string, laneId: string) => {
    const key = `${stageId}:${laneId}`
    const text = findingDrafts[key]?.trim()

    if (!text) {
      setStatusMessage('Finding text is empty.')
      return
    }

    dispatch({
      type: 'add-finding',
      missionId: activeMission.id,
      stageId,
      laneId,
      text,
    })
    setFindingDrafts((drafts) => ({ ...drafts, [key]: '' }))
    setStatusMessage('Agent finding added.')
  }

  const copyHandoff = async () => {
    if (!handoffReady) {
      setStatusMessage(`Handoff is locked: ${handoffBlockers[0] ?? 'missing required approval'}.`)
      return
    }

    if (
      handoffPrivacyPreflightEnabled &&
      handoffPrivacyPreflight?.status !== 'checked'
    ) {
      setStatusMessage(
        'Handoff export is locked because the local privacy preflight could not complete.',
      )
      return
    }

    try {
      await navigator.clipboard.writeText(exportHandoffMarkdown)
      setStatusMessage(
        handoffPrivacyPreflightEnabled
          ? `Redacted handoff Markdown copied after ${handoffPrivacyPreflight?.findings.length ?? 0} local mask(s).`
          : 'Handoff Markdown copied.',
      )
    } catch {
      setStatusMessage('Clipboard access failed. Use the preview or download instead.')
    }
  }

  const downloadHandoff = () => {
    if (!handoffReady) {
      setStatusMessage(`Handoff is locked: ${handoffBlockers[0] ?? 'missing required approval'}.`)
      return
    }

    if (
      handoffPrivacyPreflightEnabled &&
      handoffPrivacyPreflight?.status !== 'checked'
    ) {
      setStatusMessage(
        'Handoff export is locked because the local privacy preflight could not complete.',
      )
      return
    }

    downloadLocalFile(
      exportHandoffMarkdown,
      'text/markdown;charset=utf-8',
      `${activeMission.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-handoff.md`,
    )
    setStatusMessage(
      handoffPrivacyPreflightEnabled
        ? `Redacted handoff Markdown downloaded after ${handoffPrivacyPreflight?.findings.length ?? 0} local mask(s).`
        : 'Handoff Markdown downloaded.',
    )
  }

  const setPrivacyPreflightEnabled = (enabled: boolean) => {
    setHandoffPrivacyPreflightEnabled(enabled)
    setStatusMessage(
      enabled
        ? 'Local handoff privacy preflight enabled. Review the masked preview before sharing.'
        : 'Local handoff privacy preflight disabled. Export compatibility mode restored.',
    )
  }

  const exportWorkspace = () => {
    downloadLocalFile(
      serializeWorkspaceExport(state),
      'application/json;charset=utf-8',
      `patchhive-workspace-${formatExportTimestamp()}.json`,
    )
    setStatusMessage('Workspace JSON downloaded.')
  }

  const downloadRecoveryEnvelope = () => {
    if (!isolatedRecovery) {
      return
    }

    downloadLocalFile(
      serializeWorkspaceRecoveryEnvelope(
        isolatedRecovery.rawPayload,
        isolatedRecovery.reason,
      ),
      'application/json;charset=utf-8',
      `patchhive-recovery-envelope-${isolatedRecovery.reason}-${formatExportTimestamp()}.json`,
    )
    setStatusMessage('Lossless recovery envelope downloaded.')
  }

  const retryWorkspaceSave = () => {
    if (
      isolatedPayloadLocked ||
      storageIssue?.status === 'conflict' ||
      storageIssue === null
    ) {
      return
    }

    const unknownStorageBaseline =
      expectedStoredRawRef.current.status === 'unknown'

    if (
      unknownStorageBaseline &&
      !window.confirm(
        'Retry saving the current in-memory workspace? If browser storage becomes available, this can replace a saved payload that PatchHive could not read.',
      )
    ) {
      setStatusMessage('Browser save retry cancelled.')
      return
    }

    const snapshot = serializeWorkspaceExport(state)
    const result = saveWorkspace(
      state,
      unknownStorageBaseline
        ? { status: 'unknown' }
        : expectedStoredRawRef.current,
    )

    if (result.status === 'saved') {
      persistedWorkspaceRef.current = snapshot
      expectedStoredRawRef.current = {
        status: 'known',
        storedRaw: result.storedRaw,
      }
      setStorageIssue(null)
      setStatusMessage('Workspace saved to browser storage.')
      return
    }

    if (
      (result.status === 'quota' || result.status === 'unavailable') &&
      result.observedRaw !== undefined
    ) {
      expectedStoredRawRef.current = {
        status: 'known',
        storedRaw: result.observedRaw,
      }
    }

    setStorageIssue(getStorageWriteIssue(result))
    setStatusMessage(
      result.status === 'conflict'
        ? 'Another tab or PatchHive version changed the stored workspace. This tab did not overwrite it.'
        : result.status === 'quota'
        ? 'Browser storage is still full. This tab remains in memory-only mode.'
        : 'Browser storage is still unavailable. This tab remains in memory-only mode.',
    )
  }

  const discardStoredWorkspace = () => {
    if (
      storageIssue?.status !== 'corrupt' &&
      storageIssue?.status !== 'future-schema'
    ) {
      return
    }

    if (
      !window.confirm(
        'Permanently discard the isolated saved payload and reset to sample data? Download the lossless recovery envelope first if you may need it.',
      )
    ) {
      setStatusMessage('Saved payload was not discarded.')
      return
    }

    const result = clearWorkspace(storageIssue.rawPayload)

    if (result.status !== 'saved') {
      if (result.status === 'conflict') {
        setStorageIssue({ status: 'conflict' })
        setStatusMessage(
          'Another tab or PatchHive version changed the stored workspace. This tab did not discard or overwrite it.',
        )
        return
      }

      setStatusMessage(
        'The isolated saved payload could not be discarded. It remains write-protected.',
      )
      return
    }

    persistedWorkspaceRef.current = null
    setIsolatedRecovery(null)
    expectedStoredRawRef.current = {
      status: 'known',
      storedRaw: null,
    }
    setStorageIssue(null)
    dispatch({ type: 'reset-workspace' })
    setEditingEvidenceId(null)
    setEvidenceForm(emptyEvidenceForm())
    setStatusMessage('Saved payload discarded. Sample workspace reset in this tab.')
  }

  const importWorkspace = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    if (storageMutationLocked) {
      setStatusMessage(
        storageIssue?.status === 'conflict'
          ? 'Import is blocked because another tab or PatchHive version changed the stored workspace. Download this tab’s backup or reload the stored workspace.'
          : 'Import is blocked while the saved payload is isolated. Download it, then explicitly discard and reset before importing.',
      )
      event.target.value = ''
      return
    }

    if (file.size > MAX_WORKSPACE_IMPORT_BYTES) {
      setStatusMessage('Workspace import is too large for local preview.')
      event.target.value = ''
      return
    }

    try {
      const preview = previewWorkspaceImport(await file.text())
      const warningText =
        preview.warnings.length > 0 ? `\nWarnings: ${preview.warnings.join(' ')}` : ''
      const confirmed = window.confirm(
        `Import ${preview.missionCount} mission(s), ${preview.evidenceCount} evidence item(s), and ${preview.archivedCount} archived mission(s)? This replaces current local data. Export a backup first if needed.${warningText}`,
      )

      if (!confirmed) {
        setStatusMessage('Workspace import cancelled.')
        return
      }

      dispatch({ type: 'replace-workspace', workspace: preview.workspace })
      setEditingEvidenceId(null)
      setEvidenceForm(emptyEvidenceForm())
      setStatusMessage('Workspace JSON imported.')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Workspace import failed.')
    } finally {
      event.target.value = ''
    }
  }

  const resetWorkspace = () => {
    if (storageMutationLocked) {
      setStatusMessage(
        storageIssue?.status === 'conflict'
          ? 'Reset is blocked because another tab or PatchHive version changed the stored workspace. Download this tab’s backup or reload the stored workspace.'
          : 'Use “Discard saved data and reset” in the recovery banner to remove the isolated payload.',
      )
      return
    }

    if (
      !window.confirm(
        'Reset PatchHive to sample data? Current local workspace data will be replaced. Export a backup first if needed.',
      )
    ) {
      setStatusMessage('Workspace reset cancelled.')
      return
    }

    dispatch({ type: 'reset-workspace' })
    setEditingEvidenceId(null)
    setEvidenceForm(emptyEvidenceForm())
    setStatusMessage('Workspace reset to sample data.')
  }

  const reloadStoredWorkspace = () => {
    window.location.reload()
  }

  return (
    <main
      className={`workspace-shell${storageIssue ? ' workspace-shell--storage-warning' : ''}`}
      data-mobile-panel={state.settings.mobilePanel}
    >
      {storageIssue ? (
        <StorageRecoveryBanner
          issue={storageIssue}
          onDiscardAndReset={discardStoredWorkspace}
          onDownloadCurrentWorkspace={exportWorkspace}
          onDownloadRecoveryEnvelope={downloadRecoveryEnvelope}
          onReloadStoredWorkspace={reloadStoredWorkspace}
          onRetrySave={retryWorkspaceSave}
          recoveryEnvelopeAvailable={isolatedRecovery !== null}
        />
      ) : null}

      <nav className="mobile-panel-switcher" aria-label="Mobile workspace panels">
        <button
          aria-pressed={state.settings.mobilePanel === 'missions'}
          type="button"
          onClick={() => dispatch({ type: 'update-settings', settings: { mobilePanel: 'missions' } })}
        >
          Missions
        </button>
        <button
          aria-pressed={state.settings.mobilePanel === 'work'}
          type="button"
          onClick={() => dispatch({ type: 'update-settings', settings: { mobilePanel: 'work' } })}
        >
          Work
        </button>
        <button
          aria-pressed={state.settings.mobilePanel === 'inspector'}
          type="button"
          onClick={() => dispatch({ type: 'update-settings', settings: { mobilePanel: 'inspector' } })}
        >
          Inspector
        </button>
      </nav>

      <MissionSidebar
        activeMissionId={activeMission.id}
        dispatch={dispatch}
        importInputRef={importInputRef}
        newMissionButtonRef={newMissionButtonRef}
        onExportWorkspace={exportWorkspace}
        onImportWorkspace={importWorkspace}
        onNewMission={openComposer}
        onResetWorkspace={resetWorkspace}
        storageRecoveryLocked={storageMutationLocked}
        state={state}
      />

      <MissionWorkspace
        activeStage={activeStage}
        dispatch={dispatch}
        findingDrafts={findingDrafts}
        handoffReady={handoffReady}
        mission={activeMission}
        missionHealth={missionHealth}
        nextStageGateBlocker={nextStageGateBlocker}
        onAddFinding={addFinding}
        onFindingDraftChange={(key, value) => setFindingDrafts((drafts) => ({ ...drafts, [key]: value }))}
        onOpenInspectorPanel={openInspectorPanel}
        onStatusMessage={setStatusMessage}
      />

      <Inspector
        activeStage={activeStage}
        dispatch={dispatch}
        editingEvidenceId={editingEvidenceId}
        evidenceAgentFilter={evidenceAgentFilter}
        evidenceFilter={evidenceFilter}
        evidenceForm={evidenceForm}
        evidenceSeverityFilter={evidenceSeverityFilter}
        evidenceStageFilter={evidenceStageFilter}
        evidenceTriageFilter={evidenceTriageFilter}
        filteredEvidence={filteredEvidence}
        handoffBlockers={handoffBlockers}
        handoffFieldStatusMap={handoffFieldStatusMap}
        handoffMarkdown={exportHandoffMarkdown}
        handoffPrivacyPreflight={handoffPrivacyPreflight}
        handoffPrivacyPreflightEnabled={handoffPrivacyPreflightEnabled}
        handoffReady={handoffReady}
        mission={activeMission}
        onCancelEvidenceEdit={cancelEvidenceEdit}
        onCopyHandoff={copyHandoff}
        onDeleteEvidence={deleteEvidence}
        onDownloadHandoff={downloadHandoff}
        onEvidenceAgentFilterChange={setEvidenceAgentFilter}
        onEvidenceFilterChange={setEvidenceFilter}
        onEvidenceFormChange={setEvidenceForm}
        onEvidenceSeverityFilterChange={setEvidenceSeverityFilter}
        onEvidenceStageFilterChange={setEvidenceStageFilter}
        onEvidenceTriageFilterChange={setEvidenceTriageFilter}
        onStartEvidenceEdit={startEvidenceEdit}
        onStatusMessage={setStatusMessage}
        onSubmitEvidence={submitEvidence}
        onToggleHandoffPrivacyPreflight={setPrivacyPreflightEnabled}
        unlinkedEvidenceCount={unlinkedEvidenceCount}
      />

      {composerOpen ? (
        <MissionComposer
          composer={composer}
          onClose={closeComposer}
          onComposerChange={setComposer}
          onSubmit={createMission}
          onTemplateChange={handleTemplateChange}
          showGuidance={state.settings.showGuidance}
          templates={state.templates}
        />
      ) : null}

      <div className="sr-status" aria-live="polite">
        {statusMessage}
      </div>
    </main>
  )
}

export default App
