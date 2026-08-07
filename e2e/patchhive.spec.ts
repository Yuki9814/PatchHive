import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createSarifScan } from '../scripts/generate-scan-fixtures.mjs'

const findingFixture = readFileSync(
  resolve(process.cwd(), 'fixtures/agent-hygiene/v0.5.0/findings.json'),
)
const cleanRerunFixture = readFileSync(
  resolve(process.cwd(), 'fixtures/agent-hygiene/v0.5.0/clean-rerun.json'),
)

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => window.localStorage.clear())
  await page.reload()
})

test('loads the development stylesheet under the environment-specific CSP', async ({
  page,
}) => {
  await expect(page.locator('main.workspace-shell')).toHaveCSS('display', 'grid')
  await expect(page.getByRole('button', { name: 'New mission' })).toHaveCSS(
    'border-radius',
    '8px',
  )
})

test('isolates a corrupt workspace, downloads recovery files, and only overwrites after explicit discard', async ({
  page,
}) => {
  const rawPayload =
    `{"title":"private recovery \\"payload\\" ${String.fromCharCode(0xd800)}","brackets":"[{}]"`
  await page.evaluate(
    ({ key, payload }) => window.localStorage.setItem(key, payload),
    { key: 'patchhive.workspace.v1', payload: rawPayload },
  )
  await page.reload()

  const alert = page.getByRole('alert')
  await expect(alert).toContainText('Saved workspace needs recovery')
  await expect(alert).toContainText('memory only')
  await expect(page.getByText(/private recovery/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Import JSON' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Reset sample' })).toBeDisabled()
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.localStorage.getItem('patchhive.workspace.v1'),
      ),
    )
    .toBe(rawPayload)

  const rawDownloadPromise = page.waitForEvent('download')
  await page
    .getByRole('button', { name: 'Download lossless recovery envelope' })
    .click()
  const rawDownload = await rawDownloadPromise
  const rawDownloadPath = await rawDownload.path()
  expect(rawDownload.suggestedFilename()).toMatch(
    /^patchhive-recovery-envelope-corrupt-.*\.json$/,
  )
  expect(rawDownloadPath).not.toBeNull()
  const recoveryEnvelope = JSON.parse(readFileSync(rawDownloadPath!, 'utf8'))
  expect(recoveryEnvelope).toEqual({
    format: 'patchhive.storage-recovery.v1',
    storageKey: 'patchhive.workspace.v1',
    payload: rawPayload,
    reason: 'corrupt',
  })
  expect(
    recoveryEnvelope.payload
      .split('')
      .map((character: string) => character.charCodeAt(0)),
  ).toEqual(rawPayload.split('').map((character) => character.charCodeAt(0)))

  const backupDownloadPromise = page.waitForEvent('download')
  await page
    .getByRole('button', { name: 'Download current workspace backup' })
    .click()
  const backupDownload = await backupDownloadPromise
  const backupDownloadPath = await backupDownload.path()
  expect(backupDownloadPath).not.toBeNull()
  expect(
    JSON.parse(readFileSync(backupDownloadPath!, 'utf8')).settings.schemaVersion,
  ).toBe(8)

  page.once('dialog', (dialog) => dialog.accept())
  await page
    .getByRole('button', { name: 'Discard saved data and reset' })
    .click()

  await expect(alert).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const saved = window.localStorage.getItem('patchhive.workspace.v1')
        return saved ? JSON.parse(saved).settings.schemaVersion : 0
      }),
    )
    .toBe(8)
})

