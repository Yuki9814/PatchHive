import { useState, type FormEvent } from 'react'
import {
  MAX_TRIAL_ELAPSED_MINUTES,
  MIN_TRIAL_ELAPSED_MINUTES,
  buildMaintainerTrialReport,
  serializeMaintainerTrialReport,
  type TrialClarityRating,
  type TrialFrictionArea,
  type TrialOutcome,
  type TrialReuseIntent,
} from '../trialReport'

type TrialFormState = {
  outcome: TrialOutcome | ''
  elapsedMinutes: string
  clarityRating: TrialClarityRating | ''
  reuseIntent: TrialReuseIntent | ''
  primaryFriction: TrialFrictionArea | ''
  consent: boolean
}

type GeneratedTrialReport = {
  contextKey: string
  generatedOn: string
  serialized: string
}

type TrialReportPanelProps = {
  handoffReady: boolean
  handoffBlockerCount: number
  onCopyReport: (serialized: string) => Promise<void>
  onDownloadReport: (serialized: string, generatedOn: string) => void
  onStatusMessage: (message: string) => void
}

const emptyTrialForm = (): TrialFormState => ({
  outcome: '',
  elapsedMinutes: '',
  clarityRating: '',
  reuseIntent: '',
  primaryFriction: '',
  consent: false,
})

function getContextKey(handoffReady: boolean, handoffBlockerCount: number) {
  return `${handoffReady ? 'ready' : 'blocked'}:${handoffBlockerCount}`
}

