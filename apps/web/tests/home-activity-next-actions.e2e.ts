// Keyless rendered coverage for Activity recovery guidance after provider unavailability.
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, vi } from 'vitest'
import { NO_START_CAPABILITIES } from '@deepseek-ai/dsh-subagent'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/feedback-command/session.v4.jsonl', import.meta.url))
const EXPECTED = fileURLToPath(new URL('./snapshots/home-activity-next-actions/next-actions.expected.md', import.meta.url))
const MODE = webSnapshotMode()
const PROMPT = 'Reply with the single word LIGHTHOUSE and stop.'

describe.skipIf(MODE === 'record')('web e2e: Home Activity next actions', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, paceMs: 5, compareReplaySession: false })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('preserves an unavailable-provider blocker and renders only a separate registered route', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-home-activity-next-actions'))
    const input = page.locator('[data-composer-input]').first()
    const settled = scaffold.whenTurnSettled()
    await input.fill(PROMPT)
    await input.press('Enter')
    const parentSessionId = await settled
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor({ timeout: 15_000 })

    const activity = await scaffold.ctx.homeActivities.create({
      name: 'Unavailable provider recovery',
      objective: 'Keep the saved delegation blocker visible without claiming work started.',
      boundaries: { inScope: ['Review the saved provider state.'], outOfScope: ['Do not start another run.'] },
    })
    const startActivation = vi.spyOn(scaffold.ctx.subagents, 'startActivation')
    const unavailable = await submit(
      `/activity delegate ${activity.id} codex Review the saved check results.`,
      /Codex provider is unavailable; DSH did not attempt activation\./u,
    )
    expect(unavailable).toContain('DSH did not attempt activation.')
    expect(startActivation).not.toHaveBeenCalled()
    const savedBeforeOpen = scaffold.ctx.homeActivityDelegations.list(activity.id)[0]
    if (savedBeforeOpen === undefined) throw new Error('The unavailable-provider request was not retained')
    expect(savedBeforeOpen).toMatchObject({
      status: 'not-admitted',
      request: { provider: 'codex', parentSessionId: SessionId(parentSessionId) },
      failure: { source: 'subagents.startActivation' },
    })

    let providerStarts = 0
    const disposeProvider = scaffold.ctx.subagents.registerProvider({
      name: 'codex',
      capabilities: NO_START_CAPABILITIES,
      inheritsParentContext: false,
      start() {
        providerStarts += 1
        throw new Error('Opening an Activity must not start a provider')
      },
    })
    try {
      const registeredRoutes = (['spawn', 'codex', 'claude-code'] as const)
        .filter(provider => scaffold.ctx.subagents.getProvider(provider) !== undefined)
      await submit(`/activity open ${activity.id}`, /Activity: Unavailable provider recovery/u)
      await page.getByRole('button', { name: /Activity: Unavailable provider recovery/u }).last().click()
      const detail = page.locator('pre').filter({ hasText: 'Next actions:' }).last()
      await detail.waitFor({ state: 'visible', timeout: 10_000 })
      const rendered = await detail.textContent() ?? ''

      expect(rendered).toContain('Status: not admitted.')
      expect(rendered).toContain('The Codex provider is unavailable; DSH did not attempt activation.')
      expect(rendered).toContain(`Provider routes registered now: ${registeredRoutes.join(', ')}.`)
      expect(rendered).toContain('Registration does not establish credential readiness, user consent, native permission, or provider admission.')
      expect(rendered).toContain(`/activity delegate ${activity.id} <registered-provider> <one bounded task>`)
      expect(rendered).toContain('This creates a new request; it does not retry or resume the saved request.')
      expect(rendered).not.toContain('Codex accepted')
      expect(rendered).not.toContain('provider-reported completion')
      expect(rendered).not.toContain('automatically')
      expect(scaffold.ctx.homeActivityDelegations.get(savedBeforeOpen.id)).toEqual(savedBeforeOpen)
      expect(startActivation).not.toHaveBeenCalled()
      expect(providerStarts).toBe(0)

      const snapshot = await captureStableAria(page,
        '[class*="centerCol"] pre:has-text("Next actions:")', scaffold.workspaceCwd, {
          replacements: [
            [activity.id, '{{activity-id}}'],
            [activity.createdAt, '{{activity-created-at}}'],
            [parentSessionId, '{{parent-session-id}}'],
            [savedBeforeOpen.id, '{{delegation-id}}'],
            [savedBeforeOpen.request.requestedAt, '{{requested-at}}'],
          ],
        })
      await mkdir(new URL('./snapshots/home-activity-next-actions/', import.meta.url), { recursive: true })
      await compareOrRefreshGolden(EXPECTED, snapshot, MODE)
      expect(snapshot).toContain(`Provider routes registered now: ${registeredRoutes.join(', ')}.`)
      expect(snapshot).toContain('DSH did not attempt activation.')
    } finally {
      disposeProvider()
    }
  }, 60_000)

  async function submit(line: string, marker: RegExp): Promise<string> {
    const input = page.locator('[data-composer-input]').first()
    await input.fill(line)
    await input.press('Enter')
    const output = page.getByText(marker).last()
    await output.waitFor({ timeout: 10_000 })
    await expect.poll(() => input.textContent(), { timeout: 10_000 }).toBe('')
    return await output.textContent() ?? ''
  }
})
