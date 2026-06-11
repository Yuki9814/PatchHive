import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => window.localStorage.clear())
  await page.reload()
})

test('creates a mission, links evidence, and unlocks handoff export', async ({ page }) => {
  await page.getByRole('button', { name: 'New mission' }).click()
  await page.getByLabel('Source type').selectOption('diff-paste')
  await page.getByLabel('Source', { exact: true }).fill('diff --git a/src/parser.ts b/src/parser.ts')
  await page.getByLabel('Title', { exact: true }).fill('Playwright rescue mission')
  await page.getByRole('button', { name: 'Start mission' }).click()

  await expect(page.getByRole('heading', { name: 'Playwright rescue mission' })).toBeVisible()
  const patchPlanTab = page.getByRole('tab').nth(1)
  await expect(patchPlanTab).toHaveAttribute('aria-disabled', 'true')

  await page.getByRole('button', { name: 'Approve', exact: true }).first().click()
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
    .getByRole('button', { name: 'Draft from evidence' })
    .click()
  await expect(inspector.getByRole('textbox', { name: /Patch plan/ })).toHaveValue(/Playwright regression proof/)
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Copy Markdown' })).toBeEnabled()
})
