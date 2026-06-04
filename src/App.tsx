import { useEffect, useReducer, useState } from 'react'
import './App.css'
import { buildHandoffMarkdown, isHandoffReady } from './handoff'
import { loadWorkspace, saveWorkspace } from './storage'
import { missionTemplates } from './templates'
import type { AgentStatus, ComposerInput, EvidenceKind, Mission, MissionTemplate } from './types'
import type { FormEvent } from 'react'
import { workspaceReducer } from './workspaceReducer'

type EvidenceForm = {
  kind: EvidenceKind
  title: string
  detail: string
  sourceText: string
  url: string
  filePath: string
  agentId: string
}

const agentStatuses: AgentStatus[] = ['idle', 'scanning', 'drafting', 'waiting', 'ready', 'blocked']
const evidenceKinds: EvidenceKind[] = ['file', 'log', 'decision', 'link', 'diff']

const getTemplate = (templateId: string) =>
  missionTemplates.find((template) => template.id === templateId) ?? missionTemplates[0]

function createComposerInput(template: MissionTemplate = missionTemplates[0]): ComposerInput {
  return {
    templateId: template.id,
    title: template.name,
    sourceKind: 'github-url',
    sourceText: '',
    goal: template.defaultGoal,
    branch: 'main',
    constraints: template.defaultConstraints.join('\n'),
  }
}

const emptyEvidenceForm = (): EvidenceForm => ({
  kind: 'decision',
  title: '',
  detail: '',
  sourceText: '',
  url: '',
  filePath: '',
  agentId: '',
})

function getActiveMission(missions: Mission[], activeMissionId: string) {
  return missions.find((mission) => mission.id === activeMissionId) ?? missions[0]
}

function getLockedStageReason(mission: Mission) {
  const currentIndex = mission.stages.findIndex((stage) => stage.id === mission.activeStageId)
  const nextStage = mission.stages[currentIndex + 1]

  if (!nextStage) {
    return ''
  }

  const blocker = mission.approvals.find(
    (approval) => !approval.approved && approval.requiredBefore === nextStage.name,
  )

  return blocker ? `${blocker.label} is required before ${nextStage.name}.` : ''
}

