// User-supplied external handoff rendered and reopened from a separate DSH Session.
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const EXPECTED = fileURLToPath(new URL('./snapshots/home-activity-handoff/external-handoff.expected.md', import.meta.url))
const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/feedback-command', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.v3.jsonl')
const PROMPT = 'Reply with the single word LIGHTHOUSE and stop.'
const SCREENSHOT_DIR = fileURLToPath(new URL('../../../.artifacts/ui-review', import.meta.url))
const SCREENSHOT_TOP = join(SCREENSHOT_DIR, 'home-activity-external-handoff-top.png')
const SCREENSHOT_BOTTOM = join(SCREENSHOT_DIR, 'home-activity-external-handoff-bottom.png')
const MODE = webSnapshotMode()

describe('web e2e: external Activity handoff', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold(MODE === 'record' ? {} : {
      replayFixture: FIXTURE, replayChildFixtures: [FIXTURE], paceMs: 5, compareReplaySession: false,
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

  it.skipIf(MODE === 'record')('records a user-supplied handoff and reopens it from another Session after page reload', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-home-activity-handoff'))
    const input = page.locator('[data-composer-input][contenteditable="true"]').first()
    const settled = scaffold.whenTurnSettled()
    await input.fill(PROMPT)
    await input.press('Enter')
    await settled
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor({ timeout: 15_000 })
    const firstSessionId = await page.evaluate(() => {
      const current = JSON.parse(localStorage.getItem('dsh.sessions.current') ?? '{}') as { sessionId?: string }
      return current.sessionId
    })
    if (firstSessionId === undefined) throw new Error('The connected Workspace did not select a DSH Session')
    const submit = async (line: string, marker: RegExp) => {
      await input.fill(line)
      await input.press('Enter')
      const output = page.getByText(marker).last()
      await output.waitFor({ timeout: 10_000 })
      await expect.poll(() => input.textContent(), { timeout: 10_000 }).toBe('')
      return await output.textContent() ?? ''
    }

    const created = await submit(
      '/activity create {"name":"Release readiness","objective":"Prepare the release for review.","boundaries":{"inScope":["Collect external reports."],"outOfScope":["Do not publish."]}}',
      /Activity created: Release readiness/u,
    )
    const activityId = /ID: ([0-9a-f-]{36})/u.exec(created)?.[1]
    if (activityId === undefined) throw new Error('Rendered Activity creation did not include its stable id')
    const handoffDetails = JSON.stringify({
      source: 'Claude Code terminal',
      summary: 'The external run reports two checklist items for follow-up.',
      sourceReference: 'https://example.invalid/external/review/123',
      artifacts: [{ label: 'Review notes', location: 'reports/external-review.md', revision: 'a'.repeat(40) }],
    })
    const recorded = await submit(
      `/activity handoff add ${activityId} ${handoffDetails}`,
      /External handoff recorded: Claude Code terminal/u,
    )
    expect(recorded).toContain('Origin: user-supplied external report')
    expect(recorded).toContain(`Recorded in DSH Session: ${firstSessionId}`)
    expect(recorded).toContain('does not import a native Session or confirm external execution')
    const handoffId = /ID: ([0-9a-f-]{36})/u.exec(recorded)?.[1]
    if (handoffId === undefined) throw new Error('Rendered handoff command did not include its stable id')
    const newSessionResponse = page.waitForResponse('**/api/session/create')
    await page.getByRole('button', { name: 'New session', exact: true }).last().click()
    const newSession = await newSessionResponse
    const newSessionBody = await newSession.json() as { result: { ok: boolean; value: { sessionId: string } } }
    expect(newSessionBody.result.ok).toBe(true)
    const readingSessionId = newSessionBody.result.value.sessionId
    expect(readingSessionId).not.toBe(firstSessionId)
    await page.reload({ waitUntil: 'load' })
    await input.waitFor({ timeout: 15_000 })
    const selectedSessionId = await page.evaluate(() => {
      const current = JSON.parse(localStorage.getItem('dsh.sessions.current') ?? '{}') as { sessionId?: string }
      return current.sessionId
    })
    expect(selectedSessionId).toBe(readingSessionId)
    const secondTurnSettled = scaffold.whenTurnSettled()
    await input.fill(PROMPT)
    await input.press('Enter')
    await secondTurnSettled
    await page.getByText('LIGHTHOUSE', { exact: true }).last().waitFor({ timeout: 15_000 })

    await submit(`/activity open ${activityId}`, /Activity: Release readiness/u)
    await page.getByRole('button', { name: /Activity: Release readiness/u }).last().click()
    const opened = await page.locator('pre')
      .filter({ hasText: 'External handoffs (user-supplied; not imported native execution history)' })
      .last()
    await mkdir(SCREENSHOT_DIR, { recursive: true })
    await page.screenshot({ path: SCREENSHOT_TOP, fullPage: true })
    await opened.evaluate((element) => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => opened.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop))
      .toBeLessThanOrEqual(1)
    const isLineVisible = async (line: string) => await opened.evaluate((element, text) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()
      while (node !== null) {
        const index = node.textContent?.indexOf(text) ?? -1
        if (index >= 0) {
          const range = document.createRange()
          range.setStart(node, index)
          range.setEnd(node, index + text.length)
          const textRect = range.getBoundingClientRect()
          const box = element.getBoundingClientRect()
          return textRect.top >= box.top && textRect.bottom <= box.bottom
        }
        node = walker.nextNode()
      }
      return false
    }, line)
    expect(await isLineVisible(`Artifact revision: ${'a'.repeat(40)}`)).toBe(true)
    expect(await isLineVisible('not been independently verified or accepted')).toBe(true)
    await page.screenshot({ path: SCREENSHOT_BOTTOM, fullPage: true })
    const openedText = await opened.textContent() ?? ''
    expect(openedText).toContain('External handoffs (user-supplied; not imported native execution history)')
    expect(openedText).toContain(`External handoff: Claude Code terminal — ${handoffId}`)
    expect(openedText).toContain(`Recorded in DSH Session: ${firstSessionId}`)
    expect(openedText).toContain('User-supplied summary: The external run reports two checklist items for follow-up.')
    expect(openedText).toContain('User-supplied source reference: https://example.invalid/external/review/123')
    expect(openedText).toContain('User-supplied artifact reference: Review notes — reports/external-review.md')
    expect(openedText).toContain(`Artifact revision: ${'a'.repeat(40)}`)
    expect(openedText).toContain('not been independently verified or accepted')
    const replacements = [
      [activityId, '{{activity-id}}'],
      [handoffId, '{{handoff-id}}'],
      [firstSessionId, '{{recording-session-id}}'],
      [readingSessionId, '{{reading-session-id}}'],
    ] as const
    const snapshot = await captureStableAria(
      page, '[class*="centerCol"]', scaffold.workspaceCwd, { replacements },
    )
    await mkdir(dirname(EXPECTED), { recursive: true })
    await compareOrRefreshGolden(EXPECTED, snapshot, MODE)
    expect(snapshot).toContain('External handoffs (user-supplied; not imported native execution history)')
    expect(snapshot).toContain('{{recording-session-id}}')
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)
})