for (const scenario of [
  {
    kind: 'future',
    recoveryTitle: 'Saved workspace is from a newer PatchHive',
  },
  {
    kind: 'corrupt',
    recoveryTitle: 'Saved workspace needs recovery',
  },
] as const) {
  test(`protects a ${scenario.kind} cross-tab payload and reloads it into recovery`, async ({
    context,
    page,
  }) => {
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean(window.localStorage.getItem('patchhive.workspace.v1')),
        ),
      )
      .toBe(true)
    const otherPage = await context.newPage()
    await otherPage.goto('/')
    const externalRaw = await otherPage.evaluate(
      ({ kind, storageKey }) => {
        let payload: string

        if (kind === 'future') {
          const workspace = JSON.parse(
            window.localStorage.getItem(storageKey) ?? '{}',
          )
          workspace.settings.schemaVersion = 9
          workspace.missions[0].title = 'Future workspace from another tab'
          payload = JSON.stringify(workspace)
        } else {
          payload = '{"cross-tab":"corrupt payload"'
        }

        window.localStorage.setItem(storageKey, payload)
        return payload
      },
      {
        kind: scenario.kind,
        storageKey: 'patchhive.workspace.v1',
      },
    )

    const alert = page.getByRole('alert')
    await expect(alert).toContainText('Stored workspace changed elsewhere')
    await expect(alert).toContainText(
      'Another tab or PatchHive version changed the stored workspace',
    )
    await expect(page.getByRole('button', { name: 'Import JSON' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Reset sample' })).toBeDisabled()

    await page.getByLabel('Show guidance').uncheck()
    await expect(page.getByLabel('Show guidance')).not.toBeChecked()
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.localStorage.getItem('patchhive.workspace.v1'),
        ),
      )
      .toBe(externalRaw)

    const backupDownloadPromise = page.waitForEvent('download')
    await page
      .getByRole('button', { name: 'Download current workspace backup' })
      .click()
    const backupDownload = await backupDownloadPromise
    const backupDownloadPath = await backupDownload.path()
    expect(backupDownloadPath).not.toBeNull()
    expect(
      JSON.parse(readFileSync(backupDownloadPath!, 'utf8')).settings.showGuidance,
    ).toBe(false)

    await page
      .getByRole('button', { name: 'Reload stored workspace' })
      .click()
    await expect(page.getByRole('alert')).toContainText(scenario.recoveryTitle)
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.localStorage.getItem('patchhive.workspace.v1'),
        ),
      )
      .toBe(externalRaw)

    await otherPage.close()
  })
}

test('keeps working in memory after quota failure and persists on explicit retry', async ({
  page,
}) => {
  await page.evaluate(() => window.localStorage.clear())
  await page.addInitScript(() => {
    const runtime = window as typeof window & {
      __patchHiveQuota: boolean
      __patchHiveSaveAttempts: number
    }
    const setItem = Storage.prototype.setItem
    runtime.__patchHiveQuota = true
    runtime.__patchHiveSaveAttempts = 0
    Storage.prototype.setItem = function (key, value) {
      if (key === 'patchhive.workspace.v1') {
        runtime.__patchHiveSaveAttempts += 1
        if (runtime.__patchHiveQuota) {
          throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
        }
      }

      return setItem.call(this, key, value)
    }
  })
  await page.reload()

  const alert = page.getByRole('alert')
  await expect(alert).toContainText('Browser storage is full')
  const failedAttemptCount = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __patchHiveSaveAttempts: number
        }
      ).__patchHiveSaveAttempts,
  )

  await page.getByLabel('Show guidance').uncheck()
  await expect(page.getByLabel('Show guidance')).not.toBeChecked()
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __patchHiveSaveAttempts: number
            }
          ).__patchHiveSaveAttempts,
      ),
    )
    .toBe(failedAttemptCount)

  await page.evaluate(() => {
    ;(
      window as typeof window & {
        __patchHiveQuota: boolean
      }
    ).__patchHiveQuota = false
  })
  await page.getByRole('button', { name: 'Retry browser save' }).click()

  await expect(alert).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const saved = window.localStorage.getItem('patchhive.workspace.v1')
        return saved ? JSON.parse(saved).settings.showGuidance : null
      }),
    )
    .toBe(false)
})

