// Keyless rendered coverage for the explicit Home Activity delegation command.
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, vi } from 'vitest'
import type { SubagentResult } from '@deepseek-ai/dsh-subagent'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/feedback-command', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.v3.jsonl')
const PENDING_EXPECTED = join(SNAPSHOT_DIR, 'activity-delegation-pending.expected.md')
const REPORTED_EXPECTED = join(SNAPSHOT_DIR, 'activity-delegation-reported.expected.md')
const SCREENSHOT_DIR = fileURLToPath(new URL('../../../.artifacts/ui-review', import.meta.url))
const PENDING_SCREENSHOT = join(SCREENSHOT_DIR, 'home-activity-delegation-pending.png')
const REPORTED_SCREENSHOT = join(SCREENSHOT_DIR, 'home-activity-delegation.png')
const MODE = webSnapshotMode()
const PROMPT = 'Reply with the single word LIGHTHOUSE and stop.'

describe('web e2e: Home Activity delegation', () => {
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

  it.skipIf(MODE === 'record')('renders request, admission, and report as distinct user-visible facts', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-home-activity-delegation'))
    const input = page.locator('[data-composer-input]').first()
    const settled = scaffold.whenTurnSettled()
    await input.fill(PROMPT)
    await input.press('Enter')
    const parentSessionId = await settled
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor({ timeout: 15_000 })

    const activity = await scaffold.ctx.homeActivities.create({
      name: 'Release readiness',
      objective: 'Prepare the next release for review.',
      boundaries: { inScope: ['Inspect the release checklist.'], outOfScope: ['Do not publish.'] },
    })
    const childResult = Promise.withResolvers<SubagentResult>()
    let requestedChildSessionId: string | undefined
    const start = vi.spyOn(scaffold.ctx.subagents, 'startActivation').mockImplementation(async (spec) => {
      if (spec.childId === undefined) throw new Error('The Activity command did not reserve a child Session id.')
      requestedChildSessionId = spec.childId
      return {
        childId: spec.childId,
        name: 'activity-review',
        result: childResult.promise,
        dispose: async () => {},
      }
    })

    const submit = async (line: string, marker: RegExp) => {
      await input.fill(line)
      await input.press('Enter')
      await page.getByText(marker).last().waitFor({ timeout: 10_000 })
      await expect.poll(() => input.textContent(), { timeout: 10_000 }).toBe('')
    }
    await submit(
      `/activity delegate ${activity.id} spawn Inspect the release checklist.`,
      /Delegation admitted: provider spawn/u,
    )
    expect(start).toHaveBeenCalledTimes(1)
    const startSpec = start.mock.calls[0]?.[0]
    if (startSpec === undefined) throw new Error('The DSH subagent provider was not invoked.')
    expect(startSpec.provider).toBe('spawn')
    expect(startSpec.parent.id).toBe(parentSessionId)
    if (requestedChildSessionId === undefined) throw new Error('The accepted activation has no child Session identity.')

    const admissionText = await page.getByText(/Delegation admitted: provider spawn/u).last().textContent() ?? ''
    expect(admissionText).toContain(`Child Session: ${requestedChildSessionId}`)
    expect(admissionText).toContain('not yet available, verified, or accepted')
    await submit(`/activity open ${activity.id}`, /Activity: Release readiness/u)
    await page.getByRole('button', { name: /Activity: Release readiness/u }).last().click()
    await page.getByText(/Provider outcome is pending/u).last().waitFor({ timeout: 10_000 })

    const replacements = [
      [activity.id, '{{activity-id}}'],
      [parentSessionId, '{{parent-session-id}}'],
      [requestedChildSessionId, '{{child-session-id}}'],
      [activity.createdAt, '{{activity-created-at}}'],
    ] as const
    const pendingSnapshot = await captureStableAria(
      page, '[class*="centerCol"]', scaffold.workspaceCwd, { replacements },
    )
    await compareOrRefreshGolden(PENDING_EXPECTED, pendingSnapshot, MODE)
    expect(pendingSnapshot).toContain('Status: admitted; not verified or accepted.')
    expect(pendingSnapshot).toContain('Provider outcome is pending')
    await mkdir(SCREENSHOT_DIR, { recursive: true })
    await page.screenshot({ path: PENDING_SCREENSHOT, fullPage: true })

    childResult.resolve({
      stopReason: 'completed',
      output: [{ type: 'text', text: 'The checklist contains two unverified migration steps.' }],
    })
    await vi.waitFor(async () => {
      expect(scaffold.ctx.homeActivityDelegations.list(activity.id)[0]?.status).toBe('reported')
    })
    await submit(`/activity open ${activity.id}`, /Activity: Release readiness/u)
    await page.getByRole('button', { name: /Activity: Release readiness/u }).last().click()
    await page.getByText(/Provider-reported output: The checklist contains two unverified migration steps\./u)
      .last().waitFor({ timeout: 10_000 })
    const delegationId = /Delegation ([0-9a-f-]{36}): provider spawn/u
      .exec(await page.locator('pre').filter({ hasText: 'Provider-reported output:' }).last().textContent() ?? '')?.[1]
    if (delegationId === undefined) throw new Error('Rendered Activity report omitted its stable delegation identity.')
    const reportReplacements = [...replacements, [delegationId, '{{delegation-id}}']] as const
    await page.screenshot({ path: REPORTED_SCREENSHOT, fullPage: true })
    const reportedSnapshot = await captureStableAria(
      page, '[class*="centerCol"]', scaffold.workspaceCwd, { replacements: reportReplacements },
    )
    await compareOrRefreshGolden(REPORTED_EXPECTED, reportedSnapshot, MODE)
    expect(reportedSnapshot).toContain('Status: provider reported; not verified or accepted.')
    expect(reportedSnapshot).toContain('Provider-reported output: The checklist contains two unverified migration steps.')
    expect(reportedSnapshot).not.toContain('Status: accepted.')
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)
})
