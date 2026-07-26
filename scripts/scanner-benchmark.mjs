import { writeFile } from 'node:fs/promises'
import os from 'node:os'
import { performance } from 'node:perf_hooks'
import { execFileSync } from 'node:child_process'
import { chromium } from '@playwright/test'
import { preview } from 'vite'
import {
  BENCHMARK_FINDING_COUNTS,
  createScanFixture,
} from './generate-scan-fixtures.mjs'

const host = '127.0.0.1'
const port = 5181
const warmupRuns = 1
const measuredRuns = Number(process.env.PATCHHIVE_BENCH_RUNS ?? 5)
const outputIndex = process.argv.indexOf('--output')
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined

if (!Number.isInteger(measuredRuns) || measuredRuns < 3 || measuredRuns > 30) {
  throw new Error('PATCHHIVE_BENCH_RUNS must be an integer from 3 to 30.')
}

function round(value) {
  return Math.round(value * 100) / 100
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1)
  return round(sorted[index])
}

function summarize(samples) {
  const keys = Object.keys(samples[0])

  return Object.fromEntries(
    keys.map((key) => [
      key,
      {
        p50: percentile(samples.map((sample) => sample[key]), 0.5),
        p95: percentile(samples.map((sample) => sample[key]), 0.95),
      },
    ]),
  )
}

async function heapUsed(cdp) {
  const response = await cdp.send('Performance.getMetrics')
  return (
    response.metrics.find((metric) => metric.name === 'JSHeapUsedSize')?.value ?? 0
  )
}

async function waitForEvidenceTotal(page, total) {
  await page
    .locator(`.evidence-list[data-evidence-total="${total}"]`)
    .waitFor({ state: 'visible' })
}

async function runIteration(browser, baseURL, format, count) {
  const context = await browser.newContext({ acceptDownloads: true })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')

  try {
    await page.goto(baseURL)
    await page.evaluate(() => window.localStorage.clear())
    await page.reload()

    const initialTotal = Number(
      await page.locator('.evidence-list').getAttribute('data-evidence-total'),
    )
    const expectedTotal = initialTotal + count + 1
    const heapBefore = await heapUsed(cdp)
    const payload = JSON.stringify(createScanFixture(format, count))
    const previewStarted = performance.now()

    await page.getByLabel('Import agent-hygiene scan').setInputFiles({
      name: `benchmark-${count}.${format === 'json' ? 'json' : 'sarif'}`,
      mimeType: 'application/json',
      buffer: Buffer.from(payload),
    })
    await page.getByLabel('agent-hygiene import preview').waitFor()
    const previewMs = performance.now() - previewStarted

    const importStarted = performance.now()
    await page.getByRole('button', { name: 'Import into current stage' }).click()
    await waitForEvidenceTotal(page, expectedTotal)
    await page.getByText(`Showing 1-25 of ${expectedTotal}`).waitFor()
    const importRenderMs = performance.now() - importStarted

    const filterStarted = performance.now()
    await page.getByLabel('Severity filter').selectOption('high')
    await waitForEvidenceTotal(page, 1)
    const filterMs = performance.now() - filterStarted

    await page.getByLabel('Severity filter').selectOption('all')
    await waitForEvidenceTotal(page, expectedTotal)

    const triageStarted = performance.now()
    await page.getByRole('button', { name: 'Accept risk' }).first().click()
    await page
      .getByLabel(/Resolution note for/)
      .fill('Accepted for deterministic local benchmark coverage.')
    await page.getByRole('button', { name: 'Confirm acceptance' }).click()
    await page.getByText(/Acceptance note: Accepted for deterministic/).waitFor()
    await page.waitForFunction(() => {
      const raw = window.localStorage.getItem('patchhive.workspace.v1')
      return Boolean(raw?.includes('Accepted for deterministic local benchmark coverage.'))
    })
    const triagePersistMs = performance.now() - triageStarted

    while ((await page.getByRole('button', { name: 'Approve', exact: true }).count()) > 0) {
      await page.getByRole('button', { name: 'Approve', exact: true }).first().click()
    }

    const exportStarted = performance.now()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download', exact: true }).click()
    await downloadPromise
    const handoffExportMs = performance.now() - exportStarted

    const reloadStarted = performance.now()
    await page.reload()
    await waitForEvidenceTotal(page, expectedTotal)
    await page.getByText(/Acceptance note: Accepted for deterministic/).waitFor()
    const reloadMs = performance.now() - reloadStarted
    const heapAfter = await heapUsed(cdp)

    return {
      previewMs: round(previewMs),
      importRenderMs: round(importRenderMs),
      filterMs: round(filterMs),
      triagePersistMs: round(triagePersistMs),
      handoffExportMs: round(handoffExportMs),
      reloadMs: round(reloadMs),
      heapUsedMb: round(heapAfter / 1024 / 1024),
      heapDeltaMb: round((heapAfter - heapBefore) / 1024 / 1024),
    }
  } finally {
    await context.close()
  }
}

const server = await preview({
  logLevel: 'error',
  preview: { host, port, strictPort: true },
})
const browser = await chromium.launch({ headless: true })
const baseURL = `http://${host}:${port}`

try {
  const scenarios = []

  for (const format of ['json', 'sarif']) {
    for (const count of BENCHMARK_FINDING_COUNTS) {
      const samples = []

      for (let run = 0; run < warmupRuns + measuredRuns; run += 1) {
        const sample = await runIteration(browser, baseURL, format, count)

        if (run >= warmupRuns) {
          samples.push(sample)
        }
      }

      scenarios.push({
        format,
        findings: count,
        measuredRuns,
        metrics: summarize(samples),
      })
    }
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    environment: {
      platform: os.platform(),
      release: os.release(),
      architecture: os.arch(),
      cpu: os.cpus()[0]?.model ?? 'unknown',
      logicalCpus: os.cpus().length,
      memoryGb: round(os.totalmem() / 1024 / 1024 / 1024),
      node: process.version,
      browser: await browser.version(),
      warmupRuns,
      measuredRuns,
    },
    scenarios,
  }
  const serialized = `${JSON.stringify(report, null, 2)}\n`

  process.stdout.write(serialized)

  if (outputPath) {
    await writeFile(outputPath, serialized, 'utf8')
  }
} finally {
  await browser.close()
  await new Promise((resolve, reject) => {
    server.httpServer.close((error) => (error ? reject(error) : resolve()))
  })
}