test('migrates a legacy local workspace and writes schema v8 back', async ({
  page,
}) => {
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(window.localStorage.getItem('patchhive.workspace.v1')),
      ),
    )
    .toBe(true)
  await page.evaluate(() => {
    const key = 'patchhive.workspace.v1'
    const workspace = JSON.parse(window.localStorage.getItem(key) ?? '{}')
    workspace.settings.schemaVersion = 7
    workspace.missions[0].title = 'Legacy browser workspace'
    window.localStorage.setItem(key, JSON.stringify(workspace))
  })
  await page.reload()

  await expect(
    page.getByRole('heading', { name: 'Legacy browser workspace' }),
  ).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const saved = window.localStorage.getItem('patchhive.workspace.v1')
        return saved ? JSON.parse(saved).settings.schemaVersion : 0
      }),
    )
    .toBe(8)
})

test('creates a mission, links evidence, and unlocks handoff export', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 820 })
  await page.getByRole('button', { name: 'Inspector' }).click()
  await expect(page.getByLabel('Evidence, approvals, and handoff')).toBeVisible()
  await page.getByRole('button', { name: 'Work', exact: true }).click()
  await page.setViewportSize({ width: 1280, height: 900 })

  await page.getByRole('button', { name: 'New mission' }).click()
  await page.getByLabel('Source type').selectOption('diff-paste')
  await page.getByLabel('Source', { exact: true }).fill('diff --git a/src/parser.ts b/src/parser.ts')
  await page.getByLabel('Title', { exact: true }).fill('Playwright rescue mission')
  await page.getByRole('button', { name: 'Start mission' }).click()

  await expect(page.getByRole('heading', { name: 'Playwright rescue mission' })).toBeVisible()
  const patchPlanTab = page.getByRole('tab').nth(1)
  await expect(patchPlanTab).toHaveAttribute('aria-disabled', 'true')

  const patchScopeApprovalCard = page
    .getByRole('article')
    .filter({ has: page.getByText('Patch scope approved', { exact: true }) })
  const patchScopeApproval = patchScopeApprovalCard.getByRole('button', {
    name: 'Approve',
    exact: true,
  })
  await patchScopeApproval.scrollIntoViewIfNeeded()
  await patchScopeApproval.click()
  await expect(
    patchScopeApprovalCard.getByRole('button', { name: 'Approved', exact: true }),
  ).toBeVisible()
  await expect(patchPlanTab).toBeEnabled()
  await patchPlanTab.click()
  await expect(page.getByRole('heading', { name: 'Patch Plan' })).toBeVisible()

  const inspector = page.getByLabel('Evidence, approvals, and handoff')
  const evidenceForm = inspector.locator('.evidence-form')
  await evidenceForm.getByLabel('Stage').selectOption('patch-plan')
  await evidenceForm.getByLabel('Agent').selectOption('patch-agent')
  await inspector.getByPlaceholder('Evidence title').fill('Playwright regression proof')
  await inspector
    .getByPlaceholder('What this proves or changes')
    .fill('The focused test covers the failing parser path.')
  await inspector.getByRole('button', { name: 'Attach evidence' }).click()

  await expect(inspector.getByText('All evidence is linked.')).toBeVisible()
  await expect(inspector.getByText('Patch Plan · Patch Agent')).toBeVisible()
  await page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Patch Agent' }) })
    .getByRole('button', { name: 'Draft Patch plan' })
    .click()
  await expect(inspector.getByRole('textbox', { name: /Patch plan/ })).toHaveValue(/Playwright regression proof/)
  const handoffApprovalCard = page
    .getByRole('article')
    .filter({ has: page.getByText('Maintainer-facing message approved', { exact: true }) })
  const handoffApproval = handoffApprovalCard.getByRole('button', {
    name: 'Approve',
    exact: true,
  })
  await handoffApproval.scrollIntoViewIfNeeded()
  await handoffApproval.click()
  await expect(
    handoffApprovalCard.getByRole('button', { name: 'Approved', exact: true }),
  ).toBeVisible()
  await inspector.getByLabel('Handoff format').selectOption('github-pull-request')
  await expect(page.getByRole('button', { name: 'Copy Markdown' })).toBeEnabled()
  await inspector.getByText('Markdown preview', { exact: true }).click()
  await expect(inspector.locator('.handoff-preview pre')).toContainText('## Changes')
  await expect(inspector.locator('.handoff-preview pre')).not.toContainText(
    '## Workflow Stages',
  )
})

