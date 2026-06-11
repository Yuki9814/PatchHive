import { getEvidenceHandoffFields, getEvidenceWorkflowStatus } from '../handoffCoverage'
import type { EvidenceKind, Mission, MissionStage } from '../types'
import {
  evidenceKinds,
  getMissionLaneName,
  handoffFieldLabels,
  type EvidenceFilter,
  type EvidenceForm,
} from '../workspaceUi'
import type { FormEvent } from 'react'

type EvidencePanelProps = {
  mission: Mission
  activeStage: MissionStage
  evidenceForm: EvidenceForm
  editingEvidenceId: string | null
  evidenceFilter: EvidenceFilter
  evidenceStageFilter: string
  evidenceAgentFilter: string
  filteredEvidence: Mission['evidence']
  unlinkedEvidenceCount: number
  onEvidenceFormChange: (form: EvidenceForm) => void
  onEvidenceFilterChange: (value: EvidenceFilter) => void
  onEvidenceStageFilterChange: (value: string) => void
  onEvidenceAgentFilterChange: (value: string) => void
  onSubmitEvidence: (event: FormEvent<HTMLFormElement>) => void
  onStartEvidenceEdit: (evidenceId: string) => void
  onCancelEvidenceEdit: () => void
  onDeleteEvidence: (evidenceId: string) => void
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
  filteredEvidence,
  unlinkedEvidenceCount,
  onEvidenceFormChange,
  onEvidenceFilterChange,
  onEvidenceStageFilterChange,
  onEvidenceAgentFilterChange,
  onSubmitEvidence,
  onStartEvidenceEdit,
  onCancelEvidenceEdit,
  onDeleteEvidence,
}: EvidencePanelProps) {
  const currentLanes = activeStage.lanes
  const missionLanes = mission.stages.flatMap((stage) => stage.lanes)

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
          aria-label="Evidence URL or file path"
          placeholder="URL or file path"
          value={evidenceForm.url || evidenceForm.filePath}
          onChange={(event) =>
            onEvidenceFormChange({
              ...evidenceForm,
              url: event.target.value.startsWith('http') ? event.target.value : '',
              filePath: event.target.value.startsWith('http') ? '' : event.target.value,
            })
          }
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
          <select value={evidenceFilter} onChange={(event) => onEvidenceFilterChange(event.target.value as EvidenceFilter)}>
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
          <select value={evidenceStageFilter} onChange={(event) => onEvidenceStageFilterChange(event.target.value)}>
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
          <select value={evidenceAgentFilter} onChange={(event) => onEvidenceAgentFilterChange(event.target.value)}>
            <option value="all">All agents</option>
            {missionLanes.map((lane, index) => (
              <option key={`${lane.id}-${index}`} value={lane.id}>
                {lane.name}
              </option>
            ))}
          </select>
        </label>
        {unlinkedEvidenceCount > 0 ? (
          <p>{unlinkedEvidenceCount} evidence item(s) still need a stage or agent link.</p>
        ) : (
          <p>All evidence is linked.</p>
        )}
      </div>

      <div className="evidence-list">
        {filteredEvidence.map((evidence) => {
          const status = getEvidenceWorkflowStatus(mission, evidence)
          const handoffFields = getEvidenceHandoffFields(mission, evidence.id)
            .map((field) => handoffFieldLabels[field])
            .join(', ')

          return (
            <article className="evidence-item" key={evidence.id}>
              <div className="evidence-item__meta">
                <span>{evidence.kind}</span>
                <span className={`evidence-status evidence-status--${status}`}>{evidenceStatusLabels[status]}</span>
              </div>
              <strong>{evidence.title}</strong>
              <p>{evidence.detail}</p>
              <small>
                {mission.stages.find((stage) => stage.id === evidence.stageId)?.name ?? 'No stage'} ·{' '}
                {getMissionLaneName(mission, evidence.agentId)}
              </small>
              {handoffFields ? <small>Mapped to {handoffFields}</small> : null}
              {evidence.sourceText ? <code>{evidence.sourceText.slice(0, 160)}</code> : null}
              <small>Updated {evidence.updatedAt}</small>
              <div className="evidence-item__actions">
                <button className="subtle-button" type="button" onClick={() => onStartEvidenceEdit(evidence.id)}>
                  Edit
                </button>
                <button className="subtle-button subtle-button--danger" type="button" onClick={() => onDeleteEvidence(evidence.id)}>
                  Delete
                </button>
              </div>
            </article>
          )
        })}
        {filteredEvidence.length === 0 ? <p className="empty-state">No evidence matches this filter.</p> : null}
      </div>
    </section>
  )
}
