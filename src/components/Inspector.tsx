import type { EvidenceTriageStatus, HandoffDraft, Mission, MissionStage } from '../types'
import type {
  EvidenceSeverityFilter,
  EvidenceTriageFilter,
} from '../evidenceView'
import type { HandoffPrivacyPreflightResult } from '../handoffPrivacy'
import type { HandoffFormat } from '../handoff'
import type { EvidenceFilter, EvidenceForm } from '../workspaceUi'
import type { WorkspaceAction } from '../workspaceReducer'
import { ApprovalsPanel } from './ApprovalsPanel'
import { EvidencePanel } from './EvidencePanel'
import { HandoffPanel } from './HandoffPanel'
import { ScanImportPanel } from './ScanImportPanel'
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
  handoffPrivacyPreflight: HandoffPrivacyPreflightResult | null
  handoffPrivacyPreflightEnabled: boolean
  handoffFormat: HandoffFormat
  handoffReady: boolean
  handoffBlockers: string[]
  handoffFieldStatusMap: FieldStatusMap
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
  onCopyHandoff: () => void
  onDownloadHandoff: () => void
  onHandoffFormatChange: (format: HandoffFormat) => void
  onToggleHandoffPrivacyPreflight: (enabled: boolean) => void
  onStatusMessage: (message: string) => void
  dispatch: Dispatch<WorkspaceAction>
}

export function Inspector({
  mission,
  activeStage,
  handoffMarkdown,
  handoffPrivacyPreflight,
  handoffPrivacyPreflightEnabled,
  handoffFormat,
  handoffReady,
  handoffBlockers,
  handoffFieldStatusMap,
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
  onCopyHandoff,
  onDownloadHandoff,
  onHandoffFormatChange,
  onToggleHandoffPrivacyPreflight,
  onStatusMessage,
  dispatch,
}: InspectorProps) {
  const updateHandoff = (output: Partial<HandoffDraft>) =>
    dispatch({
      type: 'update-handoff',
      missionId: mission.id,
      output,
    })

  const setEvidenceTriage = (
    evidenceId: string,
    triageStatus: EvidenceTriageStatus,
    resolutionNote?: string,
  ) =>
    dispatch({
      type: 'set-scanner-triage',
      missionId: mission.id,
      evidenceId,
      triageStatus,
      resolutionNote,
    })

  return (
    <aside className="inspector" aria-label="Evidence, approvals, and handoff">
      <ScanImportPanel
        dispatch={dispatch}
        mission={mission}
        onStatusMessage={onStatusMessage}
        stageId={activeStage.id}
      />

      <EvidencePanel
        key={mission.id}
        activeStage={activeStage}
        editingEvidenceId={editingEvidenceId}
        evidenceAgentFilter={evidenceAgentFilter}
        evidenceFilter={evidenceFilter}
        evidenceForm={evidenceForm}
        evidenceSeverityFilter={evidenceSeverityFilter}
        evidenceStageFilter={evidenceStageFilter}
        evidenceTriageFilter={evidenceTriageFilter}
        filteredEvidence={filteredEvidence}
        mission={mission}
        onCancelEvidenceEdit={onCancelEvidenceEdit}
        onDeleteEvidence={onDeleteEvidence}
        onEvidenceAgentFilterChange={onEvidenceAgentFilterChange}
        onEvidenceFilterChange={onEvidenceFilterChange}
        onEvidenceFormChange={onEvidenceFormChange}
        onEvidenceSeverityFilterChange={onEvidenceSeverityFilterChange}
        onEvidenceStageFilterChange={onEvidenceStageFilterChange}
        onEvidenceTriageFilterChange={onEvidenceTriageFilterChange}
        onStartEvidenceEdit={onStartEvidenceEdit}
        onSubmitEvidence={onSubmitEvidence}
        onSetEvidenceTriage={setEvidenceTriage}
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
        handoffPrivacyPreflight={handoffPrivacyPreflight}
        handoffPrivacyPreflightEnabled={handoffPrivacyPreflightEnabled}
        handoffFormat={handoffFormat}
        handoffReady={handoffReady}
        mission={mission}
        onCopyHandoff={onCopyHandoff}
        onDownloadHandoff={onDownloadHandoff}
        onHandoffFormatChange={onHandoffFormatChange}
        onTogglePrivacyPreflight={onToggleHandoffPrivacyPreflight}
        onUpdateHandoff={updateHandoff}
      />
    </aside>
  )
}