test('downloads a consented trial report without persisting or exposing project content', async ({
  page,
}) => {
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.localStorage.getItem('patchhive.workspace.v1'),
      ),
    )
    .not.toBeNull()
  const storedWorkspace = await page.evaluate(() =>
    window.localStorage.getItem('patchhive.workspace.v1'),
  )

  await expect(
    page.getByRole('button', { name: 'Generate trial report' }),
  ).toBeDisabled()
  await page.getByLabel('Trial outcome').selectOption('partially-completed')
  await page.getByLabel('Elapsed minutes').fill('37')
  await page.getByLabel('Workflow clarity').selectOption('4')
  await page.getByLabel('Would use again').selectOption('maybe')
  await page.getByLabel('Primary friction').selectOption('evidence-triage')
  await page
    .getByRole('checkbox', { name: /consent to manually share/i })
    .check()
  await page.getByRole('button', { name: 'Generate trial report' }).click()

  const preview = page.getByLabel('Maintainer trial report preview')
  await expect(preview).toContainText('patchhive.maintainer-trial.v1')
  await expect(preview).toContainText('"handoffReady": false')
  await expect(preview).not.toContainText('pypdf XObject guard rescue')
  await expect(preview).not.toContainText('py-pdf/pypdf')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download trial report' }).click()
  const download = await downloadPromise
  const downloadPath = await download.path()
  expect(download.suggestedFilename()).toMatch(
    /^patchhive-maintainer-trial-\d{4}-\d{2}-\d{2}\.json$/,
  )
  expect(downloadPath).not.toBeNull()
  const report = JSON.parse(readFileSync(downloadPath!, 'utf8'))
  expect(report).toMatchObject({
    format: 'patchhive.maintainer-trial.v1',
    participantConsent: 'affirmed',
    privacy: {
      storedByPatchHive: false,
      sentByPatchHive: false,
      includesMissionContent: false,
      includesRepositoryIdentity: false,
      includesBrowserIdentity: false,
    },
    workflow: {
      handoffReady: false,
    },
    answers: {
      outcome: 'partially-completed',
      elapsedMinutes: 37,
      clarityRating: 4,
      reuseIntent: 'maybe',
      primaryFriction: 'evidence-triage',
    },
  })
  expect(JSON.stringify(report)).not.toContain('pypdf XObject guard rescue')
  expect(JSON.stringify(report)).not.toContain('py-pdf/pypdf')
  expect(
    await page.evaluate(() =>
      window.localStorage.getItem('patchhive.workspace.v1'),
    ),
  ).toBe(storedWorkspace)

  await page.reload()
  await expect(page.getByLabel('Trial outcome')).toHaveValue('')
  await expect(
    page.getByLabel('Maintainer trial report preview'),
  ).toHaveCount(0)
})

