import type { EvidenceKind, EvidenceTriageStatus, Mission, MissionStage } from '../types'
import {
  EVIDENCE_PAGE_SIZE,
  type EvidenceSeverityFilter,
  type EvidenceTriageFilter,
} from '../evidenceView'
import {
  MAX_RESOLUTION_NOTE_LENGTH,
  isScannerRiskEvidence,
  normalizeResolutionNote,
} from '../scannerTriage'
import {
  evidenceKinds,
  handoffFieldLabels,
  type EvidenceFilter,
  type EvidenceForm,
} from '../workspaceUi'
import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'

type EvidencePanelProps = {
  mission: Mission
  activeStage: MissionStage
  evidenceForm: EvidenceForm
  editingEvidenceId: string | null
  evidenceFilter: EvidenceFilter
  evidenceStageFilter: string
  evidenceAgentFilter: string
  evidenceSeverityFilter: EvidenceSeverityFilter
  evidenceTriageFilter: EvidenceTriageFilter
  filteredEvidence: Mission['evidence']
  unlinkedEvidenceCount: number
  onEvidenceFormChange: (form: EvidenceForm) => void
  onEvidenceFilterChange: (value: EvidenceFilter) => void
  onEvidenceStageFilterChange: (value: string) => void
  onEvidenceAgentFilterChange: (value: string) => void
  onEvidenceSeverityFilterChange: (value: EvidenceSeverityFilter) => void
  onEvidenceTriageFilterChange: (value: EvidenceTriageFilter) => void
  onSubmitEvidence: (event: FormEvent<HTMLFormElement>) => void
  onStartEvidenceEdit: (evidenceId: string) => void
  onCancelEvidenceEdit: () => void
  onDeleteEvidence: (evidenceId: string) => void
  onSetEvidenceTriage: (
    evidenceId: string,
    triageStatus: EvidenceTriageStatus,
    resolutionNote?: string,
  ) => void
}

const evidenceStatusLabels = {
  unlinked: 'Unlinked',
  linked: 'Linked',
  'in-handoff': 'In handoff',
}

