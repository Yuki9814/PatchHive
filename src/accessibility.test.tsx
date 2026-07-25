import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from './App'

describe('accessibility contract', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('gives visible controls accessible names and keeps ids unique', () => {
    const { container } = render(<App />)
    const controls = container.querySelectorAll('button, input, textarea, select')
    const ids = [...container.querySelectorAll('[id]')].map((element) => element.id)

    controls.forEach((control) => {
      expect(control).toHaveAccessibleName()
    })
    expect(new Set(ids).size).toBe(ids.length)
    expect(screen.getByLabelText(/evidence, approvals, and handoff/i)).toBeInTheDocument()
    expect(screen.getByText('Workspace loaded.')).toHaveAttribute('aria-live', 'polite')
  })

  it('closes the mission composer with Escape and restores focus', async () => {
    const user = userEvent.setup()
    render(<App />)
    const newMissionButton = screen.getByRole('button', { name: /new mission/i })

    await user.click(newMissionButton)
    expect(screen.getByLabelText(/create mission/i)).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByLabelText(/create mission/i)).not.toBeInTheDocument()
    expect(newMissionButton).toHaveFocus()
  })
})