test('opts into local privacy preflight and downloads only redacted Markdown', async ({
  page,
}) => {
  const token = await page.evaluate(() => {
    const runtimeToken = `ghp_${'A'.repeat(36)}`
    const storageKey = 'patchhive.workspace.v1'
    const workspace = JSON.parse(
      window.localStorage.getItem(storageKey) ?? '{}',
    )
    const mission = workspace.missions[0]
    mission.approvals = mission.approvals.map(
      (approval: Record<string, unknown>) => ({
        ...approval,
        approved: true,
        approvedAt: '2026-07-29T00:00:00.000Z',
      }),
    )
    mission.outputs.fieldSources = {
      summary: [mission.evidence[0].id],
    }
    mission.outputs.maintainerComment =
      `Share the handoff after removing ${runtimeToken}.`
    window.localStorage.setItem(storageKey, JSON.stringify(workspace))
    return runtimeToken
  })
  await page.reload()

  const privacyToggle = page.getByRole('checkbox', {
    name: 'Run local privacy preflight',
  })
  await expect(privacyToggle).not.toBeChecked()
  await expect(page.getByRole('button', { name: 'Copy Markdown' })).toBeEnabled()

  await privacyToggle.check()
  await expect(
    page.getByRole('button', { name: 'Copy redacted Markdown' }),
  ).toBeEnabled()
  await expect(
    page.getByRole('button', { name: 'Download redacted' }),
  ).toBeEnabled()
  await expect(page.getByRole('status')).toContainText(
    '1 potential sensitive value(s) masked',
  )
  await expect(
    page.getByRole('list', { name: 'Privacy preflight findings' }),
  ).toContainText(/GitHub token · line \d+/)

  await page.getByText('Redacted Markdown preview', { exact: true }).click()
  const preview = page.locator('.handoff-preview pre')
  await expect(preview).toContainText('[REDACTED: github-token]')
  await expect(preview).not.toContainText(token)

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download redacted' }).click()
  const download = await downloadPromise
  const downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()
  const downloadedMarkdown = readFileSync(downloadPath!, 'utf8')
  expect(downloadedMarkdown).toContain('[REDACTED: github-token]')
  expect(downloadedMarkdown).not.toContain(token)
})

test('rejects invalid workspace JSON imports', async ({ page }) => {
  await page.getByRole('button', { name: 'Import JSON' }).click()
  await page.getByLabel('Import workspace JSON').setInputFiles({
    name: 'invalid-workspace.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"missions":"nope"}'),
  })

  await expect(page.getByText(/not a PatchHive workspace/i)).toBeVisible()
})

test('previews and imports an agent-hygiene SARIF file without interpreting finding text as HTML', async ({
  page,
}) => {
  const sarif = {
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'agent-hygiene',
            version: '0.3.0',
            rules: [{ id: 'AH003', shortDescription: { text: 'Hard-coded secret' } }],
          },
        },
        invocations: [{ executionSuccessful: true }],
        results: [
          {
            ruleId: 'AH003',
            level: 'error',
            message: {
              text: '<img src=x onerror=alert(1)> stays text. Fix: Remove the literal.',
            },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: 'AGENTS.md' },
                  region: { startLine: 4 },
                },
              },
            ],
            partialFingerprints: {
              'agentHygieneFingerprint/v1': '44444444444444444444',
            },
            properties: {
              severity: 'critical',
              remediation: 'Move the value to a secret store.',
            },
          },
        ],
      },
    ],
  }

  await page.getByLabel('Import agent-hygiene scan').setInputFiles({
    name: 'agent-hygiene.sarif',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(sarif)),
  })

  await expect(page.getByLabel('agent-hygiene import preview')).toContainText(
    'SARIF · 1 findings · complete',
  )
  await page.getByRole('button', { name: 'Import into current stage' }).click()

  const importedCard = page.getByRole('article').filter({ hasText: 'AH003 · Hard-coded secret' })
  await expect(importedCard).toContainText('agent-hygiene SARIF')
  await expect(importedCard).toContainText('<img src=x onerror=alert(1)>')
  await expect(page.locator('img[src="x"]')).toHaveCount(0)
  await expect(page.getByText(/1 high-severity imported finding/)).toBeVisible()
})