export function TrialReportPanel({
  handoffReady,
  handoffBlockerCount,
  onCopyReport,
  onDownloadReport,
  onStatusMessage,
}: TrialReportPanelProps) {
  const [form, setForm] = useState<TrialFormState>(() => emptyTrialForm())
  const [generatedReport, setGeneratedReport] =
    useState<GeneratedTrialReport | null>(null)
  const elapsedMinutes = Number(form.elapsedMinutes)
  const elapsedMinutesValid =
    Number.isInteger(elapsedMinutes) &&
    elapsedMinutes >= MIN_TRIAL_ELAPSED_MINUTES &&
    elapsedMinutes <= MAX_TRIAL_ELAPSED_MINUTES
  const formComplete =
    form.outcome !== '' &&
    elapsedMinutesValid &&
    form.clarityRating !== '' &&
    form.reuseIntent !== '' &&
    form.primaryFriction !== '' &&
    form.consent
  const contextKey = getContextKey(handoffReady, handoffBlockerCount)
  const currentReport =
    generatedReport?.contextKey === contextKey ? generatedReport : null

  const updateForm = (update: Partial<TrialFormState>) => {
    setForm((current) => ({ ...current, ...update }))
    setGeneratedReport(null)
  }

  const generateReport = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (
      !formComplete ||
      !form.outcome ||
      !form.clarityRating ||
      !form.reuseIntent ||
      !form.primaryFriction
    ) {
      onStatusMessage(
        'Complete the structured trial fields and consent before generating a report.',
      )
      return
    }

    const report = buildMaintainerTrialReport(
      {
        outcome: form.outcome,
        elapsedMinutes,
        clarityRating: form.clarityRating,
        reuseIntent: form.reuseIntent,
        primaryFriction: form.primaryFriction,
      },
      {
        handoffReady,
        handoffBlockerCount,
      },
    )

    setGeneratedReport({
      contextKey,
      generatedOn: report.generatedOn,
      serialized: serializeMaintainerTrialReport(report),
    })
    onStatusMessage(
      'Minimum-disclosure trial report generated locally. Review it before manual sharing.',
    )
  }

  const clearReport = () => {
    setForm(emptyTrialForm())
    setGeneratedReport(null)
    onStatusMessage('Local trial answers cleared.')
  }

  return (
    <section
      aria-labelledby="maintainer-trial-heading"
      className="inspector-panel trial-panel"
    >
      <div className="panel-title">
        <h2 id="maintainer-trial-heading">Maintainer trial</h2>
        <span>local only</span>
      </div>

      <p className="trial-panel__intro">
        Optional evidence for a consented workflow trial. PatchHive adds no
        mission text, repository identity, browser identity, or free-form
        response, and it neither stores nor sends these answers.
      </p>

      <div className="trial-panel__workflow">
        <strong>Observed handoff state</strong>
        <span>{handoffReady ? 'Ready' : 'Not ready'}</span>
        <small>
          {handoffBlockerCount}{' '}
          {handoffBlockerCount === 1 ? 'blocker' : 'blockers'}
        </small>
      </div>

      <form className="trial-form" onSubmit={generateReport}>
        <div className="form-grid">
          <label>
            Trial outcome
            <select
              required
              value={form.outcome}
              onChange={(event) =>
                updateForm({
                  outcome: event.currentTarget.value as TrialOutcome,
                })
              }
            >
              <option disabled value="">
                Choose outcome
              </option>
              <option value="completed">Completed</option>
              <option value="partially-completed">Partially completed</option>
              <option value="blocked">Blocked</option>
            </select>
          </label>

          <label>
            Elapsed minutes
            <input
              inputMode="numeric"
              max={MAX_TRIAL_ELAPSED_MINUTES}
              min={MIN_TRIAL_ELAPSED_MINUTES}
              required
              type="number"
              value={form.elapsedMinutes}
              onChange={(event) =>
                updateForm({ elapsedMinutes: event.currentTarget.value })
              }
            />
          </label>

          <label>
            Workflow clarity
            <select
              required
              value={form.clarityRating}
              onChange={(event) =>
                updateForm({
                  clarityRating: Number(
                    event.currentTarget.value,
                  ) as TrialClarityRating,
                })
              }
            >
              <option disabled value="">
                Choose 1–5
              </option>
              <option value="1">1 — unclear</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
              <option value="5">5 — clear</option>
            </select>
          </label>

          <label>
            Would use again
            <select
              required
              value={form.reuseIntent}
              onChange={(event) =>
                updateForm({
                  reuseIntent: event.currentTarget.value as TrialReuseIntent,
                })
              }
            >
              <option disabled value="">
                Choose intent
              </option>
              <option value="yes">Yes</option>
              <option value="maybe">Maybe</option>
              <option value="no">No</option>
            </select>
          </label>
        </div>

        <label>
          Primary friction
          <select
            required
            value={form.primaryFriction}
            onChange={(event) =>
              updateForm({
                primaryFriction: event.currentTarget
                  .value as TrialFrictionArea,
              })
            }
          >
            <option disabled value="">
              Choose one area
            </option>
            <option value="none">None</option>
            <option value="setup">Setup</option>
            <option value="scanner-intake">Scanner intake</option>
            <option value="evidence-triage">Evidence and triage</option>
            <option value="approvals">Approvals</option>
            <option value="handoff">Handoff</option>
            <option value="other">Other</option>
          </select>
        </label>

        <label className="trial-consent">
          <input
            checked={form.consent}
            type="checkbox"
            onChange={(event) =>
              updateForm({ consent: event.currentTarget.checked })
            }
          />
          <span>
            I consent to manually share this minimum-disclosure trial report.
          </span>
        </label>

        <button disabled={!formComplete} type="submit">
          Generate trial report
        </button>
      </form>

      {generatedReport && !currentReport ? (
        <p className="trial-panel__stale" role="status">
          The handoff state changed. Generate a fresh report before sharing.
        </p>
      ) : null}

      {currentReport ? (
        <>
          <div
            aria-label="Maintainer trial report preview"
            className="trial-report-preview"
          >
            <strong>Review before sharing</strong>
            <pre>{currentReport.serialized}</pre>
          </div>
          <div className="trial-actions">
            <button
              type="button"
              onClick={() => void onCopyReport(currentReport.serialized)}
            >
              Copy trial report
            </button>
            <button
              type="button"
              onClick={() =>
                onDownloadReport(
                  currentReport.serialized,
                  currentReport.generatedOn,
                )
              }
            >
              Download trial report
            </button>
            <button className="subtle-button" type="button" onClick={clearReport}>
              Clear answers
            </button>
          </div>
        </>
      ) : null}
    </section>
  )
}
