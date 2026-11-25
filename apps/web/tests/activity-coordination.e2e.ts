// Keyless assembled-Web evidence for Activity-scoped cross-Session discovery and deliberate context sharing.
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { ActivityResponsibilityRequestId } from '@deepseek-ai/dsh-home-activity/responsibility-types'
import {
  launchWebScaffold, readPersistedEvents, seedSession, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/feedback-command/session.v4.jsonl', import.meta.url))
const TARGET_FIXTURE = fileURLToPath(new URL('../../../snapshots/web/autolink-cjk-punctuation/session.v4.jsonl', import.meta.url))
const SCREENSHOT_DIR = fileURLToPath(new URL('../../../.artifacts/ui-review', import.meta.url))
const PROMPT = 'Reply with the single word LIGHTHOUSE and stop.'

describe('web e2e: Activity cross-Session coordination', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let scratchRoot: string | undefined

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
    if (scratchRoot !== undefined) await rm(scratchRoot, { recursive: true, force: true })
  })

  it('discovers independent Sessions and explicitly reenters a saved responsibility in the coordinator', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-activity-coordination'))
    const input = page.locator('[data-composer-input]').first()
    const settled = scaffold.whenTurnSettled()
    await input.fill(PROMPT)
    await input.press('Enter')
    const coordinatorSessionId = await settled
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor({ timeout: 15_000 })

    scratchRoot = await mkdtemp(join(tmpdir(), 'dsh-activity-coordination-'))
    const workspaceRoot = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd, 'Coordinator')
    const activity = await scaffold.ctx.homeActivities.create({
      name: 'Cross-project coordination evidence',
      objective: 'Review selected Session reports and decide what to do next.',
      boundaries: { inScope: ['Inspect explicitly selected Session evidence.'], outOfScope: ['Do not start target work.'] },
    })
    await scaffold.ctx.homeActivityAssociations.linkWorkspace(activity.id, workspaceRoot.id)
    await scaffold.ctx.homeActivityAssociations.linkSession(activity.id, coordinatorSessionId)

    const targetSessions: Array<{ readonly title: string; readonly id: SessionId; readonly workspaceId: WorkspaceId }> = []
    const targetFixture = await readFile(TARGET_FIXTURE, 'utf8')
    for (const [title, suffix] of [['Auteur', 'auteur'], ['Sensemaking Skills', 'sensemaking']] as const) {
      const path = join(scratchRoot, suffix)
      await mkdir(path)
      const workspace = await scaffold.ctx.workspaceRegistry.create(path, title)
      const id = `activity-coordination-target-${suffix}`
      const sessionId = await seedSession(scaffold, targetFixture, id, undefined, { cwd: path })
      await workspace.attachSession(sessionId)
      await scaffold.ctx.homeActivityAssociations.linkWorkspace(activity.id, workspace.id)
      await scaffold.ctx.homeActivityAssociations.linkSession(activity.id, sessionId)
      targetSessions.push({ title, id: sessionId, workspaceId: workspace.id })
    }
    const savedTask = 'Inspect the target Session and report its recorded work without changing files.'
    const firstTarget = targetSessions[0]
    if (firstTarget === undefined) throw new Error('The coordination demonstration requires a target Session.')
    const savedProposal = await scaffold.ctx.homeActivityResponsibilities.createProposal({
      activityId: activity.id,
      requestId: brandString<ActivityResponsibilityRequestId>(randomUUID()),
      coordinatingSessionId: coordinatorSessionId,
      target: { workspaceId: firstTarget.workspaceId, sessionId: firstTarget.id },
      task: savedTask,
      inScope: ['Inspect recorded Session evidence.'],
      outOfScope: ['Do not modify repository files.'],
      expectedOutcome: 'A source-attributed status report.',
      prerequisites: [],
      conflictingWork: [],
    })
    const targetEventsBefore = await Promise.all(targetSessions.map(target =>
      readPersistedEvents(scaffold, target.id),
    ))

    await input.fill('/coo')
    const suggestions = page.getByRole('listbox').last()
    await suggestions.waitFor({ timeout: 10_000 })
    const coordinateCommand = suggestions.getByRole('option').filter({ hasText: 'Coordinate Activity' })
    await coordinateCommand.waitFor({ timeout: 10_000 })
    await coordinateCommand.click()

    const dialog = page.getByRole('dialog', { name: 'Add Activity context to conversation' })
    await dialog.waitFor({ timeout: 10_000 })
    await dialog.getByLabel('Activity').selectOption(activity.id)
    for (const target of targetSessions) {
      await dialog.getByRole('checkbox', {
        name: `Select Session ${target.id} in Workspace ${target.title}`,
      }).check()
    }
    expect(await dialog.getByRole('checkbox').count()).toBe(2)
    expect(await dialog.getByText(activity.objective, { exact: true }).isVisible()).toBe(true)
    await dialog.getByRole('button', { name: 'Preview selected Session snapshots' }).click()

    for (const target of targetSessions) {
      await dialog.getByText(target.title, { exact: true }).last().waitFor({ timeout: 10_000 })
      await dialog.getByText(target.id, { exact: true }).last().waitFor({ timeout: 10_000 })
    }
    await expect.poll(() => dialog.getByText(/Observation source:/).count()).toBe(2)
    await expect.poll(() => dialog.getByText(/Source: deepseek-official/u).count()).toBe(2)
    await mkdir(SCREENSHOT_DIR, { recursive: true })
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'activity-coordination-preview.png'), fullPage: true })

    await page.setViewportSize({ width: 390, height: 844 })
    const narrowLayout = await dialog.evaluate(element => ({
      dialogWidth: element.getBoundingClientRect().width,
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }))
    expect(narrowLayout.dialogWidth).toBeLessThanOrEqual(narrowLayout.viewportWidth)
    expect(narrowLayout.documentWidth).toBeLessThanOrEqual(narrowLayout.viewportWidth)
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'activity-coordination-preview-narrow.png'), fullPage: true })
    await page.setViewportSize({ width: 1280, height: 900 })

    const targetEventsBeforeShare = await Promise.all(targetSessions.map(target =>
      readPersistedEvents(scaffold, target.id),
    ))
    expect(targetEventsBeforeShare).toEqual(targetEventsBefore)
    expect(await dialog.getByRole('button', { name: 'Add selected context to this conversation' }).isEnabled()).toBe(true)
    const responsibility = dialog.locator('details').filter({ hasText: savedTask })
    await responsibility.locator('summary').click()
    await responsibility.getByText(savedProposal.responsibilityId, { exact: true }).waitFor({ state: 'visible' })
    await responsibility.getByRole('button', { name: 'Add this responsibility to this conversation' }).click()
    await responsibility.getByRole('status').filter({ hasText: 'Historical responsibility queued' }).waitFor({ state: 'visible' })
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'activity-coordination-history-reentry.png'), fullPage: true })
    await expect.poll(async () => JSON.stringify(await readPersistedEvents(scaffold, coordinatorSessionId)))
      .toContain('user-selected-activity-responsibility-history')
    const targetEventsAfterPreview = await Promise.all(targetSessions.map(target =>
      readPersistedEvents(scaffold, target.id),
    ))
    expect(targetEventsAfterPreview).toEqual(targetEventsBefore)
    const history = scaffold.ctx.homeActivityResponsibilities.get(activity.id, savedProposal.responsibilityId)
    expect(history?.facts).toHaveLength(1)
    expect(history?.facts[0]?.kind).toBe('proposed')
  }, 90_000)
})