test('handles a deterministic 250-finding scan with filters, acceptance notes, and reload', async ({
  page,
}) => {
  const initialTotal = Number(
    await page.locator('.evidence-list').getAttribute('data-evidence-total'),
  )
  const expectedTotal = initialTotal + 251

  await page.getByLabel('Import agent-hygiene scan').setInputFiles({
    name: 'agent-hygiene-250.sarif',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(createSarifScan(250))),
  })
  await expect(page.getByLabel('agent-hygiene import preview')).toContainText(
    'SARIF · 250 findings · complete',
  )
  await page.getByRole('button', { name: 'Import into current stage' }).click()

  await expect(page.locator('.evidence-list')).toHaveAttribute(
    'data-evidence-total',
    String(expectedTotal),
  )
  await expect(page.getByText(`Showing 1-25 of ${expectedTotal}`)).toBeVisible()

  await page.getByLabel('Severity filter').selectOption('high')
  await expect(page.locator('.evidence-list')).toHaveAttribute(
    'data-evidence-total',
    '1',
  )

  await page.getByRole('button', { name: 'Accept risk' }).click()
  const confirmAcceptance = page.getByRole('button', {
    name: 'Confirm acceptance',
  })
  await expect(confirmAcceptance).toBeDisabled()
  await page
    .getByLabel(/Resolution note for/)
    .fill('Accepted because the deterministic fixture remains local.')
  await confirmAcceptance.click()
  await expect(page.getByText(/Acceptance note: Accepted because/)).toBeVisible()
  await expect(
    page.getByText(/high-severity imported finding.*still need triage/i),
  ).toHaveCount(0)

  await page.reload()
  await expect(page.locator('.evidence-list')).toHaveAttribute(
    'data-evidence-total',
    String(expectedTotal),
  )
  await expect(page.getByText(/Acceptance note: Accepted because/)).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem('patchhive.workspace.v1')
        return raw ? JSON.parse(raw).settings.schemaVersion : 0
      }),
    )
    .toBe(8)
})

test('requires a complete same-scope rerun before a scanner finding resolves', async ({
  page,
}) => {
  await page.getByLabel('Import agent-hygiene scan').setInputFiles({
    name: 'findings.json',
    mimeType: 'application/json',
    buffer: findingFixture,
  })
  await expect(page.getByLabel('agent-hygiene import preview')).toContainText(
    'revision 111111111111',
  )
  await page.getByRole('button', { name: 'Import into current stage' }).click()

  const findingCard = page.getByRole('article').filter({
    hasText: 'AH002 · Prompt override or secrecy instruction',
  })
  await expect(findingCard).toContainText(
    'Fixed findings resolve only after a complete rerun of this scan scope.',
  )
  await expect(findingCard.getByRole('button', { name: 'Mark resolved' })).toHaveCount(0)

  await page.getByLabel('Import agent-hygiene scan').setInputFiles({
    name: 'clean-rerun.json',
    mimeType: 'application/json',
    buffer: cleanRerunFixture,
  })
  await expect(page.getByLabel('agent-hygiene import preview')).toContainText(
    'revision 222222222222',
  )
  await page.getByRole('button', { name: 'Import into current stage' }).click()

  await expect(findingCard).toContainText(
    'Resolved by complete same-scope rerun clean-rerun.json at revision 222222222222.',
  )
  await page.reload()
  await expect(findingCard).toContainText('resolved')
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem('patchhive.workspace.v1')
        return raw ? JSON.parse(raw).settings.schemaVersion : 0
      }),
    )
    .toBe(8)
})

test('keeps an incomplete scan blocked after an unrelated complete scope import and reload', async ({
  page,
}) => {
  const incomplete = {
    schema_version: 1,
    tool: { name: 'agent-hygiene', version: '0.3.0' },
    summary: {
      scope_fingerprint: 'aaaaaaaaaaaaaaaaaaaa',
      complete: false,
      score: 40,
      status: 'blocked',
      discovery_issues: [],
    },
    findings: [],
  }
  const unrelatedComplete = {
    ...incomplete,
    summary: {
      ...incomplete.summary,
      scope_fingerprint: 'bbbbbbbbbbbbbbbbbbbb',
      complete: true,
      score: 100,
      status: 'clean',
    },
  }

  await page.getByLabel('Import agent-hygiene scan').setInputFiles({
    name: 'incomplete-a.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(incomplete)),
  })
  await page.getByRole('button', { name: 'Import into current stage' }).click()

  await page.getByLabel('Import agent-hygiene scan').setInputFiles({
    name: 'complete-b.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(unrelatedComplete)),
  })
  await page.getByRole('button', { name: 'Import into current stage' }).click()

  await expect(
    page.getByText(/Imported scan incomplete-a.json is incomplete/i),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByText(/Imported scan incomplete-a.json is incomplete/i),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeDisabled()
})
