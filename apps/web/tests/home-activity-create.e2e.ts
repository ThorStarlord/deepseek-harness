// Keyless rendered evidence for the human /activity JSON creation interaction.
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/feedback-command', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.v3.jsonl')
const EXPECTED = join(SNAPSHOT_DIR, 'activity-create.expected.md')
const SCREENSHOT_DIR = fileURLToPath(new URL('../../../.artifacts/ui-review', import.meta.url))
const INPUT_SCREENSHOT = join(SCREENSHOT_DIR, 'home-activity-create-input.png')
const SAVED_SCREENSHOT = join(SCREENSHOT_DIR, 'home-activity-create-saved.png')
const MODE = webSnapshotMode()
const PROMPT = 'Reply with the single word LIGHTHOUSE and stop.'

describe('web e2e: named Activity creation', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold(MODE === 'record' ? {} : {
      replayFixture: FIXTURE, paceMs: 5, compareReplaySession: false,
    })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it.skipIf(MODE === 'record')('renders JSON creation as saved intent without starting work', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-home-activity-create'))
    const input = page.locator('[data-composer-input]').first()
    const settled = scaffold.whenTurnSettled()
    await input.fill(PROMPT)
    await input.press('Enter')
    await settled
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor({ timeout: 15_000 })

    await input.fill('/activity create {"name":"Release readiness","objective":"Prepare the next release for review.","boundaries":{"inScope":["Review release notes and focused check results."],"outOfScope":["Do not publish or deploy."]}}')
    await mkdir(SCREENSHOT_DIR, { recursive: true })
    await page.screenshot({ path: INPUT_SCREENSHOT, fullPage: true })
    await input.press('Enter')
    await page.getByText(/Saved only; its objective has not been started\./).waitFor({ timeout: 10_000 })
    await expect.poll(() => input.textContent(), { timeout: 10_000 }).toBe('')
    await expect.poll(() => page.getByRole('button', { name: 'Add files or run commands' }).isEnabled(), { timeout: 10_000 }).toBe(true)

    await page.screenshot({ path: SAVED_SCREENSHOT, fullPage: true })
    const snapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(EXPECTED, snapshot, MODE)

    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)
})
