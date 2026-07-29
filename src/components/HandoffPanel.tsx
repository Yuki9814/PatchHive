import type { HandoffDraft, Mission } from '../types'
import {
  handoffPrivacyCategoryLabels,
  MAX_HANDOFF_PRIVACY_CHARACTERS,
  MAX_HANDOFF_PRIVACY_CREDENTIAL_VALUE_CHARACTERS,
  type HandoffPrivacyPreflightResult,
} from '../handoffPrivacy'
import { handoffFieldLabels } from '../workspaceUi'
import { useState } from 'react'

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
  handoffPrivacyPreflight: HandoffPrivacyPreflightResult | null
  handoffPrivacyPreflightEnabled: boolean
  handoffReady: boolean
  handoffBlockers: string[]
  handoffFieldStatusMap: FieldStatusMap
  onUpdateHandoff: (output: Partial<HandoffDraft>) => void
  onCopyHandoff: () => void
  onDownloadHandoff: () => void
  onTogglePrivacyPreflight: (enabled: boolean) => void
}

export function HandoffPanel({
  mission,
  handoffMarkdown,
  handoffPrivacyPreflight,
  handoffPrivacyPreflightEnabled,
  handoffReady,
  handoffBlockers,
  handoffFieldStatusMap,
  onUpdateHandoff,
  onCopyHandoff,
  onDownloadHandoff,
  onTogglePrivacyPreflight,
}: HandoffPanelProps) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const privacyPreflightBlocked =
    handoffPrivacyPreflightEnabled &&
    handoffPrivacyPreflight?.status === 'blocked'
  const visiblePrivacyFindings =
    handoffPrivacyPreflight?.status === 'checked'
      ? handoffPrivacyPreflight.findings.slice(0, 10)
      : []
  const privacyBlockedMessage =
    handoffPrivacyPreflight?.status === 'blocked'
      ? handoffPrivacyPreflight.reason === 'input-too-large'
        ? `Markdown exceeds the ${MAX_HANDOFF_PRIVACY_CHARACTERS.toLocaleString()}-character local scan limit.`
        : handoffPrivacyPreflight.reason ===
            'credential-value-limit-exceeded'
          ? `A credential assignment exceeds the ${MAX_HANDOFF_PRIVACY_CREDENTIAL_VALUE_CHARACTERS.toLocaleString()}-character value limit.`
          : handoffPrivacyPreflight.reason ===
              'credential-value-ambiguous'
            ? 'A quoted credential assignment is unclosed or has an ambiguous closing boundary.'
          : 'The handoff exceeds the bounded sensitive-match limit.'
      : ''

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

      <div className="handoff-privacy">
        <label className="handoff-privacy__toggle">
          <input
            checked={handoffPrivacyPreflightEnabled}
            type="checkbox"
            onChange={(event) =>
              onTogglePrivacyPreflight(event.currentTarget.checked)
            }
          />
          <span>Run local privacy preflight</span>
        </label>
        <p>
          Optional and entirely local. When enabled, the preview, clipboard,
          and download use deterministically masked Markdown. A zero-match
          result does not mean the handoff is safe; review it before sharing.
        </p>

        {handoffPrivacyPreflightEnabled &&
        handoffPrivacyPreflight?.status === 'checked' ? (
          <div className="handoff-privacy__result" role="status">
            <strong>
              {handoffPrivacyPreflight.findings.length > 0
                ? `${handoffPrivacyPreflight.findings.length} potential sensitive value(s) masked`
                : 'No configured sensitive patterns matched'}
            </strong>
            <p>
              {handoffPrivacyPreflight.findings.length > 0
                ? 'The findings list shows only category and original line number; it never repeats matched values.'
                : 'This is not a safety guarantee. Manually review the generated Markdown before sharing.'}
            </p>
            {visiblePrivacyFindings.length > 0 ? (
              <ul aria-label="Privacy preflight findings">
                {visiblePrivacyFindings.map((finding, index) => (
                  <li key={`${finding.category}-${finding.line}-${index}`}>
                    {handoffPrivacyCategoryLabels[finding.category]} · line{' '}
                    {finding.line}
                  </li>
                ))}
              </ul>
            ) : null}
            {handoffPrivacyPreflight.findings.length >
            visiblePrivacyFindings.length ? (
              <p>
                {handoffPrivacyPreflight.findings.length -
                  visiblePrivacyFindings.length}{' '}
                additional match(es) are masked in the preview and export.
              </p>
            ) : null}
          </div>
        ) : null}

        {privacyPreflightBlocked ? (
          <div className="handoff-privacy__blocked" role="alert">
            <strong>Privacy preflight could not complete</strong>
            <p>
              {privacyBlockedMessage} Export remains locked while the check is
              enabled.
            </p>
          </div>
        ) : null}
      </div>

      <div className="handoff-actions">
        <button
          disabled={!handoffReady || privacyPreflightBlocked}
          type="button"
          onClick={onCopyHandoff}
        >
          {handoffPrivacyPreflightEnabled
            ? 'Copy redacted Markdown'
            : 'Copy Markdown'}
        </button>
        <button
          disabled={!handoffReady || privacyPreflightBlocked}
          type="button"
          onClick={onDownloadHandoff}
        >
          {handoffPrivacyPreflightEnabled
            ? 'Download redacted'
            : 'Download'}
        </button>
      </div>
      <details
        className="handoff-preview"
        open={previewOpen}
        onToggle={(event) => setPreviewOpen(event.currentTarget.open)}
      >
        <summary>
          {handoffPrivacyPreflightEnabled
            ? 'Redacted Markdown preview'
            : 'Markdown preview'}
        </summary>
        {previewOpen && !privacyPreflightBlocked ? (
          <pre>{handoffMarkdown}</pre>
        ) : null}
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