function App() {
  const [state, dispatch] = useReducer(workspaceReducer, undefined, loadWorkspace)
  const [composerOpen, setComposerOpen] = useState(false)
  const [composer, setComposer] = useState<ComposerInput>(() => createComposerInput())
  const [evidenceForm, setEvidenceForm] = useState<EvidenceForm>(() => emptyEvidenceForm())
  const [findingDrafts, setFindingDrafts] = useState<Record<string, string>>({})
  const [statusMessage, setStatusMessage] = useState('Workspace loaded.')

  useEffect(() => {
    saveWorkspace(state)
  }, [state])

  const activeMission = getActiveMission(state.missions, state.activeMissionId)
  const activeStage = activeMission?.stages.find((stage) => stage.id === activeMission.activeStageId)
  const handoffMarkdown = activeMission ? buildHandoffMarkdown(activeMission) : ''
  const handoffReady = activeMission ? isHandoffReady(activeMission) : false
  const stageLockReason = activeMission ? getLockedStageReason(activeMission) : ''
  const currentLanes = activeStage?.lanes ?? []

  const handleTemplateChange = (templateId: string) => {
    const template = getTemplate(templateId)
    setComposer(createComposerInput(template))
  }

  const createMission = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!composer.title.trim() || !composer.goal.trim() || !composer.sourceText.trim()) {
      setStatusMessage('Title, goal, and source are required before a mission can start.')
      return
    }

    dispatch({ type: 'create-mission', input: composer })
    setComposerOpen(false)
    setComposer(createComposerInput(getTemplate(composer.templateId)))
    setStatusMessage('Mission created and selected.')
  }

  const addEvidence = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!activeMission || !evidenceForm.title.trim() || !evidenceForm.detail.trim()) {
      setStatusMessage('Evidence needs a title and detail.')
      return
    }

    dispatch({
      type: 'add-evidence',
      missionId: activeMission.id,
      evidence: {
        kind: evidenceForm.kind,
        title: evidenceForm.title.trim(),
        detail: evidenceForm.detail.trim(),
        sourceText: evidenceForm.sourceText.trim() || undefined,
        url: evidenceForm.url.trim() || undefined,
        filePath: evidenceForm.filePath.trim() || undefined,
        agentId: evidenceForm.agentId || undefined,
      },
    })
    setEvidenceForm(emptyEvidenceForm())
    setStatusMessage('Evidence attached to the mission.')
  }

  const addFinding = (stageId: string, laneId: string) => {
    if (!activeMission) {
      return
    }

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
    if (!activeMission || !handoffReady) {
      setStatusMessage('All approvals are required before copying the handoff.')
      return
    }

    await navigator.clipboard.writeText(handoffMarkdown)
    setStatusMessage('Handoff Markdown copied.')
  }

  const downloadHandoff = () => {
    if (!activeMission || !handoffReady) {
      setStatusMessage('All approvals are required before downloading the handoff.')
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

  if (!activeMission || !activeStage) {
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

  return (
    <main className="workspace-shell">
      <aside className="sidebar" aria-label="Mission navigation">
        <div className="brand-row">
          <div className="brand-mark">PH</div>
          <div>
            <strong>PatchHive</strong>
            <span>Maintainer workbench</span>
          </div>
        </div>

        <button className="primary-action" type="button" onClick={() => setComposerOpen(true)}>
          New mission
        </button>

        <div className="sidebar-section">
          <p className="section-label">Active missions</p>
          <div className="mission-list">
            {state.missions.map((mission) => {
              const ready = isHandoffReady(mission)
              const currentStage =
                mission.stages.find((stage) => stage.id === mission.activeStageId) ?? mission.stages[0]

              return (
                <button
                  key={mission.id}
                  aria-pressed={mission.id === activeMission.id}
                  className={`mission-row${mission.id === activeMission.id ? ' mission-row--active' : ''}`}
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
          <button
            className="subtle-button"
            type="button"
            onClick={() => {
              dispatch({ type: 'reset-workspace' })
              setStatusMessage('Workspace reset to sample data.')
            }}
          >
            Reset sample
          </button>
        </div>
      </aside>

      <section className="mission-workspace">
        <header className="topbar">
          <div>
            <p className="section-label">Current mission</p>
            <h1>{activeMission.title}</h1>
            <p>{activeMission.goal}</p>
          </div>
          <div className="topbar-actions">
            <span className={`readiness ${handoffReady ? 'readiness--ready' : ''}`}>
              {handoffReady ? 'Ready for handoff' : 'Approvals pending'}
            </span>
            <button
              className="secondary-button"
              disabled={Boolean(stageLockReason)}
              type="button"
              onClick={() => {
                dispatch({ type: 'advance-stage', missionId: activeMission.id })
                setStatusMessage(stageLockReason || 'Mission advanced to the next stage.')
              }}
            >
              Advance stage
            </button>
          </div>
        </header>

        <section className="context-strip" aria-label="Mission context">
          <div>
            <span>Repository</span>
            <strong>{activeMission.repo}</strong>
          </div>
          <div>
            <span>Branch</span>
            <strong>{activeMission.branch}</strong>
          </div>
          <div>
            <span>Evidence</span>
            <strong>{activeMission.evidence.length}</strong>
          </div>
          <div>
            <span>Approvals</span>
            <strong>
              {activeMission.approvals.filter((approval) => approval.approved).length}/
              {activeMission.approvals.length}
            </strong>
          </div>
        </section>

        {stageLockReason ? <div className="gate-banner">{stageLockReason}</div> : null}

        <nav className="stage-tabs" aria-label="Mission stages">
          {activeMission.stages.map((stage) => (
            <button
              key={stage.id}
              aria-selected={stage.id === activeMission.activeStageId}
              className={`stage-tab${stage.id === activeMission.activeStageId ? ' stage-tab--active' : ''}`}
              role="tab"
              type="button"
              onClick={() =>
                dispatch({ type: 'set-stage', missionId: activeMission.id, stageId: stage.id })
              }
            >
              <span>{stage.name}</span>
              <small>{stage.nextAction}</small>
            </button>
          ))}
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
            const attachedEvidence = activeMission.evidence.filter(
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
                        missionId: activeMission.id,
                        stageId: activeStage.id,
                        laneId: lane.id,
                        status: event.target.value as AgentStatus,
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
                  <span>Confidence</span>
                  <strong>{lane.confidence}</strong>
                </div>

                <textarea
                  aria-label={`${lane.name} output draft`}
                  value={lane.outputDraft}
                  onChange={(event) =>
                    dispatch({
                      type: 'update-lane-output',
                      missionId: activeMission.id,
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
                    onChange={(event) =>
                      setFindingDrafts((drafts) => ({ ...drafts, [draftKey]: event.target.value }))
                    }
                  />
                  <button type="button" onClick={() => addFinding(activeStage.id, lane.id)}>
                    Add
                  </button>
                </div>

                <div className="finding-list">
                  {lane.findings.slice(0, 3).map((finding) => (
                    <p key={finding.id}>{finding.text}</p>
                  ))}
                  {attachedEvidence.length > 0 ? (
                    <small>{attachedEvidence.length} linked evidence item(s)</small>
                  ) : (
                    <small>No evidence linked yet</small>
                  )}
                </div>
              </article>
            )
          })}
        </section>
      </section>

      <aside className="inspector" aria-label="Evidence, approvals, and handoff">
        <section className="inspector-panel">
          <div className="panel-title">
            <h2>Evidence</h2>
            <span>{activeMission.evidence.length}</span>
          </div>

          <form className="evidence-form" onSubmit={addEvidence}>
            <div className="form-grid">
              <label>
                Type
                <select
                  value={evidenceForm.kind}
                  onChange={(event) =>
                    setEvidenceForm((form) => ({ ...form, kind: event.target.value as EvidenceKind }))
                  }
                >
                  {evidenceKinds.map((kind) => (
                    <option key={kind} value={kind}>
                      {kind}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Agent
                <select
                  value={evidenceForm.agentId}
                  onChange={(event) =>
                    setEvidenceForm((form) => ({ ...form, agentId: event.target.value }))
                  }
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
              placeholder="Evidence title"
              value={evidenceForm.title}
              onChange={(event) => setEvidenceForm((form) => ({ ...form, title: event.target.value }))}
            />
            <textarea
              placeholder="What this proves or changes"
              value={evidenceForm.detail}
              onChange={(event) => setEvidenceForm((form) => ({ ...form, detail: event.target.value }))}
            />
            <input
              placeholder="URL or file path"
              value={evidenceForm.url || evidenceForm.filePath}
              onChange={(event) =>
                setEvidenceForm((form) => ({
                  ...form,
                  url: event.target.value.startsWith('http') ? event.target.value : '',
                  filePath: event.target.value.startsWith('http') ? '' : event.target.value,
                }))
              }
            />
            <button className="secondary-button" type="submit">
              Attach evidence
            </button>
          </form>

          <div className="evidence-list">
            {activeMission.evidence.map((evidence) => (
              <article className="evidence-item" key={evidence.id}>
                <span>{evidence.kind}</span>
                <strong>{evidence.title}</strong>
                <p>{evidence.detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="inspector-panel">
          <div className="panel-title">
            <h2>Approvals</h2>
            <span>{handoffReady ? 'clear' : 'gated'}</span>
          </div>
          <div className="approval-list">
            {activeMission.approvals.map((approval) => (
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
                      missionId: activeMission.id,
                      approvalId: approval.id,
                    })
                    setStatusMessage(
                      approval.approved ? 'Approval withdrawn.' : 'Approval recorded with timestamp.',
                    )
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

          <label>
            Summary
            <textarea
              value={activeMission.outputs.summary}
              onChange={(event) =>
                dispatch({
                  type: 'update-handoff',
                  missionId: activeMission.id,
                  output: { summary: event.target.value },
                })
              }
            />
          </label>
          <label>
            Patch plan
            <textarea
              value={activeMission.outputs.patchPlan}
              onChange={(event) =>
                dispatch({
                  type: 'update-handoff',
                  missionId: activeMission.id,
                  output: { patchPlan: event.target.value },
                })
              }
            />
          </label>
          <label>
            Test plan
            <textarea
              value={activeMission.outputs.testPlan}
              onChange={(event) =>
                dispatch({
                  type: 'update-handoff',
                  missionId: activeMission.id,
                  output: { testPlan: event.target.value },
                })
              }
            />
          </label>
          <label>
            Maintainer comment
            <textarea
              value={activeMission.outputs.maintainerComment}
              onChange={(event) =>
                dispatch({
                  type: 'update-handoff',
                  missionId: activeMission.id,
                  output: { maintainerComment: event.target.value },
                })
              }
            />
          </label>

          <div className="handoff-actions">
            <button disabled={!handoffReady} type="button" onClick={copyHandoff}>
              Copy Markdown
            </button>
            <button disabled={!handoffReady} type="button" onClick={downloadHandoff}>
              Download
            </button>
          </div>
        </section>
      </aside>

      {composerOpen ? (
        <div className="drawer-backdrop" role="presentation">
          <section className="composer-drawer" aria-label="Create mission">
            <div className="drawer-header">
              <div>
                <p className="section-label">Mission Composer</p>
                <h2>Create a maintainer workflow</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setComposerOpen(false)}>
                Close
              </button>
            </div>

            <form className="composer-form" onSubmit={createMission}>
              <label>
                Template
                <select value={composer.templateId} onChange={(event) => handleTemplateChange(event.target.value)}>
                  {state.templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Title
                <input
                  value={composer.title}
                  onChange={(event) => setComposer((input) => ({ ...input, title: event.target.value }))}
                />
              </label>
              <div className="form-grid">
                <label>
                  Source type
                  <select
                    value={composer.sourceKind}
                    onChange={(event) =>
                      setComposer((input) => ({
                        ...input,
                        sourceKind: event.target.value as ComposerInput['sourceKind'],
                      }))
                    }
                  >
                    <option value="github-url">GitHub URL</option>
                    <option value="diff-paste">Pasted diff</option>
                    <option value="log-paste">Pasted log</option>
                    <option value="manual">Manual brief</option>
                  </select>
                </label>
                <label>
                  Branch
                  <input
                    value={composer.branch}
                    onChange={(event) => setComposer((input) => ({ ...input, branch: event.target.value }))}
                  />
                </label>
              </div>
              <label>
                Source
                <textarea
                  required
                  placeholder="Paste a GitHub PR/issue URL, diff, log, or mission brief"
                  value={composer.sourceText}
                  onChange={(event) =>
                    setComposer((input) => ({ ...input, sourceText: event.target.value }))
                  }
                />
              </label>
              <label>
                Goal
                <textarea
                  value={composer.goal}
                  onChange={(event) => setComposer((input) => ({ ...input, goal: event.target.value }))}
                />
              </label>
              <label>
                Guardrails
                <textarea
                  value={composer.constraints}
                  onChange={(event) =>
                    setComposer((input) => ({ ...input, constraints: event.target.value }))
                  }
                />
              </label>
              <button className="primary-action" type="submit">
                Start mission
              </button>
            </form>
          </section>
        </div>
      ) : null}

      <div className="sr-status" aria-live="polite">
        {statusMessage}
      </div>
    </main>
  )
}

export default App