export function EvidencePanel({
  mission,
  activeStage,
  evidenceForm,
  editingEvidenceId,
  evidenceFilter,
  evidenceStageFilter,
  evidenceAgentFilter,
  evidenceSeverityFilter,
  evidenceTriageFilter,
  filteredEvidence,
  unlinkedEvidenceCount,
  onEvidenceFormChange,
  onEvidenceFilterChange,
  onEvidenceStageFilterChange,
  onEvidenceAgentFilterChange,
  onEvidenceSeverityFilterChange,
  onEvidenceTriageFilterChange,
  onSubmitEvidence,
  onStartEvidenceEdit,
  onCancelEvidenceEdit,
  onDeleteEvidence,
  onSetEvidenceTriage,
}: EvidencePanelProps) {
  const [page, setPage] = useState(1)
  const [acceptingEvidenceId, setAcceptingEvidenceId] = useState<string | null>(null)
  const [resolutionDraft, setResolutionDraft] = useState('')
  const currentLanes = activeStage.lanes
  const missionLanes = useMemo(
    () => mission.stages.flatMap((stage) => stage.lanes),
    [mission.stages],
  )
  const stageNameById = useMemo(
    () => new Map(mission.stages.map((stage) => [stage.id, stage.name])),
    [mission.stages],
  )
  const laneNameById = useMemo(
    () => new Map(missionLanes.map((lane) => [lane.id, lane.name])),
    [missionLanes],
  )
  const handoffFieldsByEvidenceId = useMemo(() => {
    const result = new Map<string, string[]>()

    Object.entries(mission.outputs.fieldSources).forEach(([field, evidenceIds]) => {
      evidenceIds.forEach((evidenceId) => {
        result.set(evidenceId, [
          ...(result.get(evidenceId) ?? []),
          handoffFieldLabels[field as keyof typeof handoffFieldLabels],
        ])
      })
    })

    return result
  }, [mission.outputs.fieldSources])
  const pageCount = Math.max(1, Math.ceil(filteredEvidence.length / EVIDENCE_PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const visibleEvidence = useMemo(
    () =>
      filteredEvidence.slice(
        (currentPage - 1) * EVIDENCE_PAGE_SIZE,
        currentPage * EVIDENCE_PAGE_SIZE,
      ),
    [currentPage, filteredEvidence],
  )
  const firstVisible =
    filteredEvidence.length === 0 ? 0 : (currentPage - 1) * EVIDENCE_PAGE_SIZE + 1
  const lastVisible = Math.min(currentPage * EVIDENCE_PAGE_SIZE, filteredEvidence.length)

  const resetPage = (update: () => void) => {
    setPage(1)
    update()
  }

  const beginAcceptance = (evidenceId: string, existingNote?: string) => {
    setAcceptingEvidenceId(evidenceId)
    setResolutionDraft(existingNote ?? '')
  }

  const cancelAcceptance = () => {
    setAcceptingEvidenceId(null)
    setResolutionDraft('')
  }

  const confirmAcceptance = (evidenceId: string) => {
    const resolutionNote = normalizeResolutionNote(resolutionDraft)

    if (!resolutionNote) {
      return
    }

    onSetEvidenceTriage(evidenceId, 'accepted', resolutionNote)
    cancelAcceptance()
  }

  return (
    <section className="inspector-panel" id="panel-evidence">
      <div className="panel-title">
        <h2>Evidence</h2>
        <span>{mission.evidence.length}</span>
      </div>

      <form className="evidence-form" onSubmit={onSubmitEvidence}>
        <div className="form-grid">
          <label>
            Type
            <select
              value={evidenceForm.kind}
              onChange={(event) => onEvidenceFormChange({ ...evidenceForm, kind: event.target.value as EvidenceKind })}
            >
              {evidenceKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </label>
          <label>
            Stage
            <select
              value={evidenceForm.stageId}
              onChange={(event) => onEvidenceFormChange({ ...evidenceForm, stageId: event.target.value })}
            >
              <option value="">Unassigned</option>
              {mission.stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Agent
            <select
              value={evidenceForm.agentId}
              onChange={(event) => onEvidenceFormChange({ ...evidenceForm, agentId: event.target.value })}
            >
              <option value="">Unassigned</option>
              {currentLanes.map((lane) => (
                <option key={lane.id} value={lane.id}>
                  {lane.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <input
          aria-label="Evidence title"
          placeholder="Evidence title"
          value={evidenceForm.title}
          onChange={(event) => onEvidenceFormChange({ ...evidenceForm, title: event.target.value })}
        />
        <textarea
          aria-label="Evidence detail"
          placeholder="What this proves or changes"
          value={evidenceForm.detail}
          onChange={(event) => onEvidenceFormChange({ ...evidenceForm, detail: event.target.value })}
        />
        <textarea
          aria-label="Source snippet"
          placeholder="Raw source snippet, log line, diff hunk, or maintainer quote"
          value={evidenceForm.sourceText}
          onChange={(event) => onEvidenceFormChange({ ...evidenceForm, sourceText: event.target.value })}
        />
        <input
          aria-label="Evidence URL"
          inputMode="url"
          placeholder="https://github.com/owner/repo/issues/123"
          value={evidenceForm.url}
          onChange={(event) => onEvidenceFormChange({ ...evidenceForm, url: event.target.value })}
        />
        <input
          aria-label="Evidence file path"
          placeholder="src/parser.ts:42"
          value={evidenceForm.filePath}
          onChange={(event) => onEvidenceFormChange({ ...evidenceForm, filePath: event.target.value })}
        />
        <div className="evidence-form-actions">
          <button className="secondary-button" type="submit">
            {editingEvidenceId ? 'Save evidence' : 'Attach evidence'}
          </button>
          {editingEvidenceId ? (
            <button className="subtle-button" type="button" onClick={onCancelEvidenceEdit}>
              Cancel edit
            </button>
          ) : null}
        </div>
      </form>

      <div className="evidence-toolbar">
        <label>
          Type filter
          <select
            value={evidenceFilter}
            onChange={(event) =>
              resetPage(() =>
                onEvidenceFilterChange(event.target.value as EvidenceFilter),
              )
            }
          >
            <option value="all">All evidence</option>
            <option value="unlinked">Unlinked only ({unlinkedEvidenceCount})</option>
            {evidenceKinds.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </label>
        <label>
          Stage filter
          <select
            value={evidenceStageFilter}
            onChange={(event) =>
              resetPage(() => onEvidenceStageFilterChange(event.target.value))
            }
          >
            <option value="all">All stages</option>
            {mission.stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Agent filter
          <select
            value={evidenceAgentFilter}
            onChange={(event) =>
              resetPage(() => onEvidenceAgentFilterChange(event.target.value))
            }
          >
            <option value="all">All agents</option>
            {missionLanes.map((lane, index) => (
              <option key={`${lane.id}-${index}`} value={lane.id}>
                {lane.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Severity filter
          <select
            value={evidenceSeverityFilter}
            onChange={(event) =>
              resetPage(() =>
                onEvidenceSeverityFilterChange(
                  event.target.value as EvidenceSeverityFilter,
                ),
              )
            }
          >
            <option value="all">All severities</option>
            <option value="critical">critical</option>
            <option value="high">high</option>
            <option value="medium">medium</option>
            <option value="low">low</option>
            <option value="info">info</option>
          </select>
        </label>
        <label>
          Triage filter
          <select
            value={evidenceTriageFilter}
            onChange={(event) =>
              resetPage(() =>
                onEvidenceTriageFilterChange(
                  event.target.value as EvidenceTriageFilter,
                ),
              )
            }
          >
            <option value="all">All triage states</option>
            <option value="open">open</option>
            <option value="accepted">accepted</option>
            <option value="resolved">resolved</option>
          </select>
        </label>
        {unlinkedEvidenceCount > 0 ? (
          <p>{unlinkedEvidenceCount} evidence item(s) still need a stage or agent link.</p>
        ) : (
          <p>All evidence is linked.</p>
        )}
      </div>

      <div
        className="evidence-list"
        data-evidence-total={filteredEvidence.length}
        data-page-size={EVIDENCE_PAGE_SIZE}
      >
        {visibleEvidence.map((evidence) => {
          const handoffFields = handoffFieldsByEvidenceId.get(evidence.id)?.join(', ') ?? ''
          const status = handoffFields
            ? 'in-handoff'
            : evidence.stageId || evidence.agentId
              ? 'linked'
              : 'unlinked'
          const scannerRisk = isScannerRiskEvidence(evidence)
          const acceptedNote = normalizeResolutionNote(evidence.resolutionNote)

          return (
            <article className="evidence-item" key={evidence.id}>
              <div className="evidence-item__meta">
                <span>{evidence.kind}</span>
                <span className={`evidence-status evidence-status--${status}`}>{evidenceStatusLabels[status]}</span>
              </div>
              <strong>{evidence.title}</strong>
              <p>{evidence.detail}</p>
              <small>
                {stageNameById.get(evidence.stageId ?? '') ?? 'No stage'} ·{' '}
                {laneNameById.get(evidence.agentId ?? '') ?? 'No agent'}
              </small>
              {handoffFields ? <small>Mapped to {handoffFields}</small> : null}
              {evidence.sourceText ? <code>{evidence.sourceText.slice(0, 160)}</code> : null}
              {evidence.provenance ? (
                <small>
                  Imported from {evidence.provenance.toolName} {evidence.provenance.format.toUpperCase()} ·{' '}
                  {evidence.provenance.sourceName} · producer{' '}
                  {evidence.provenance.producerStatus ?? 'unverified'} ·{' '}
                  {evidence.severity ?? 'info'} / {evidence.triageStatus ?? 'open'}
                </small>
              ) : null}
              {evidence.triageStatus === 'accepted' ? (
                acceptedNote ? (
                  <p className="resolution-note">Acceptance note: {acceptedNote}</p>
                ) : (
                  <p className="resolution-note resolution-note--missing">
                    Missing required acceptance note.
                  </p>
                )
              ) : null}
              <small>Updated {evidence.updatedAt}</small>
              {acceptingEvidenceId === evidence.id ? (
                <div className="resolution-editor">
                  <label>
                    Acceptance resolution note
                    <textarea
                      aria-label={`Resolution note for ${evidence.title}`}
                      maxLength={MAX_RESOLUTION_NOTE_LENGTH}
                      placeholder="Explain why this scanner risk is accepted."
                      value={resolutionDraft}
                      onChange={(event) => setResolutionDraft(event.target.value)}
                    />
                  </label>
                  <div className="evidence-item__actions">
                    <button
                      className="secondary-button"
                      disabled={!normalizeResolutionNote(resolutionDraft)}
                      type="button"
                      onClick={() => confirmAcceptance(evidence.id)}
                    >
                      Confirm acceptance
                    </button>
                    <button
                      className="subtle-button"
                      type="button"
                      onClick={cancelAcceptance}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="evidence-item__actions">
                {scannerRisk &&
                evidence.triageStatus === 'open' &&
                evidence.provenance?.scanComplete ? (
                  <>
                    <button
                      className="subtle-button"
                      type="button"
                      onClick={() => beginAcceptance(evidence.id)}
                    >
                      Accept risk
                    </button>
                    <button
                      className="subtle-button"
                      type="button"
                      onClick={() => onSetEvidenceTriage(evidence.id, 'resolved')}
                    >
                      Mark resolved
                    </button>
                  </>
                ) : null}
                {scannerRisk &&
                evidence.provenance?.scanComplete &&
                evidence.triageStatus !== 'open' ? (
                  <>
                    {evidence.triageStatus === 'accepted' ? (
                      <button
                        className="subtle-button"
                        type="button"
                        onClick={() => beginAcceptance(evidence.id, evidence.resolutionNote)}
                      >
                        {acceptedNote ? 'Edit resolution note' : 'Add resolution note'}
                      </button>
                    ) : null}
                    <button
                      className="subtle-button"
                      type="button"
                      onClick={() => onSetEvidenceTriage(evidence.id, 'open')}
                    >
                      Reopen
                    </button>
                  </>
                ) : null}
                {!evidence.provenance ? (
                  <button className="subtle-button" type="button" onClick={() => onStartEvidenceEdit(evidence.id)}>
                    Edit
                  </button>
                ) : null}
                <button
                  className="subtle-button subtle-button--danger"
                  disabled={Boolean(evidence.provenance && evidence.triageStatus !== 'resolved')}
                  title={
                    evidence.provenance && evidence.triageStatus !== 'resolved'
                      ? 'Imported scanner evidence stays locked until it is resolved.'
                      : undefined
                  }
                  type="button"
                  onClick={() => onDeleteEvidence(evidence.id)}
                >
                  Delete
                </button>
              </div>
            </article>
          )
        })}
        {filteredEvidence.length === 0 ? <p className="empty-state">No evidence matches this filter.</p> : null}
      </div>
      <nav className="evidence-pagination" aria-label="Evidence pages">
        <span>
          Showing {firstVisible}-{lastVisible} of {filteredEvidence.length}
        </span>
        <button
          className="subtle-button"
          disabled={currentPage === 1}
          type="button"
          onClick={() => setPage((current) => Math.max(1, current - 1))}
        >
          Previous
        </button>
        <span>
          Page {currentPage} of {pageCount}
        </span>
        <button
          className="subtle-button"
          disabled={currentPage === pageCount}
          type="button"
          onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
        >
          Next
        </button>
      </nav>
    </section>
  )
}
