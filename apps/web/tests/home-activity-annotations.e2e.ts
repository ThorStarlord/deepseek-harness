// Keyless rendered coverage for user-authored Activity annotation revisions.
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/feedback-command/session.v4.jsonl', import.meta.url))
const EXPECTED = fileURLToPath(new URL('./snapshots/home-activity-annotations/activity.expected.md', import.meta.url))
const MODE = webSnapshotMode()
const PROMPT = 'Reply with the single word LIGHTHOUSE and stop.'

describe.skipIf(MODE === 'record')('web e2e: Home Activity annotation corrections', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchPage>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, paceMs: 5, compareReplaySession: false })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchPage(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('renders a correction and invalid-input recovery beside an unchanged provider report', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-home-activity-annotations'))
    const input = page.locator('[data-composer-input]').first()
    const settled = scaffold.whenTurnSettled()
    await input.fill(PROMPT)
    await input.press('Enter')
    const parentSessionId = await settled
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor({ timeout: 15_000 })

    const startActivation = vi.spyOn(scaffold.ctx.subagents, 'startActivation')
    const createOutput = await submit('/activity create {"name":"Release review","objective":"Review the reported release state.","boundaries":{"inScope":["Compare current checks."],"outOfScope":["Do not release."]}}', /Activity created:/u)
    const activityId = /ID: ([0-9a-f-]{36})/u.exec(createOutput)?.[1]
    if (activityId === undefined) throw new Error('The Activity command did not return its stable id')
    const activity = scaffold.ctx.homeActivities.list().find(candidate => String(candidate.id) === activityId)
    if (activity === undefined) throw new Error('The created Activity could not be reopened from persistence')

    // Seed a deterministic report for provenance display; this does not call a provider or claim live execution.
    const delegation = await scaffold.ctx.homeActivityDelegations.createRequest({
      activityId: activity.id,
      provider: 'spawn',
      task: 'Report release readiness.',
      parentSessionId: SessionId(parentSessionId),
    })
    const admission = {
      childSessionId: SessionId(`annotation-render-${randomUUID()}`),
      activationName: 'activity-annotation-fixture',
      admittedAt: '2026-11-18T00:00:01.000Z',
      source: 'subagents.startActivation' as const,
    }
    await scaffold.ctx.homeActivityDelegations.recordAdmitted(delegation.id, admission)
    const providerReport = await scaffold.ctx.homeActivityDelegations.recordReported(delegation.id, admission, {
      stopReason: 'stop',
      outputText: 'The build is ready for release.',
      nonTextBlockTypes: [],
      outputTruncated: false,
      reportedAt: '2026-11-18T00:00:02.000Z',
      source: 'subagent-activation-result',
    })

    const initial = await submit(
      `/activity annotate ${activity.id} {"text":"The provider report says the build is ready for release."}`,
      /User annotation revision 1 recorded/u,
    )
    expect(initial).toContain('Provider-reported and specialist-authored facts were not changed.')
    const invalid = await submit(
      `/activity annotate ${activity.id} {"note":"This field is not supported."}`,
      /Activity annotation is invalid/u,
    )
    expect(invalid).toContain('Usage: /activity annotate')
    const correction = await submit(
      `/activity annotate ${activity.id} {"text":"Correction: migration validation is still failing; keep the release blocked."}`,
      /User annotation revision 2 recorded/u,
    )
    expect(correction).toContain('Earlier user annotations remain in history.')
    expect(scaffold.ctx.homeActivityDelegations.get(delegation.id)).toEqual(providerReport)
    expect(startActivation).not.toHaveBeenCalled()

    await submit(`/activity open ${activity.id}`, /Activity: Release review/u)
    const openResult = page.getByRole('button', { name: /Activity: Release review/u }).last()
    await openResult.click()
    await page.getByText(/Current annotation \(revision 2\)/u).last().waitFor({ timeout: 10_000 })
    const revisions = scaffold.ctx.homeActivityAnnotations.list(activity.id)
    expect(revisions).toHaveLength(2)
    expect(revisions[1]?.supersedes).toBe(revisions[0]?.id)
    const output = page.locator('pre').filter({ hasText: 'Home Harness coordination annotations' }).last()
    const rendered = await output.textContent() ?? ''
    expect(rendered).toContain('Correction: migration validation is still failing; keep the release blocked.')
    expect(rendered).toContain('The provider report says the build is ready for release.')
    expect(rendered).toContain('Provider-reported output: The build is ready for release.')
    expect(rendered).toContain('Status: provider reported; not verified or accepted.')

    const snapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd, {
      replacements: [
        [activity.id, '{{activity-id}}'],
        [activity.createdAt, '{{activity-created-at}}'],
        [revisions[0]!.id, '{{annotation-revision-id-1}}'],
        [revisions[0]!.recordedAt, '{{annotation-recorded-at-1}}'],
        [revisions[1]!.recordedAt, '{{annotation-recorded-at-2}}'],
        [delegation.id, '{{delegation-id}}'],
        [admission.childSessionId, '{{annotation-child-session-id}}'],
        [parentSessionId, '{{parent-session-id}}'],
      ],
    })
    await compareOrRefreshGolden(EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
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

function watchPage(page: Page) {
  const pageErrors: string[] = []
  const warnings: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'warning') warnings.push(message.text()) })
  return { pageErrors, warnings }
}
