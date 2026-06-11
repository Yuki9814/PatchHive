import type { EvidenceKind, HandoffDraft, Mission, MissionStage } from '../types'
import type { WorkspaceAction } from '../workspaceReducer'
import { evidenceKinds, getMissionLaneName, type EvidenceFilter, type EvidenceForm } from '../workspaceUi'
import type { Dispatch, FormEvent } from 'react'

type FieldStatusMap = Record<
  string,
  {
    complete: boolean
  }
>

type InspectorProps = {
  mission: Mission
  activeStage: MissionStage
  handoffMarkdown: string
  handoffReady: boolean
  handoffBlockers: string[]
  handoffFieldStatusMap: FieldStatusMap
  evidenceForm: EvidenceForm
  evidenceFilter: EvidenceFilter
  evidenceStageFilter: string
  evidenceAgentFilter: string
  filteredEvidence: Mission['evidence']
  unlinkedEvidenceCount: number
  onEvidenceFormChange: (form: EvidenceForm) => void
  onEvidenceFilterChange: (value: EvidenceFilter) => void
  onEvidenceStageFilterChange: (value: string) => void
  onEvidenceAgentFilterChange: (value: string) => void
  onAddEvidence: (event: FormEvent<HTMLFormElement>) => void
  onCopyHandoff: () => void
  onDownloadHandoff: () => void
  onStatusMessage: (message: string) => void
  dispatch: Dispatch<WorkspaceAction>
}

export function Inspector({
  mission,
  activeStage,
  handoffMarkdown,
  handoffReady,
  handoffBlockers,
  handoffFieldStatusMap,
  evidenceForm,
  evidenceFilter,
  evidenceStageFilter,
  evidenceAgentFilter,
  filteredEvidence,
  unlinkedEvidenceCount,
  onEvidenceFormChange,
  onEvidenceFilterChange,
  onEvidenceStageFilterChange,
  onEvidenceAgentFilterChange,
  onAddEvidence,
  onCopyHandoff,
  onDownloadHandoff,
  onStatusMessage,
  dispatch,
}: InspectorProps) {
  const currentLanes = activeStage.lanes
  const missionLanes = mission.stages.flatMap((stage) => stage.lanes)

  const updateHandoff = (output: Partial<HandoffDraft>) =>
    dispatch({
      type: 'update-handoff',
      missionId: mission.id,
      output,
    })

  return (
    <aside className="inspector" aria-label="Evidence, approvals, and handoff">
      <section className="inspector-panel">
        <div className="panel-title">
          <h2>Evidence</h2>
          <span>{mission.evidence.length}</span>
        </div>

        <form className="evidence-form" onSubmit={onAddEvidence}>
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
          <button className="secondary-button" type="submit">
            Attach evidence
          </button>
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
          {filteredEvidence.map((evidence) => (
            <article className="evidence-item" key={evidence.id}>
              <span>{evidence.kind}</span>
              <strong>{evidence.title}</strong>
              <p>{evidence.detail}</p>
              <small>
                {mission.stages.find((stage) => stage.id === evidence.stageId)?.name ?? 'No stage'} ·{' '}
                {getMissionLaneName(mission, evidence.agentId)}
              </small>
              {evidence.sourceText ? <code>{evidence.sourceText.slice(0, 120)}</code> : null}
            </article>
          ))}
          {filteredEvidence.length === 0 ? <p className="empty-state">No evidence matches this filter.</p> : null}
        </div>
      </section>

      <section className="inspector-panel">
        <div className="panel-title">
          <h2>Approvals</h2>
          <span>{handoffReady ? 'clear' : 'gated'}</span>
        </div>
        <div className="approval-list">
          {mission.approvals.map((approval) => (
            <article className="approval-card" key={approval.id}>
              <div>
                <strong>{approval.label}</strong>
                <p>
                  {approval.riskLevel} risk · before {approval.requiredBefore}
                </p>
                {approval.approvedAt ? <small>{approval.approvedAt}</small> : null}
              </div>
              <button
                className={approval.approved ? 'approval-toggle approval-toggle--on' : 'approval-toggle'}
                type="button"
                onClick={() => {
                  dispatch({
                    type: 'toggle-approval',
                    missionId: mission.id,
                    approvalId: approval.id,
                  })
                  onStatusMessage(approval.approved ? 'Approval withdrawn.' : 'Approval recorded with timestamp.')
                }}
              >
                {approval.approved ? 'Approved' : 'Approve'}
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="inspector-panel handoff-panel">
        <div className="panel-title">
          <h2>Handoff</h2>
          <span>{handoffReady ? 'ready' : 'locked'}</span>
        </div>

        {handoffBlockers.length > 0 ? (
          <div className="blocker-list" role="status">
            <strong>Missing before export</strong>
            {handoffBlockers.map((blocker) => (
              <p key={blocker}>{blocker}</p>
            ))}
          </div>
        ) : null}

        <HandoffField
          complete={handoffFieldStatusMap.summary?.complete}
          label="Summary"
          value={mission.outputs.summary}
          onChange={(summary) => updateHandoff({ summary })}
        />
        <HandoffField
          complete={handoffFieldStatusMap.patchPlan?.complete}
          label="Patch plan"
          value={mission.outputs.patchPlan}
          onChange={(patchPlan) => updateHandoff({ patchPlan })}
        />
        <HandoffField
          complete={handoffFieldStatusMap.testPlan?.complete}
          label="Test plan"
          value={mission.outputs.testPlan}
          onChange={(testPlan) => updateHandoff({ testPlan })}
        />
        <HandoffField
          complete={handoffFieldStatusMap.risks?.complete}
          label="Risks"
          value={mission.outputs.risks}
          onChange={(risks) => updateHandoff({ risks })}
        />
        <HandoffField
          complete={handoffFieldStatusMap.maintainerComment?.complete}
          label="Maintainer comment"
          value={mission.outputs.maintainerComment}
          onChange={(maintainerComment) => updateHandoff({ maintainerComment })}
        />

        <div className="handoff-actions">
          <button disabled={!handoffReady} type="button" onClick={onCopyHandoff}>
            Copy Markdown
          </button>
          <button disabled={!handoffReady} type="button" onClick={onDownloadHandoff}>
            Download
          </button>
        </div>
        <details className="handoff-preview" open>
          <summary>Markdown preview</summary>
          <pre>{handoffMarkdown}</pre>
        </details>
      </section>
    </aside>
  )
}

function HandoffField({
  complete,
  label,
  value,
  onChange,
}: {
  complete?: boolean
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="handoff-field">
      <span>
        {label}
        <strong className={complete ? 'is-complete' : ''}>{complete ? 'Done' : 'Missing'}</strong>
      </span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}
