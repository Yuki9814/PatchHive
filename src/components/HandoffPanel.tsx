import type { HandoffDraft, Mission } from '../types'
import { handoffFieldLabels } from '../workspaceUi'

type FieldStatusMap = Record<
  string,
  {
    complete: boolean
    sourceCount: number
  }
>

type HandoffPanelProps = {
  mission: Mission
  handoffMarkdown: string
  handoffReady: boolean
  handoffBlockers: string[]
  handoffFieldStatusMap: FieldStatusMap
  onUpdateHandoff: (output: Partial<HandoffDraft>) => void
  onCopyHandoff: () => void
  onDownloadHandoff: () => void
}

export function HandoffPanel({
  mission,
  handoffMarkdown,
  handoffReady,
  handoffBlockers,
  handoffFieldStatusMap,
  onUpdateHandoff,
  onCopyHandoff,
  onDownloadHandoff,
}: HandoffPanelProps) {
  return (
    <section className="inspector-panel handoff-panel" id="panel-handoff">
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
        label={handoffFieldLabels.summary}
        sourceCount={handoffFieldStatusMap.summary?.sourceCount}
        value={mission.outputs.summary}
        onChange={(summary) => onUpdateHandoff({ summary })}
      />
      <HandoffField
        complete={handoffFieldStatusMap.patchPlan?.complete}
        label={handoffFieldLabels.patchPlan}
        sourceCount={handoffFieldStatusMap.patchPlan?.sourceCount}
        value={mission.outputs.patchPlan}
        onChange={(patchPlan) => onUpdateHandoff({ patchPlan })}
      />
      <HandoffField
        complete={handoffFieldStatusMap.testPlan?.complete}
        label={handoffFieldLabels.testPlan}
        sourceCount={handoffFieldStatusMap.testPlan?.sourceCount}
        value={mission.outputs.testPlan}
        onChange={(testPlan) => onUpdateHandoff({ testPlan })}
      />
      <HandoffField
        complete={handoffFieldStatusMap.risks?.complete}
        label={handoffFieldLabels.risks}
        sourceCount={handoffFieldStatusMap.risks?.sourceCount}
        value={mission.outputs.risks}
        onChange={(risks) => onUpdateHandoff({ risks })}
      />
      <HandoffField
        complete={handoffFieldStatusMap.maintainerComment?.complete}
        label={handoffFieldLabels.maintainerComment}
        sourceCount={handoffFieldStatusMap.maintainerComment?.sourceCount}
        value={mission.outputs.maintainerComment}
        onChange={(maintainerComment) => onUpdateHandoff({ maintainerComment })}
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
  )
}

function HandoffField({
  complete,
  label,
  sourceCount = 0,
  value,
  onChange,
}: {
  complete?: boolean
  label: string
  sourceCount?: number
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="handoff-field">
      <span>
        {label}
        <strong className={complete ? 'is-complete' : ''}>{complete ? 'Done' : 'Missing'}</strong>
        <strong className={sourceCount > 0 ? 'is-complete' : ''}>
          {sourceCount > 0 ? `${sourceCount} source(s)` : 'No source'}
        </strong>
      </span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}
