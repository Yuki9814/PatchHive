import { render, screen, within } from '@testing-library/react'
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
    await user.clear(screen.getByLabelText(/^source$/i))
    await user.type(screen.getByLabelText(/^source$/i), 'diff --git a/src/a.ts b/src/a.ts')
    await user.clear(screen.getByLabelText(/^title$/i))
    await user.type(screen.getByLabelText(/^title$/i), 'Parser patch rescue')
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
    await user.type(within(evidencePanel).getByPlaceholderText(/evidence title/i), 'Regression proof')
    await user.type(within(evidencePanel).getByPlaceholderText(/what this proves/i), 'Test plan covers the failing parser path.')
    await user.click(within(evidencePanel).getByRole('button', { name: /attach evidence/i }))

    expect(screen.getByText(/all evidence is linked/i)).toBeInTheDocument()
    expect(screen.getByText('Regression proof')).toBeInTheDocument()
    expect(screen.getByText(/Patch Plan · Patch Agent/i)).toBeInTheDocument()

    await user.click(screen.getAllByRole('tab')[0])
    expect(screen.getByText(/Patch Plan · Patch Agent/i)).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: /^approve$/i })[0])

    expect(screen.getByRole('button', { name: /copy markdown/i })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: /copy markdown/i }))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Regression proof'))
  })
})
