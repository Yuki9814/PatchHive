import type { HandoffDraft, Mission, MissionStage } from '../types'
import type { EvidenceFilter, EvidenceForm } from '../workspaceUi'
import type { WorkspaceAction } from '../workspaceReducer'
import { ApprovalsPanel } from './ApprovalsPanel'
import { EvidencePanel } from './EvidencePanel'
import { HandoffPanel } from './HandoffPanel'
import type { Dispatch, FormEvent } from 'react'

type FieldStatusMap = Record<
  string,
  {
    complete: boolean
    sourceCount: number
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
  onCopyHandoff,
  onDownloadHandoff,
  onStatusMessage,
  dispatch,
}: InspectorProps) {
  const updateHandoff = (output: Partial<HandoffDraft>) =>
    dispatch({
      type: 'update-handoff',
      missionId: mission.id,
      output,
    })

  return (
    <aside className="inspector" aria-label="Evidence, approvals, and handoff">
      <EvidencePanel
        activeStage={activeStage}
        editingEvidenceId={editingEvidenceId}
        evidenceAgentFilter={evidenceAgentFilter}
        evidenceFilter={evidenceFilter}
        evidenceForm={evidenceForm}
        evidenceStageFilter={evidenceStageFilter}
        filteredEvidence={filteredEvidence}
        mission={mission}
        onCancelEvidenceEdit={onCancelEvidenceEdit}
        onDeleteEvidence={onDeleteEvidence}
        onEvidenceAgentFilterChange={onEvidenceAgentFilterChange}
        onEvidenceFilterChange={onEvidenceFilterChange}
        onEvidenceFormChange={onEvidenceFormChange}
        onEvidenceStageFilterChange={onEvidenceStageFilterChange}
        onStartEvidenceEdit={onStartEvidenceEdit}
        onSubmitEvidence={onSubmitEvidence}
        unlinkedEvidenceCount={unlinkedEvidenceCount}
      />

      <ApprovalsPanel
        dispatch={dispatch}
        handoffReady={handoffReady}
        mission={mission}
        onStatusMessage={onStatusMessage}
      />

      <HandoffPanel
        handoffBlockers={handoffBlockers}
        handoffFieldStatusMap={handoffFieldStatusMap}
        handoffMarkdown={handoffMarkdown}
        handoffReady={handoffReady}
        mission={mission}
        onCopyHandoff={onCopyHandoff}
        onDownloadHandoff={onDownloadHandoff}
        onUpdateHandoff={updateHandoff}
      />
    </aside>
  )
}
