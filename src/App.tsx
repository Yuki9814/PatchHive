import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import './App.css'
import { Inspector } from './components/Inspector'
import { MissionComposer } from './components/MissionComposer'
import { MissionSidebar } from './components/MissionSidebar'
import { MissionWorkspace } from './components/MissionWorkspace'
import { filterAndSortEvidence } from './evidenceView'
import type {
  EvidenceSeverityFilter,
  EvidenceTriageFilter,
} from './evidenceView'
import { buildHandoffMarkdown, getHandoffBlockers, getNextStageGateBlocker } from './handoff'
import { getHandoffFieldStatuses, getMissionHealth } from './missionHealth'
import {
  MAX_WORKSPACE_IMPORT_BYTES,
  loadWorkspace,
  previewWorkspaceImport,
  saveWorkspace,
  serializeWorkspaceExport,
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

function App() {
  const [state, dispatch] = useReducer(workspaceReducer, undefined, loadWorkspace)
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
  const importInputRef = useRef<HTMLInputElement>(null)
  const newMissionButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    saveWorkspace(state)
  }, [state])

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

    if (
      evidence?.provenance?.importer === 'agent-hygiene' &&
      evidence.triageStatus !== 'resolved'
    ) {
      setStatusMessage('Imported scanner evidence stays locked until it is resolved.')
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

    try {
      await navigator.clipboard.writeText(handoffMarkdown)
      setStatusMessage('Handoff Markdown copied.')
    } catch {
      setStatusMessage('Clipboard access failed. Use the preview or download instead.')
    }
  }

  const downloadHandoff = () => {
    if (!handoffReady) {
      setStatusMessage(`Handoff is locked: ${handoffBlockers[0] ?? 'missing required approval'}.`)
      return
    }

    const blob = new Blob([handoffMarkdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${activeMission.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-handoff.md`
    link.click()
    URL.revokeObjectURL(url)
    setStatusMessage('Handoff Markdown downloaded.')
  }

  const exportWorkspace = () => {
    const blob = new Blob([serializeWorkspaceExport(state)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `patchhive-workspace-${formatExportTimestamp()}.json`
    link.click()
    URL.revokeObjectURL(url)
    setStatusMessage('Workspace JSON downloaded.')
  }

  const importWorkspace = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]

    if (!file) {
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

  return (
    <main className="workspace-shell" data-mobile-panel={state.settings.mobilePanel}>
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
        handoffMarkdown={handoffMarkdown}
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
