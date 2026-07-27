import { useRef, useState } from 'react'
import {
  MAX_SCAN_IMPORT_BYTES,
  previewAgentHygieneImport,
  type AgentHygieneImportPreview,
} from '../agentHygieneImport'
import {
  getAgentHygieneImportConflict,
  type WorkspaceAction,
} from '../workspaceReducer'
import type { Mission } from '../types'
import type { ChangeEvent, Dispatch } from 'react'

type ScanImportPanelProps = {
  mission: Mission
  stageId: string
  dispatch: Dispatch<WorkspaceAction>
  onStatusMessage: (message: string) => void
}

export function ScanImportPanel({
  mission,
  stageId,
  dispatch,
  onStatusMessage,
}: ScanImportPanelProps) {
  const [rawScan, setRawScan] = useState('')
  const [sourceName, setSourceName] = useState('pasted scan')
  const [preview, setPreview] = useState<AgentHygieneImportPreview | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const createPreview = (raw = rawScan, name = sourceName) => {
    try {
      const nextPreview = previewAgentHygieneImport(raw, name)
      setPreview(nextPreview)
      onStatusMessage(
        `Previewed ${nextPreview.findings.length} agent-hygiene finding(s); nothing imported yet.`,
      )
    } catch (error) {
      setPreview(null)
      onStatusMessage(error instanceof Error ? error.message : 'Scan preview failed.')
    }
  }

  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    if (file.size > MAX_SCAN_IMPORT_BYTES) {
      setPreview(null)
      onStatusMessage('Scan import exceeds the 1 MB local preview limit.')
      event.target.value = ''
      return
    }

    try {
      const fileText = await file.text()
      setRawScan(fileText)
      setSourceName(file.name)
      createPreview(fileText, file.name)
    } catch {
      setPreview(null)
      onStatusMessage('The selected scan file could not be read locally.')
    } finally {
      event.target.value = ''
    }
  }

  const commitImport = () => {
    if (!preview) {
      onStatusMessage('Preview a valid scan before importing it.')
      return
    }

    const conflict = getAgentHygieneImportConflict(mission, preview)

    if (conflict) {
      onStatusMessage(conflict)
      return
    }

    dispatch({
      type: 'import-agent-hygiene-scan',
      missionId: mission.id,
      stageId,
      scan: preview,
    })
    onStatusMessage(
      `Imported ${preview.findings.length} finding(s) with provenance; ${preview.blockerCount} blocker(s) require triage.`,
    )
    setRawScan('')
    setSourceName('pasted scan')
    setPreview(null)
  }

  return (
    <section className="inspector-panel scan-import-panel" id="panel-scan-import">
      <div className="panel-title">
        <h2>Scanner intake</h2>
        <span>local only</span>
      </div>
      <p className="muted-copy">
        Preview agent-hygiene JSON or SARIF locally. After confirmation, PatchHive persists only
        normalized findings and provenance, not the complete source document.
      </p>
      <details className="scan-import-help">
        <summary>Create a portable import file</summary>
        <p>
          Run{' '}
          <code>
            agent-hygiene scan . --format json --portable --source-revision &lt;commit&gt;
            --output agent-hygiene.json
          </code>
          , or use the agent-hygiene v0.5 Action <code>json</code> input and download its artifact.
        </p>
        <p>
          A fixed finding resolves only after a complete rerun with the same opaque scan scope no
          longer reports it.
        </p>
      </details>
      <label>
        Scan JSON or SARIF
        <textarea
          aria-describedby="scan-import-limit"
          placeholder='Paste {"summary":...,"findings":[...]} or SARIF 2.1.0'
          value={rawScan}
          onChange={(event) => {
            setRawScan(event.target.value)
            setSourceName('pasted scan')
            setPreview(null)
          }}
        />
      </label>
      <small id="scan-import-limit">
        1 MB maximum · 250 findings maximum · agent-hygiene output only
      </small>
      <div className="scan-import-actions">
        <button className="secondary-button" type="button" onClick={() => createPreview()}>
          Preview scan
        </button>
        <button className="subtle-button" type="button" onClick={() => fileInputRef.current?.click()}>
          Choose file
        </button>
        <input
          ref={fileInputRef}
          className="file-input"
          type="file"
          accept=".json,.sarif,application/json"
          aria-label="Import agent-hygiene scan"
          onChange={readFile}
        />
      </div>

      {preview ? (
        <div className="scan-preview" aria-label="agent-hygiene import preview">
          <strong>
            {preview.format.toUpperCase()} · {preview.findings.length} findings ·{' '}
            {preview.scanComplete ? 'complete' : 'incomplete'}
          </strong>
          <p>
            Producer metadata: {preview.producerStatus}
            {preview.producerVersion ? ` · v${preview.producerVersion}` : ''}
            {preview.sourceRevision ? ` · revision ${preview.sourceRevision.slice(0, 12)}` : ''}
          </p>
          <p>
            Critical {preview.severityCounts.critical} · High {preview.severityCounts.high} ·
            Medium {preview.severityCounts.medium} · Low {preview.severityCounts.low}
          </p>
          {preview.score === undefined ? null : <p>Scanner score: {preview.score}/100</p>}
          {preview.warnings.map((warning) => (
            <p className="scan-preview__warning" key={warning}>
              {warning}
            </p>
          ))}
          <button className="primary-action" type="button" onClick={commitImport}>
            Import into current stage
          </button>
        </div>
      ) : null}
    </section>
  )
}
