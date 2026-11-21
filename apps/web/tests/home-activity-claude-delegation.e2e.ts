// Deterministic rendered coverage for the native Claude Code Activity route.
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, vi } from 'vitest'
import { NO_START_CAPABILITIES } from '@deepseek-ai/dsh-subagent'
import type { SubagentResult } from '@deepseek-ai/dsh-subagent'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/feedback-command', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.v3.jsonl')
const EXPECTED_DIR = fileURLToPath(new URL('./expected/home-activity-claude-delegation/', import.meta.url))
const REPORTED_EXPECTED = join(EXPECTED_DIR, 'claude-reported.expected.md')
const UNCONFIRMED_EXPECTED = join(EXPECTED_DIR, 'claude-unconfirmed.expected.md')
const SCREENSHOT_DIR = fileURLToPath(new URL('../../../.artifacts/ui-review', import.meta.url))
const MODE = webSnapshotMode()
const PROMPT = 'Reply with the single word LIGHTHOUSE and stop.'
const PERMISSION_CAVEAT = 'Activity scope is descriptive; native Claude Code configuration and permission handling govern this one-shot execution.'

describe('web e2e: Claude Code Activity delegation', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold(MODE === 'record' ? {} : {
      replayFixture: FIXTURE, paceMs: 5, compareReplaySession: false,
    })
    browser = await chromium.launch()
    page = await newEnglishPage(browser, 900)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it.skipIf(MODE === 'record')('renders one-shot attribution and an unconfirmed start without retry', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-home-activity-claude-delegation'))
    const input = page.locator('[data-composer-input]').first()
    const settled = scaffold.whenTurnSettled()
    await input.fill(PROMPT)
    await input.press('Enter')
    const parentSessionId = await settled
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor({ timeout: 15_000 })

    let providerStarts = 0
    let startupMode: 'report' | 'ambiguous' = 'report'
    const reportResult = Promise.withResolvers<SubagentResult>()
    const disposeProvider = scaffold.ctx.subagents.registerProvider({
      name: 'claude-code',
      capabilities: NO_START_CAPABILITIES,
      inheritsParentContext: false,
      async start() {
        providerStarts += 1
        if (startupMode === 'ambiguous') throw new Error('simulated transport loss after start dispatch')
        return {
          id: SessionId('claude-code-test-run-1'),
          result: reportResult.promise,
          dispose: async () => {},
        }
      },
    })

    const submit = async (line: string, marker: RegExp) => {
      await input.fill(line)
      await input.press('Enter')
      const rendered = page.getByText(marker).last()
      await rendered.waitFor({ timeout: 10_000 })
      await expect.poll(() => input.textContent(), { timeout: 10_000 }).toBe('')
      return await rendered.textContent() ?? ''
    }
    const createActivity = async (name: string, objective: string) => scaffold.ctx.homeActivities.create({
      name,
      objective,
      boundaries: { inScope: ['Review the release checklist once.'], outOfScope: ['Do not publish or retry.'] },
    })

    const reportedActivity = await createActivity(
      'Claude Code one-shot', 'Receive one bounded external Claude Code report.',
    )
    const requestedTask = 'Review the release checklist once and report the remaining migration step.'
    const admissionText = await submit(
      `/activity delegate ${reportedActivity.id} claude-code ${requestedTask}`,
      /Delegation admitted: provider claude-code/u,
    )
    expect(providerStarts).toBe(1)
    expect(admissionText).toContain('Claude Code adapter run id (not a DSH Session or native Claude Code conversation id): claude-code-test-run-1')
    expect(admissionText).toContain(PERMISSION_CAVEAT)
    expect(admissionText).toContain('Activity does not expose transcript inspection, continuation, resume, or rollback.')

    reportResult.resolve({
      stopReason: 'completed',
      output: [{ type: 'text', text: 'The checklist has one unverified migration step.' }],
    })
    await vi.waitFor(() => {
      expect(scaffold.ctx.homeActivityDelegations.list(reportedActivity.id)[0]?.status).toBe('reported')
    })
    const reportedRecord = scaffold.ctx.homeActivityDelegations.list(reportedActivity.id)[0]
    if (reportedRecord === undefined) throw new Error('The Claude Code report has no saved delegation identity.')
    await submit(`/activity open ${reportedActivity.id}`, /Activity: Claude Code one-shot/u)
    await page.getByRole('button', { name: /Activity: Claude Code one-shot/u }).last().click()
    const reportDetails = page.locator('pre').filter({ hasText: 'Claude Code-reported output:' }).last()
    await page.getByText(/Claude Code-reported output: The checklist has one unverified migration step\./u)
      .last().waitFor({ timeout: 10_000 })
    const reportedReplacements = [
      [reportedActivity.id, '{{activity-id}}'],
      [parentSessionId, '{{parent-session-id}}'],
      ['claude-code-test-run-1', '{{provider-run-id}}'],
      [reportedRecord.id, '{{delegation-id}}'],
      [reportedActivity.createdAt, '{{activity-created-at}}'],
      [reportedRecord.report?.reportedAt ?? '', '{{reported-at}}'],
    ] as const
    await mkdir(EXPECTED_DIR, { recursive: true })
    await mkdir(SCREENSHOT_DIR, { recursive: true })
    const reportedSnapshot = await captureStableAria(page, '[class*="centerCol"] pre:has-text("Claude Code-reported output:")',
      scaffold.workspaceCwd, { replacements: reportedReplacements })
    await compareOrRefreshGolden(REPORTED_EXPECTED, reportedSnapshot, MODE)
    expect(reportedSnapshot).toContain('provider claude-code (native Claude Code, external one-shot)')
    expect(reportedSnapshot).toContain(`Requested task: ${requestedTask}`)
    expect(reportedSnapshot).toContain('Delegation state: reported.')
    expect(reportedSnapshot).toContain('Provider report: received; DSH has not independently verified it.')
    expect(reportedSnapshot).toContain('Reported outcome: provider-reported completion; not independently verified.')
    expect(reportedSnapshot).toContain('Provider report source: subagent-activation-result.')
    expect(reportedSnapshot).toContain('Claude Code adapter run id (not a DSH Session or native Claude Code conversation id): {{provider-run-id}}')
    expect(reportedSnapshot).toContain(PERMISSION_CAVEAT)
    expect(reportedSnapshot).toContain('Claude Code-reported output: The checklist has one unverified migration step.')
    expect(reportedSnapshot).toContain('User disposition: pending; no review has been recorded.')
    expect(reportedSnapshot).not.toContain('User disposition: accepted.')
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'home-activity-claude-reported.png'), fullPage: true })
    await scrollTextIntoView(reportDetails, PERMISSION_CAVEAT)
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'home-activity-claude-reported-permission.png'), fullPage: true })

    startupMode = 'ambiguous'
    const uncertainActivity = await createActivity(
      'Claude Code startup uncertainty', 'Keep an ambiguous external start from being repeated.',
    )
    const uncertainText = await submit(
      `/activity delegate ${uncertainActivity.id} claude-code ${requestedTask}`,
      /DSH could not confirm whether Claude Code started/u,
    )
    expect(uncertainText).toContain('It may have started; do not repeat this task unless you have independently confirmed it did not start.')
    expect(providerStarts).toBe(2)
    const uncertainRecord = scaffold.ctx.homeActivityDelegations.list(uncertainActivity.id)[0]
    expect(uncertainRecord).toMatchObject({
      status: 'unconfirmed',
      request: { provider: 'claude-code' },
      uncertainty: { reason: 'claude-code-start-outcome-unknown' },
    })
    if (uncertainRecord === undefined) throw new Error('The ambiguous Claude Code start has no saved delegation identity.')
    expect(uncertainRecord.admission).toBeUndefined()
    await submit(`/activity open ${uncertainActivity.id}`, /Activity: Claude Code startup uncertainty/u)
    await page.getByRole('button', { name: /Activity: Claude Code startup uncertainty/u }).last().click()
    const uncertainDetails = page.locator('pre').filter({ hasText: 'No Claude Code execution id was saved.' }).last()
    await uncertainDetails.waitFor({ state: 'visible', timeout: 10_000 })
    await page.getByText(/do not repeat the task unless you independently confirm it did not start/u)
      .last().waitFor({ timeout: 10_000 })
    const uncertainTextInPanel = await uncertainDetails.textContent() ?? ''
    expect(uncertainTextInPanel).toContain('Status: unconfirmed; saved facts do not establish whether the external Claude Code run started.')
    expect(uncertainTextInPanel).toContain('No Claude Code execution id was saved. Activity does not expose its transcript, resume the run, or retry it; do not repeat the task unless you independently confirm it did not start.')
    expect(uncertainTextInPanel).toContain(PERMISSION_CAVEAT)
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'home-activity-claude-unconfirmed.png'), fullPage: true })
    await scrollTextIntoView(uncertainDetails, 'do not repeat the task unless you independently confirm it did not start')
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'home-activity-claude-unconfirmed-no-retry.png'), fullPage: true })
    await scrollTextIntoView(uncertainDetails, PERMISSION_CAVEAT)
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'home-activity-claude-unconfirmed-permission.png'), fullPage: true })
    expect(providerStarts).toBe(2)

    const uncertainSnapshot = await captureStableAria(page,
      '[class*="centerCol"] pre:has-text("No Claude Code execution id was saved.")', scaffold.workspaceCwd, {
        replacements: [
          [uncertainActivity.id, '{{activity-id}}'],
          [parentSessionId, '{{parent-session-id}}'],
          [uncertainRecord.id, '{{delegation-id}}'],
          [uncertainActivity.createdAt, '{{activity-created-at}}'],
          [uncertainRecord.uncertainty?.observedAt ?? '', '{{uncertainty-observed-at}}'],
        ],
      })
    await compareOrRefreshGolden(UNCONFIRMED_EXPECTED, uncertainSnapshot, MODE)
    expect(uncertainSnapshot).toContain('native Claude Code, external one-shot')
    expect(uncertainSnapshot).toContain(PERMISSION_CAVEAT)
    expect(uncertainSnapshot).toContain('do not repeat the task unless you independently confirm it did not start')
    expect(uncertainSnapshot).not.toContain('Claude Code adapter run id')
    expect(providerStarts).toBe(2)
    disposeProvider()
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)
})

/** Scroll an Activity detail until the requested caveat is visible in the browser viewport. */
async function scrollTextIntoView(container: Locator, text: string): Promise<void> {
  const visible = await container.evaluate((element, expectedText) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node !== null) {
      const start = node.textContent?.indexOf(expectedText) ?? -1
      if (start >= 0) {
        const range = document.createRange()
        range.setStart(node, start)
        range.setEnd(node, start + expectedText.length)
        const containerRect = element.getBoundingClientRect()
        const rect = range.getBoundingClientRect()
        if (rect.top < containerRect.top) element.scrollTop -= containerRect.top - rect.top
        else if (rect.bottom > containerRect.bottom) element.scrollTop += rect.bottom - containerRect.bottom
        const visibleRect = range.getBoundingClientRect()
        return visibleRect.top >= Math.max(0, containerRect.top)
          && visibleRect.bottom <= Math.min(window.innerHeight, containerRect.bottom)
      }
      node = walker.nextNode()
    }
    return false
  }, text)
  expect(visible).toBe(true)
}
