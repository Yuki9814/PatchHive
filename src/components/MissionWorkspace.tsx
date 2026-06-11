import { getStageGateBlocker } from '../handoff'
import type { Mission, MissionStage } from '../types'
import type { WorkspaceAction } from '../workspaceReducer'
import { agentStatuses, statusDescriptions } from '../workspaceUi'
import type { Dispatch } from 'react'

type MissionWorkspaceProps = {
  mission: Mission
  activeStage: MissionStage
  handoffReady: boolean
  missionHealth: {
    score: number
    stageName: string
    evidenceGap: string
    approvalGap: string
    handoffGap: string
    nextStep: string
  }
  nextStageGateBlocker: string
  findingDrafts: Record<string, string>
  onFindingDraftChange: (key: string, value: string) => void
  onAddFinding: (stageId: string, laneId: string) => void
  onStatusMessage: (message: string) => void
  dispatch: Dispatch<WorkspaceAction>
}

export function MissionWorkspace({
  mission,
  activeStage,
  handoffReady,
  missionHealth,
  nextStageGateBlocker,
  findingDrafts,
  onFindingDraftChange,
  onAddFinding,
  onStatusMessage,
  dispatch,
}: MissionWorkspaceProps) {
  return (
    <section className="mission-workspace">
      <header className="topbar">
        <div>
          <p className="section-label">Current mission</p>
          <h1>{mission.title}</h1>
          <p>{mission.goal}</p>
        </div>
        <div className="topbar-actions">
          <span className={`readiness ${handoffReady ? 'readiness--ready' : ''}`}>
            {handoffReady ? 'Ready for handoff' : 'Approvals pending'}
          </span>
          <button
            className="secondary-button"
            disabled={Boolean(nextStageGateBlocker)}
            type="button"
            onClick={() => {
              dispatch({ type: 'advance-stage', missionId: mission.id })
              onStatusMessage(nextStageGateBlocker || 'Mission advanced to the next stage.')
            }}
          >
            Advance stage
          </button>
        </div>
      </header>

      <section className="context-strip" aria-label="Mission context">
        <div>
          <span>Repository</span>
          <strong>{mission.repo}</strong>
        </div>
        <div>
          <span>Branch</span>
          <strong>{mission.branch}</strong>
        </div>
        <div>
          <span>Evidence</span>
          <strong>{mission.evidence.length}</strong>
        </div>
        <div>
          <span>Approvals</span>
          <strong>
            {mission.approvals.filter((approval) => approval.approved).length}/{mission.approvals.length}
          </strong>
        </div>
      </section>

      <section className="health-panel" aria-label="Mission health">
        <div className="health-score">
          <span>Mission health</span>
          <strong>{missionHealth.score}%</strong>
        </div>
        <div className="health-items">
          <article>
            <span>Stage</span>
            <strong>{missionHealth.stageName}</strong>
          </article>
          <article>
            <span>Evidence</span>
            <strong>{missionHealth.evidenceGap}</strong>
          </article>
          <article>
            <span>Approvals</span>
            <strong>{missionHealth.approvalGap}</strong>
          </article>
          <article>
            <span>Handoff</span>
            <strong>{missionHealth.handoffGap}</strong>
          </article>
        </div>
        <p>
          <span>Next step</span>
          {missionHealth.nextStep}
        </p>
      </section>

      {nextStageGateBlocker ? <div className="gate-banner">{nextStageGateBlocker}</div> : null}

      <nav className="stage-tabs" aria-label="Mission stages">
        {mission.stages.map((stage) => {
          const gateReason = getStageGateBlocker(mission, stage.id)

          return (
            <button
              key={stage.id}
              aria-disabled={Boolean(gateReason)}
              aria-selected={stage.id === mission.activeStageId}
              className={`stage-tab${stage.id === mission.activeStageId ? ' stage-tab--active' : ''}`}
              role="tab"
              type="button"
              onClick={() => {
                if (gateReason) {
                  onStatusMessage(gateReason)
                  return
                }

                dispatch({ type: 'set-stage', missionId: mission.id, stageId: stage.id })
                onStatusMessage(`${stage.name} selected.`)
              }}
            >
              <span>{stage.name}</span>
              <small>{gateReason || stage.nextAction}</small>
            </button>
          )
        })}
      </nav>

      <section className="stage-summary">
        <div>
          <p className="section-label">Stage brief</p>
          <h2>{activeStage.name}</h2>
          <p>{activeStage.summary}</p>
        </div>
        <strong>{activeStage.nextAction}</strong>
      </section>

      <section className="lane-grid" aria-label="Agent lanes">
        {activeStage.lanes.map((lane) => {
          const draftKey = `${activeStage.id}:${lane.id}`
          const attachedEvidence = mission.evidence.filter(
            (evidence) => evidence.agentId === lane.id || lane.assignedEvidenceIds.includes(evidence.id),
          )

          return (
            <article className="lane-card" key={lane.id}>
              <div className="lane-card__header">
                <div>
                  <h3>{lane.name}</h3>
                  <p>{lane.role}</p>
                </div>
                <select
                  aria-label={`${lane.name} status`}
                  value={lane.status}
                  onChange={(event) =>
                    dispatch({
                      type: 'update-lane-status',
                      missionId: mission.id,
                      stageId: activeStage.id,
                      laneId: lane.id,
                      status: event.target.value as typeof lane.status,
                    })
                  }
                >
                  {agentStatuses.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>

              <div className="confidence-row">
                <label>
                  Confidence
                  <input
                    max="100"
                    min="0"
                    type="range"
                    value={lane.confidence}
                    onChange={(event) =>
                      dispatch({
                        type: 'update-lane-confidence',
                        missionId: mission.id,
                        stageId: activeStage.id,
                        laneId: lane.id,
                        confidence: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <strong>{lane.confidence}</strong>
              </div>
              <p className="status-help">{statusDescriptions[lane.status]}</p>

              <textarea
                aria-label={`${lane.name} output draft`}
                value={lane.outputDraft}
                onChange={(event) =>
                  dispatch({
                    type: 'update-lane-output',
                    missionId: mission.id,
                    stageId: activeStage.id,
                    laneId: lane.id,
                    output: event.target.value,
                  })
                }
              />

              <div className="finding-box">
                <input
                  aria-label={`Add ${lane.name} finding`}
                  placeholder="Add finding or risk note"
                  value={findingDrafts[draftKey] ?? ''}
                  onChange={(event) => onFindingDraftChange(draftKey, event.target.value)}
                />
                <button type="button" onClick={() => onAddFinding(activeStage.id, lane.id)}>
                  Add
                </button>
              </div>

              <div className="finding-list">
                {lane.findings.map((finding) => (
                  <p key={finding.id}>{finding.text}</p>
                ))}
                {attachedEvidence.length > 0 ? (
                  <small>{attachedEvidence.length} linked evidence item(s)</small>
                ) : (
                  <small>No evidence linked yet</small>
                )}
              </div>
              <button
                className="subtle-button"
                disabled={attachedEvidence.length === 0}
                type="button"
                onClick={() => {
                  dispatch({
                    type: 'draft-handoff-from-evidence',
                    missionId: mission.id,
                    stageId: activeStage.id,
                    laneId: lane.id,
                  })
                  onStatusMessage(`${lane.name} evidence added to the handoff draft.`)
                }}
              >
                Draft from evidence
              </button>
            </article>
          )
        })}
      </section>
    </section>
  )
}
