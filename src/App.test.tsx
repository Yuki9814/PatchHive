import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

describe('App workflow', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('creates a mission, links evidence, gates stages, and unlocks handoff export', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    render(<App />)

    await user.click(screen.getByRole('button', { name: /new mission/i }))
    await user.selectOptions(screen.getByLabelText(/source type/i), 'diff-paste')
    fireEvent.change(screen.getByLabelText(/^source$/i), {
      target: { value: 'diff --git a/src/a.ts b/src/a.ts' },
    })
    fireEvent.change(screen.getByLabelText(/^title$/i), {
      target: { value: 'Parser patch rescue' },
    })
    await user.click(screen.getByRole('button', { name: /start mission/i }))

    expect(screen.getByRole('heading', { name: 'Parser patch rescue' })).toBeInTheDocument()

    const patchPlanTab = screen.getAllByRole('tab')[1]
    await user.click(patchPlanTab)
    expect(screen.getAllByText(/patch scope approved before patch plan/i).length).toBeGreaterThan(0)

    await user.click(screen.getAllByRole('button', { name: /^approve$/i })[0])
    await user.click(patchPlanTab)
    expect(screen.getByRole('heading', { name: 'Patch Plan' })).toBeInTheDocument()

    const evidencePanel = screen.getByLabelText(/evidence, approvals, and handoff/i)
    await user.selectOptions(within(evidencePanel).getByLabelText(/^stage$/i), 'patch-plan')
    await user.selectOptions(within(evidencePanel).getByLabelText(/^agent$/i), 'patch-agent')
    fireEvent.change(within(evidencePanel).getByPlaceholderText(/evidence title/i), {
      target: { value: 'Regression proof' },
    })
    fireEvent.change(within(evidencePanel).getByPlaceholderText(/what this proves/i), {
      target: { value: 'Test plan covers the failing parser path.' },
    })
    await user.click(within(evidencePanel).getByRole('button', { name: /attach evidence/i }))

    expect(screen.getByText(/all evidence is linked/i)).toBeInTheDocument()
    expect(screen.getByText('Regression proof')).toBeInTheDocument()
    expect(screen.getByText(/Patch Plan · Patch Agent/i)).toBeInTheDocument()

    const patchAgentCard = screen.getByRole('heading', { name: 'Patch Agent' }).closest('article')
    expect(patchAgentCard).not.toBeNull()
    await user.click(within(patchAgentCard as HTMLElement).getByRole('button', { name: /draft patch plan/i }))
    expect(screen.getByText(/1 source/i)).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: /^approve$/i })[0])

    expect(screen.getByRole('button', { name: /copy markdown/i })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: /copy markdown/i }))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Regression proof'))
  })

  it('archives missions and filters them from the active list', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.selectOptions(screen.getByLabelText(/pypdf xobject guard rescue mission status/i), 'archived')
    await user.selectOptions(screen.getByLabelText(/status filter/i), 'archived')

    expect(
      within(screen.getByLabelText(/mission navigation/i)).getByRole('button', {
        name: /pypdf xobject guard rescue/i,
      }),
    ).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText(/status filter/i), 'active')

    expect(screen.getByText(/no missions match this status/i)).toBeInTheDocument()
  })

  it('previews scanner JSON before importing plain-text evidence with provenance', async () => {
    const user = userEvent.setup()
    render(<App />)
    const scanJson = JSON.stringify({
      schema_version: 1,
      tool: { name: 'agent-hygiene', version: '0.5.0' },
      summary: {
        root: '/Users/private/repository',
        source_revision: '1111111111111111111111111111111111111111',
        complete: true,
        score: 70,
        status: 'needs-review',
        discovery_issues: [],
      },
      findings: [
        {
          rule_id: 'AH003',
          title: 'Hard-coded secret',
          severity: 'critical',
          path: 'AGENTS.md',
          line: 4,
          message: '<img src=x onerror=alert(1)> remains plain text.',
          remediation: 'Move the value to a secret store.',
          fingerprint: '33333333333333333333',
        },
      ],
    })

    fireEvent.change(screen.getByLabelText(/scan json or sarif/i), {
      target: { value: scanJson },
    })
    await user.click(screen.getByRole('button', { name: /preview scan/i }))

    expect(screen.getByLabelText(/agent-hygiene import preview/i)).toHaveTextContent(
      'JSON · 1 findings · complete',
    )
    expect(screen.getByLabelText(/agent-hygiene import preview/i)).toHaveTextContent(
      'revision 111111111111',
    )
    expect(screen.queryByText(/AH003 · Hard-coded secret/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /import into current stage/i }))

    const importedCard = screen.getByText('AH003 · Hard-coded secret').closest('article')
    expect(importedCard).not.toBeNull()
    expect(within(importedCard as HTMLElement).getByText(/agent-hygiene JSON/i)).toBeInTheDocument()
    expect(within(importedCard as HTMLElement).getByText(/<img src=x onerror/i)).toBeInTheDocument()
    expect(document.querySelector('img[src="x"]')).toBeNull()
    expect(screen.getByText(/1 high-severity imported finding/i)).toBeInTheDocument()
    expect(
      within(importedCard as HTMLElement).getByText(/resolve only after a complete rerun/i),
    ).toBeInTheDocument()
    expect(
      within(importedCard as HTMLElement).queryByRole('button', { name: /mark resolved/i }),
    ).not.toBeInTheDocument()

    await user.click(
      within(importedCard as HTMLElement).getByRole('button', { name: /accept risk/i }),
    )
    const confirmAcceptance = within(importedCard as HTMLElement).getByRole(
      'button',
      { name: /confirm acceptance/i },
    )

    expect(confirmAcceptance).toBeDisabled()
    await user.type(
      within(importedCard as HTMLElement).getByLabelText(/acceptance resolution note/i),
      'Accepted because this fixture is local and contains no live credential.',
    )
    await user.click(confirmAcceptance)

    expect(screen.queryByText(/1 high-severity imported finding/i)).not.toBeInTheDocument()
    expect(
      within(importedCard as HTMLElement).getByText(/acceptance note:/i),
    ).toHaveTextContent(/fixture is local/i)
  })
})
