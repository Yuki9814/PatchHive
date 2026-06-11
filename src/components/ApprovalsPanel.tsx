import type { Mission } from '../types'
import type { WorkspaceAction } from '../workspaceReducer'
import type { Dispatch } from 'react'

type ApprovalsPanelProps = {
  mission: Mission
  handoffReady: boolean
  onStatusMessage: (message: string) => void
  dispatch: Dispatch<WorkspaceAction>
}

export function ApprovalsPanel({ mission, handoffReady, onStatusMessage, dispatch }: ApprovalsPanelProps) {
  return (
    <section className="inspector-panel" id="panel-approvals">
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
  )
}
