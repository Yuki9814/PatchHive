import { isHandoffReady } from '../handoff'
import type { WorkspaceState } from '../types'
import type { WorkspaceAction } from '../workspaceReducer'
import type { ChangeEvent, Dispatch, RefObject } from 'react'

type MissionSidebarProps = {
  state: WorkspaceState
  activeMissionId: string
  importInputRef: RefObject<HTMLInputElement | null>
  newMissionButtonRef: RefObject<HTMLButtonElement | null>
  onNewMission: () => void
  onExportWorkspace: () => void
  onImportWorkspace: (event: ChangeEvent<HTMLInputElement>) => void
  onResetWorkspace: () => void
  dispatch: Dispatch<WorkspaceAction>
}

export function MissionSidebar({
  state,
  activeMissionId,
  importInputRef,
  newMissionButtonRef,
  onNewMission,
  onExportWorkspace,
  onImportWorkspace,
  onResetWorkspace,
  dispatch,
}: MissionSidebarProps) {
  return (
    <aside className="sidebar" aria-label="Mission navigation">
      <div className="brand-row">
        <div className="brand-mark">PH</div>
        <div>
          <strong>PatchHive</strong>
          <span>Maintainer workbench</span>
        </div>
      </div>

      <button ref={newMissionButtonRef} className="primary-action" type="button" onClick={onNewMission}>
        New mission
      </button>

      <div className="sidebar-section">
        <p className="section-label">Active missions</p>
        <div className="mission-list">
          {state.missions.map((mission) => {
            const ready = isHandoffReady(mission)
            const currentStage = mission.stages.find((stage) => stage.id === mission.activeStageId) ?? mission.stages[0]

            return (
              <button
                key={mission.id}
                aria-pressed={mission.id === activeMissionId}
                className={`mission-row${mission.id === activeMissionId ? ' mission-row--active' : ''}`}
                type="button"
                onClick={() => dispatch({ type: 'select-mission', missionId: mission.id })}
              >
                <span>{mission.title}</span>
                <small>
                  {currentStage.name} · {ready ? 'ready' : 'gated'}
                </small>
              </button>
            )
          })}
        </div>
      </div>

      <div className="sidebar-section sidebar-section--bottom">
        <p className="section-label">Local data</p>
        <p className="muted-copy">Missions save in browser storage. No OAuth, server, or model calls in v1.</p>
        <label className="guidance-toggle">
          <input
            type="checkbox"
            checked={state.settings.showGuidance}
            onChange={(event) =>
              dispatch({ type: 'update-settings', settings: { showGuidance: event.target.checked } })
            }
          />
          Show guidance
        </label>
        <div className="local-data-actions">
          <button className="subtle-button" type="button" onClick={onExportWorkspace}>
            Export JSON
          </button>
          <button className="subtle-button" type="button" onClick={() => importInputRef.current?.click()}>
            Import JSON
          </button>
          <button className="subtle-button" type="button" onClick={onResetWorkspace}>
            Reset sample
          </button>
        </div>
        <input
          ref={importInputRef}
          aria-label="Import workspace JSON"
          className="file-input"
          type="file"
          accept="application/json,.json"
          onChange={onImportWorkspace}
        />
      </div>
    </aside>
  )
}
