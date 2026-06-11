import { parseGithubSource } from '../templates'
import type { ComposerInput, MissionTemplate } from '../types'
import { getTemplate, sourceHints } from '../workspaceUi'
import { useEffect, useRef } from 'react'
import type { FormEvent } from 'react'

type MissionComposerProps = {
  composer: ComposerInput
  templates: MissionTemplate[]
  showGuidance: boolean
  onComposerChange: (composer: ComposerInput) => void
  onTemplateChange: (templateId: string) => void
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

export function MissionComposer({
  composer,
  templates,
  showGuidance,
  onComposerChange,
  onTemplateChange,
  onClose,
  onSubmit,
}: MissionComposerProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const parsedComposerSource = parseGithubSource(composer.sourceText)
  const composerSourceReady =
    composer.sourceKind === 'github-url'
      ? Boolean(parsedComposerSource.parsedRepo)
      : composer.sourceText.trim().length > 0
  const composerScopeReady = Boolean(composer.title.trim() && composer.goal.trim())

  useEffect(() => {
    closeButtonRef.current?.focus()

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div className="drawer-backdrop" role="presentation">
      <section className="composer-drawer" aria-label="Create mission">
        <div className="drawer-header">
          <div>
            <p className="section-label">Mission Composer</p>
            <h2>Create a maintainer workflow</h2>
          </div>
          <button ref={closeButtonRef} className="icon-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <form className="composer-form" onSubmit={onSubmit}>
          <fieldset>
            <legend>1. Choose workflow</legend>
            <label>
              Template
              <select value={composer.templateId} onChange={(event) => onTemplateChange(event.target.value)}>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
            <p>{getTemplate(composer.templateId).description}</p>
          </fieldset>

          <fieldset>
            <legend>2. Capture source</legend>
            <label>
              Source type
              <select
                value={composer.sourceKind}
                onChange={(event) =>
                  onComposerChange({
                    ...composer,
                    sourceKind: event.target.value as ComposerInput['sourceKind'],
                  })
                }
              >
                <option value="github-url">GitHub URL</option>
                <option value="diff-paste">Pasted diff</option>
                <option value="log-paste">Pasted log</option>
                <option value="manual">Manual brief</option>
              </select>
            </label>
            <p>{sourceHints[composer.sourceKind]}</p>
            <label>
              Source
              <textarea
                required
                placeholder={sourceHints[composer.sourceKind]}
                value={composer.sourceText}
                onChange={(event) => onComposerChange({ ...composer, sourceText: event.target.value })}
              />
            </label>
            <div className="source-preview">
              <strong>Parsed source</strong>
              <p>
                {parsedComposerSource.parsedRepo
                  ? `${parsedComposerSource.parsedRepo} #${parsedComposerSource.parsedNumber}`
                  : composer.sourceKind === 'github-url'
                    ? 'Waiting for a valid GitHub issue or PR URL.'
                    : `${composer.sourceText.trim().length} characters captured.`}
              </p>
            </div>
            {showGuidance ? (
              <div className="composer-readiness" aria-label="Mission composer readiness">
                <span className={composerSourceReady ? 'is-complete' : ''}>
                  {composerSourceReady ? 'Ready source' : 'Source needed'}
                </span>
                <span className={composerScopeReady ? 'is-complete' : ''}>
                  {composerScopeReady ? 'Scope ready' : 'Scope needed'}
                </span>
                <p>After creation, attach evidence and clear the first approval gate.</p>
              </div>
            ) : null}
          </fieldset>

          <fieldset>
            <legend>3. Confirm scope</legend>
            <label>
              Title
              <input
                aria-label="Title"
                value={composer.title}
                onChange={(event) => onComposerChange({ ...composer, title: event.target.value })}
              />
            </label>
            <label>
              Branch
              <input
                aria-label="Branch"
                value={composer.branch}
                onChange={(event) => onComposerChange({ ...composer, branch: event.target.value })}
              />
            </label>
            <label>
              Goal
              <textarea
                aria-label="Goal"
                value={composer.goal}
                onChange={(event) => onComposerChange({ ...composer, goal: event.target.value })}
              />
            </label>
            <label>
              Guardrails
              <textarea
                aria-label="Guardrails"
                value={composer.constraints}
                onChange={(event) => onComposerChange({ ...composer, constraints: event.target.value })}
              />
            </label>
          </fieldset>
          <button className="primary-action" type="submit">
            Start mission
          </button>
        </form>
      </section>
    </div>
  )
}
