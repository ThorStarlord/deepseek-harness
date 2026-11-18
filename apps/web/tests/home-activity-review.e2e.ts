// Review records live in the Activity StorageDomain, not the Session log. This keyless Web scenario
// replays a recorded Session only for model setup, then owns its persisted review ARIA golden here;
// snapshots/AGENTS.md reserves the top-level Session corpus for Session-driven persisted output.
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/feedback-command/session.v3.jsonl', import.meta.url))
const EXPECTED = fileURLToPath(new URL('./snapshots/home-activity-review/reviewed.expected.md', import.meta.url))
const SCREENSHOT = fileURLToPath(new URL('../../../.artifacts/ui-review/home-activity-review.png', import.meta.url))
const MODE = webSnapshotMode()
const PROMPT = 'Reply with the single word LIGHTHOUSE and stop.'

async function hostRpc<T>(scaffold: WebScaffold, endpoint: string, args: Readonly<Record<string, unknown>>): Promise<T> {
  const response = await scaffold.hostFetch(`/api/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request', rpcId: `home-activity-review-${randomUUID()}`, method: endpoint, payload: { args },
    }),
  })
  if (!response.ok) throw new Error(`${endpoint} failed over HTTP ${response.status}: ${await response.text()}`)
  const result = (await response.json() as {
    result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
  }).result
  if (!result.ok) throw new Error(`${endpoint} failed: ${result.error.code}: ${result.error.message}`)
  return result.value
}

async function executeCommand(
  scaffold: WebScaffold,
  agentId: string,
  line: string,
): Promise<{ readonly kind: string; readonly text?: string }> {
  const value = await hostRpc<{ result: { kind: string; text?: string } }>(
    scaffold, 'commands/execute', { agentId, line, submittedAttachments: [] },
  )
  return value.result
}

describe('web e2e: Home Activity outcome review', () => {
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

  it.skipIf(MODE === 'record')('renders provider report, user-supplied failed evidence, and explicit disposition separately', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-home-activity-review'))
    const input = page.locator('[data-composer-input]').first()
    const settled = scaffold.whenTurnSettled()
    await input.fill(PROMPT)
    await input.press('Enter')
    const parentSessionId = await settled
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor({ timeout: 15_000 })

    const activity = await scaffold.ctx.homeActivities.create({
      name: 'Release readiness',
      objective: 'Review a provider-reported release change.',
      boundaries: { inScope: ['Inspect the report and evidence.'], outOfScope: ['Do not publish.'] },
    })
    const delegation = await scaffold.ctx.homeActivityDelegations.createRequest({
      activityId: activity.id,
      provider: 'spawn',
      task: 'Inspect the release change.',
      parentSessionId,
    })
    const admission = {
      childSessionId: SessionId('activity-review-child'),
      activationName: 'activity-review',
      admittedAt: '2026-11-18T12:00:00.000Z',
      source: 'subagents.startActivation' as const,
    }
    await scaffold.ctx.homeActivityDelegations.recordAdmitted(delegation.id, admission)
    await scaffold.ctx.homeActivityDelegations.recordReported(delegation.id, admission, {
      stopReason: 'stop',
      outputText: 'The provider reported the requested change complete.',
      nonTextBlockTypes: [],
      outputTruncated: false,
      reportedAt: '2026-11-18T12:01:00.000Z',
      source: 'subagent-activation-result',
    })
    const providerReport = scaffold.ctx.homeActivityDelegations.get(delegation.id)
    const startActivation = vi.spyOn(scaffold.ctx.subagents, 'startActivation')

    const submit = async (line: string, marker: RegExp) => {
      await input.fill(line)
      await input.press('Enter')
      const output = page.getByText(marker).last()
      await output.waitFor({ timeout: 10_000 })
      await expect.poll(() => input.textContent(), { timeout: 10_000 }).toBe('')
      return await output.textContent() ?? ''
    }

    await submit(`/activity open ${activity.id}`, /Activity: Release readiness/u)
    await page.getByRole('button', { name: /Activity: Release readiness/u }).last().click()
    const initialView = page.locator('pre').filter({ hasText: 'User disposition: pending' }).last()
    await initialView.waitFor({ timeout: 10_000 })
    const initialText = await initialView.textContent() ?? ''
    expect(initialText).toContain('Status: provider reported; not verified or accepted.')
    expect(initialText).toContain('Verification evidence: none recorded.')

    const reviewCommand = await submit(
      `/activity review set ${activity.id} ${delegation.id} {"disposition":"requires-investigation","evidence":{"source":"Release CI run","result":"failed","summary":"The publish validation job failed.","reference":"https://example.test/checks/release-validation"}}`,
      /User disposition recorded: requires investigation/u,
    )
    expect(reviewCommand).toContain('Release CI run reports failed.')
    expect(reviewCommand).toContain('DSH did not verify its source or result.')
    expect(reviewCommand).toContain('provider execution report was not changed')

    await submit(
      `/activity review set ${activity.id} ${delegation.id} {"disposition":"requires-investigation","evidence":{"source":"Independent smoke check","result":"passed","summary":"The smoke check reported success."}}`,
      /Independent smoke check reports passed/u,
    )

    await submit(`/activity open ${activity.id}`, /Activity: Release readiness/u)
    await page.getByRole('button', { name: /Activity: Release readiness/u }).last().click()
    const reviewedView = page.locator('pre').filter({ hasText: 'Independent smoke check reports passed' }).last()
    await reviewedView.waitFor({ timeout: 10_000 })
    const rendered = await reviewedView.textContent() ?? ''
    expect(rendered).toContain('Status: provider reported; not verified or accepted.')
    expect(rendered).toContain('User disposition: requires investigation')
    expect(rendered).toContain('The publish validation job failed.')
    expect(rendered).toContain('Independent smoke check reports passed.')
    expect(rendered).toContain('The smoke check reported success.')
    expect(rendered).toContain('not checked by DSH')
    expect(scaffold.ctx.homeActivityDelegations.get(delegation.id)).toEqual(providerReport)
    expect(startActivation).not.toHaveBeenCalled()

    const output = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd, {
      replacements: [
        [activity.id, '{{activity-id}}'],
        [delegation.id, '{{delegation-id}}'],
        [parentSessionId, '{{parent-session-id}}'],
      ],
    })
    await mkdir(dirname(EXPECTED), { recursive: true })
    await compareOrRefreshGolden(EXPECTED, output, MODE)
    await mkdir(dirname(SCREENSHOT), { recursive: true })
    await page.screenshot({ path: SCREENSHOT, fullPage: true })

    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    const session = await hostRpc<{ sessionId: string }>(
      scaffold, 'session/create', { request: { workspaceId: scaffold.ctx.workspaceRegistry.list()[0]!.id } },
    )
    expect(session.sessionId).not.toBe(parentSessionId)
    const reopened = await executeCommand(scaffold, session.sessionId, `/activity open ${activity.id}`)
    expect(reopened.kind).toBe('success')
    expect(reopened.text).toContain('Status: provider reported; not verified or accepted.')
    expect(reopened.text).toContain('User disposition: requires investigation')
    expect(reopened.text).toContain('Release CI run reports failed.')
    expect(reopened.text).toContain('Independent smoke check reports passed.')
    expect(scaffold.ctx.homeActivityDelegations.get(delegation.id)).toEqual(providerReport)
    expect(startActivation).not.toHaveBeenCalled()
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)
})
