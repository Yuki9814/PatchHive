import { StrictMode } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  WORKSPACE_STORAGE_KEY,
  createDefaultWorkspace,
  serializeWorkspaceExport,
} from './storage'

function readyWorkspaceWithMaintainerComment(maintainerComment: string) {
  const workspace = createDefaultWorkspace()
  const mission = workspace.missions[0]

  return {
    ...workspace,
    missions: [
      {
        ...mission,
        approvals: mission.approvals.map((approval) => ({
          ...approval,
          approved: true,
          approvedAt: '2026-07-29T00:00:00.000Z',
        })),
        outputs: {
          ...mission.outputs,
          maintainerComment,
          fieldSources: {
            summary: [mission.evidence[0].id],
          },
        },
      },
    ],
  }
}

describe('App workflow', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
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

  it('keeps handoff privacy preflight opt-in and copies only masked Markdown when enabled', async () => {
    const user = userEvent.setup()
    const token = `ghp_${'A'.repeat(36)}`
    const workspace = readyWorkspaceWithMaintainerComment(
      `Share this handoff with ${token} removed.`,
    )
    window.localStorage.setItem(
      WORKSPACE_STORAGE_KEY,
      serializeWorkspaceExport(workspace),
    )
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined)

    const { unmount } = render(<App />)

    const privacyToggle = screen.getByRole('checkbox', {
      name: /run local privacy preflight/i,
    })
    expect(privacyToggle).not.toBeChecked()
    expect(
      screen.getByRole('button', { name: /^copy markdown$/i }),
    ).toBeEnabled()

    await user.click(screen.getByRole('button', { name: /^copy markdown$/i }))
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining(token))

    writeText.mockClear()
    await user.click(privacyToggle)

    expect(
      screen.getByRole('button', { name: /copy redacted markdown/i }),
    ).toBeEnabled()
    expect(
      screen.getByRole('button', { name: /download redacted/i }),
    ).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent(
      '1 potential sensitive value(s) masked',
    )
    expect(
      screen.getByRole('list', { name: /privacy preflight findings/i }),
    ).toHaveTextContent(/GitHub token · line \d+/i)
    expect(
      screen.getByText(/zero-match result does not mean/i),
    ).toBeInTheDocument()

    await user.click(
      screen.getByText('Redacted Markdown preview', { selector: 'summary' }),
    )
    const preview = screen
      .getByText('Redacted Markdown preview', { selector: 'summary' })
      .closest('details')
    expect(preview).not.toBeNull()
    expect(within(preview as HTMLElement).getByText(/\[REDACTED: github-token\]/)).toBeInTheDocument()
    expect(within(preview as HTMLElement).queryByText(token)).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: /copy redacted markdown/i }),
    )
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('[REDACTED: github-token]'),
    )
    expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining(token))

    unmount()
    render(<App />)

    expect(
      screen.getByRole('checkbox', {
        name: /run local privacy preflight/i,
      }),
    ).not.toBeChecked()
    expect(
      screen.getByRole('button', { name: /^copy markdown$/i }),
    ).toBeEnabled()
  })

  it('does not present a zero-match privacy preflight as a safety guarantee', async () => {
    const user = userEvent.setup()
    const workspace = readyWorkspaceWithMaintainerComment(
      'Review the local evidence before sharing this handoff.',
    )
    window.localStorage.setItem(
      WORKSPACE_STORAGE_KEY,
      serializeWorkspaceExport(workspace),
    )

    render(<App />)
    await user.click(
      screen.getByRole('checkbox', {
        name: /run local privacy preflight/i,
      }),
    )

    expect(screen.getByRole('status')).toHaveTextContent(
      'No configured sensitive patterns matched',
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'This is not a safety guarantee',
    )
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

  it('keeps the corrupt localStorage string isolated through StrictMode until explicit discard', async () => {
    const user = userEvent.setup()
    const rawPayload = '{"title":"DO NOT RENDER THIS PRIVATE PAYLOAD"'
    window.localStorage.setItem('patchhive.workspace.v1', rawPayload)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Saved workspace needs recovery')
    expect(alert).toHaveTextContent('memory only')
    expect(screen.queryByText(/DO NOT RENDER THIS PRIVATE PAYLOAD/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import JSON' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reset sample' })).toBeDisabled()

    await waitFor(() => {
      expect(window.localStorage.getItem('patchhive.workspace.v1')).toBe(rawPayload)
    })

    await user.click(
      screen.getByRole('button', { name: 'Discard saved data and reset' }),
    )

    await waitFor(() => {
      const saved = window.localStorage.getItem('patchhive.workspace.v1')
      expect(saved).not.toBe(rawPayload)
      expect(JSON.parse(saved ?? '{}').settings.schemaVersion).toBe(8)
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps an empty saved string isolated through StrictMode', async () => {
    window.localStorage.setItem('patchhive.workspace.v1', '')

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Saved workspace needs recovery',
    )
    await waitFor(() => {
      expect(window.localStorage.getItem('patchhive.workspace.v1')).toBe('')
    })
  })

  it('does not render or overwrite a future-schema workspace', async () => {
    const workspace = createDefaultWorkspace()
    const rawPayload = JSON.stringify({
      ...workspace,
      missions: [
        {
          ...workspace.missions[0],
          title: 'Future private mission',
        },
      ],
      settings: {
        ...workspace.settings,
        schemaVersion: 9,
      },
    })
    window.localStorage.setItem('patchhive.workspace.v1', rawPayload)

    render(<App />)

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Saved workspace is from a newer PatchHive',
    )
    expect(screen.queryByText('Future private mission')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(window.localStorage.getItem('patchhive.workspace.v1')).toBe(rawPayload)
    })
  })

  it('writes a migrated legacy workspace back as schema v8', async () => {
    const workspace = createDefaultWorkspace()
    const legacyPayload = JSON.stringify({
      ...workspace,
      missions: [
        {
          ...workspace.missions[0],
          title: 'Legacy workspace remains usable',
        },
      ],
      settings: {
        ...workspace.settings,
        schemaVersion: 7,
      },
    })
    window.localStorage.setItem('patchhive.workspace.v1', legacyPayload)

    render(<App />)

    expect(
      screen.getByRole('heading', { name: 'Legacy workspace remains usable' }),
    ).toBeInTheDocument()
    await waitFor(() => {
      const saved = window.localStorage.getItem('patchhive.workspace.v1')
      expect(JSON.parse(saved ?? '{}').settings.schemaVersion).toBe(8)
    })
  })

  it('uses the exact legacy raw as the migration write expectation', async () => {
    const workspace = createDefaultWorkspace()
    const legacyRaw = JSON.stringify({
      ...workspace,
      settings: {
        ...workspace.settings,
        schemaVersion: 7,
      },
    })
    const externalRaw = JSON.stringify({
      ...workspace,
      missions: [
        {
          ...workspace.missions[0],
          title: 'External tab won the migration race',
        },
      ],
    })
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, externalRaw)
    vi.spyOn(Storage.prototype, 'getItem')
      .mockImplementationOnce(() => legacyRaw)
      .mockImplementation(() => externalRaw)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    render(<App />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Stored workspace changed elsewhere',
    )
    expect(setItem).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(externalRaw)
  })

  it('falls back to compare-before-write when an external event has not arrived', async () => {
    const user = userEvent.setup()
    const workspace = createDefaultWorkspace()
    const originalRaw = serializeWorkspaceExport(workspace)
    const externalRaw = JSON.stringify({
      ...workspace,
      missions: [
        {
          ...workspace.missions[0],
          title: 'Other tab workspace',
        },
      ],
    })
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, originalRaw)
    render(<App />)
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, externalRaw)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    await user.click(screen.getByLabelText('Show guidance'))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Stored workspace changed elsewhere')
    expect(alert).toHaveTextContent(
      'Another tab or PatchHive version changed the stored workspace',
    )
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(externalRaw)
    expect(setItem).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Import JSON' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reset sample' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Download current workspace backup' }),
    ).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'Reload stored workspace' }),
    ).toBeEnabled()
    expect(
      screen.queryByRole('button', { name: 'Retry browser save' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: 'Download lossless recovery envelope',
      }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByLabelText('Show guidance'))
    expect(setItem).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(externalRaw)
  })

  it('locks on localStorage clear events and removes every StrictMode listener', async () => {
    const workspace = createDefaultWorkspace()
    const originalRaw = serializeWorkspaceExport(workspace)
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, originalRaw)
    const addEventListener = vi.spyOn(window, 'addEventListener')
    const removeEventListener = vi.spyOn(window, 'removeEventListener')
    const rendered = render(
      <StrictMode>
        <App />
      </StrictMode>,
    )

    fireEvent(
      window,
      new StorageEvent('storage', {
        key: WORKSPACE_STORAGE_KEY,
        newValue: 'session-only',
        storageArea: window.sessionStorage,
      }),
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    window.localStorage.removeItem(WORKSPACE_STORAGE_KEY)
    fireEvent(
      window,
      new StorageEvent('storage', {
        key: null,
        oldValue: originalRaw,
        newValue: null,
        storageArea: window.localStorage,
      }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Stored workspace changed elsewhere',
    )

    const addedStorageHandlers = addEventListener.mock.calls
      .filter(([eventName]) => eventName === 'storage')
      .map(([, handler]) => handler)
    rendered.unmount()
    const removedStorageHandlers = removeEventListener.mock.calls
      .filter(([eventName]) => eventName === 'storage')
      .map(([, handler]) => handler)

    expect(addedStorageHandlers.length).toBeGreaterThan(0)
    expect(removedStorageHandlers).toHaveLength(addedStorageHandlers.length)
    for (const handler of addedStorageHandlers) {
      expect(removedStorageHandlers).toContain(handler)
    }
  })

  it('does not discard a corrupt payload after another tab replaces it', async () => {
    const user = userEvent.setup()
    const isolatedRaw = '{isolated'
    const newerRaw = '{"newer":"external"}'
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, isolatedRaw)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<App />)
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, newerRaw)
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem')

    await user.click(
      screen.getByRole('button', { name: 'Discard saved data and reset' }),
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Stored workspace changed elsewhere',
    )
    expect(removeItem).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(newerRaw)
    expect(
      screen.getByRole('button', {
        name: 'Download lossless recovery envelope',
      }),
    ).toBeEnabled()
  })

  it('stays usable after quota failure and saves only after an explicit retry', async () => {
    const user = userEvent.setup()
    const originalSetItem = Storage.prototype.setItem
    let quotaExceeded = true
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(function (this: Storage, key, value) {
        if (quotaExceeded && key === 'patchhive.workspace.v1') {
          throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
        }

        return originalSetItem.call(this, key, value)
      })

    render(<App />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Browser storage is full')
    const failedSaveCount = setItem.mock.calls.length
    await user.click(screen.getByRole('button', { name: 'New mission' }))
    expect(screen.getByLabelText('Create mission')).toBeInTheDocument()
    expect(setItem).toHaveBeenCalledTimes(failedSaveCount)

    quotaExceeded = false
    await user.click(screen.getByRole('button', { name: 'Retry browser save' }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(window.localStorage.getItem('patchhive.workspace.v1')).toContain(
      '"schemaVersion": 8',
    )
    expect(screen.getByText('Workspace saved to browser storage.')).toBeInTheDocument()
  })

  it('keeps the quota expectation and detects external storage on retry', async () => {
    const user = userEvent.setup()
    const originalSetItem = Storage.prototype.setItem
    let quotaExceeded = true
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(function (this: Storage, key, value) {
        if (quotaExceeded && key === WORKSPACE_STORAGE_KEY) {
          throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
        }

        return originalSetItem.call(this, key, value)
      })

    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Browser storage is full',
    )

    quotaExceeded = false
    originalSetItem.call(
      window.localStorage,
      WORKSPACE_STORAGE_KEY,
      'external after quota',
    )
    setItem.mockClear()
    await user.click(screen.getByRole('button', { name: 'Retry browser save' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Stored workspace changed elsewhere',
    )
    expect(setItem).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(
      'external after quota',
    )
  })

  it('requires explicit confirmation before an unknown read baseline can be overwritten', async () => {
    const user = userEvent.setup()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage disabled', 'SecurityError')
    })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)

    render(<App />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Browser storage is unavailable',
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'did not read or automatically replace',
    )
    expect(setItem).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Retry browser save' }))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(setItem).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeInTheDocument()

    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Retry browser save' }))
    expect(setItem).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(setItem.mock.calls[0][1]).toContain('"schemaVersion": 8')
  })

  it('requires a fresh confirmation after an unknown-baseline write fails', async () => {
    const user = userEvent.setup()
    const originalGetItem = Storage.prototype.getItem
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage disabled', 'SecurityError')
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    setItem.mockImplementationOnce(() => {
      throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
    })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Retry browser save' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Browser storage is full',
    )
    expect(confirm).toHaveBeenCalledTimes(1)

    originalSetItem.call(
      window.localStorage,
      WORKSPACE_STORAGE_KEY,
      'external after failed unknown write',
    )
    confirm.mockReturnValue(false)
    await user.click(screen.getByRole('button', { name: 'Retry browser save' }))

    expect(confirm).toHaveBeenCalledTimes(2)
    expect(setItem).toHaveBeenCalledTimes(1)
    expect(
      originalGetItem.call(window.localStorage, WORKSPACE_STORAGE_KEY),
    ).toBe('external after failed unknown write')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Browser storage is full',
    )
  })
})
