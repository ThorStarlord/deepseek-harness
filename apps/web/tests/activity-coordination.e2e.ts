// Keyless assembled-Web evidence for Activity-scoped discovery, confirmed delivery, and deliberate history reentry.
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import {
  launchWebScaffold, readPersistedEvents, seedSession, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/activity-coordination-context/session.v4.jsonl', import.meta.url))
const TARGET_FIXTURE = fileURLToPath(new URL('../../../snapshots/web/autolink-cjk-punctuation/session.v4.jsonl', import.meta.url))
const SCREENSHOT_DIR = fileURLToPath(new URL('../../../.artifacts/ui-review', import.meta.url))
const PROMPT = 'Please be ready to review selected Activity Session snapshots after I add them to this conversation. Do not start work.'
const FOLLOW_UP = 'Based only on the selected snapshots, recommend one bounded read-only responsibility. Do not dispatch or start it.'
const RECOMMENDATION = 'The selected snapshots are historical reports. I recommend a bounded read-only request to the Auteur Session for its latest unresolved work, with its source event recorded. This remains a recommendation and does not authorize execution.'

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

  it('discovers independent Sessions, confirms a bounded responsibility, and recovers it without resending', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-activity-coordination'))
    const input = page.locator('[data-composer-input]').first()
    const settled = scaffold.whenTurnSettled()
    await input.fill(PROMPT)
    await input.press('Enter')
    const coordinatorSessionId = await settled
    await page.getByText('Ready to review the selected Session snapshots after you add them. I will not start work.', { exact: true })
      .waitFor({ timeout: 15_000 })

    scratchRoot = await mkdtemp(join(tmpdir(), 'dsh-activity-coordination-'))
    using coordinatorState = await scaffold.ctx.sessionQuery.observeSession(coordinatorSessionId, { projectionMode: 'none' })
    const coordinatorCwd = coordinatorState.header.cwd
    if (coordinatorCwd === undefined) throw new Error('The coordinating Session has no repository context.')
    const workspaceRoot = scaffold.ctx.workspaceRegistry.list().find(workspace => workspace.path === coordinatorCwd)
      ?? await scaffold.ctx.workspaceRegistry.create(coordinatorCwd, 'Coordinator')
    if (!workspaceRoot.sessionIds.includes(coordinatorSessionId)) await workspaceRoot.attachSession(coordinatorSessionId)
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
    const firstTarget = targetSessions[0]
    if (firstTarget === undefined) throw new Error('The coordination demonstration requires a target Session.')
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
    const previewList = dialog.locator('[class*="previewList"]')
    const previewScroll = await previewList.evaluate(element => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }))
    expect(previewScroll.scrollHeight).toBeGreaterThan(previewScroll.clientHeight)
    await previewList.evaluate((element) => { element.scrollTop = element.scrollHeight })
    expect(await previewList.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    const secondSnapshotIdentity = dialog.getByText(targetSessions[1]?.id ?? '', { exact: true }).last()
    await secondSnapshotIdentity.scrollIntoViewIfNeeded()
    const secondSnapshotBox = await secondSnapshotIdentity.boundingBox()
    if (secondSnapshotBox === null) throw new Error('The second selected Session snapshot did not render on the narrow screen.')
    expect(secondSnapshotBox.y).toBeGreaterThanOrEqual(0)
    expect(secondSnapshotBox.y + secondSnapshotBox.height).toBeLessThanOrEqual(844)
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'activity-coordination-preview-narrow.png'), fullPage: true })
    await page.setViewportSize({ width: 1280, height: 900 })

    const targetEventsBeforeShare = await Promise.all(targetSessions.map(target =>
      readPersistedEvents(scaffold, target.id),
    ))
    expect(targetEventsBeforeShare).toEqual(targetEventsBefore)
    expect(await dialog.getByRole('button', { name: 'Add selected context to this conversation' }).isEnabled()).toBe(true)
    await dialog.getByRole('button', { name: 'Add selected context to this conversation' }).click()
    await dialog.getByRole('status').filter({
      hasText: 'Context was added to this conversation. Nothing was sent to the target Sessions.',
    }).first().waitFor({ state: 'visible' })
    await expect.poll(async () => JSON.stringify(await readPersistedEvents(scaffold, coordinatorSessionId)))
      .toContain('user-selected-activity-session-context')
    await dialog.getByRole('button', { name: 'Cancel' }).click()

    const recommendationSettled = scaffold.whenTurnSettled()
    await input.fill(FOLLOW_UP)
    await input.press('Enter')
    await recommendationSettled
    await page.getByText(RECOMMENDATION, { exact: true }).waitFor({ timeout: 15_000 })

    await page.getByRole('button', { name: 'Propose responsibility', exact: true }).last().click()
    const responsibilityDialog = page.getByRole('dialog', { name: 'Create from this recommendation' })
    await responsibilityDialog.waitFor({ timeout: 10_000 })
    await responsibilityDialog.getByLabel('Activity').selectOption(activity.id)
    await responsibilityDialog.getByRole('radio', {
      name: `Select Session ${firstTarget.id} in Workspace ${firstTarget.title}`,
    }).check()
    const savedTask = 'Ask the selected Session for a read-only summary of its latest recorded work and unresolved items.'
    await responsibilityDialog.getByLabel('Task').fill(savedTask)
    await responsibilityDialog.getByLabel('In scope (one item per line)').fill('Summarize the latest recorded work in this Session.\nIdentify unresolved items and cite source events.')
    await responsibilityDialog.getByLabel('Out of scope (one item per line)').fill('Do not modify repository files.\nDo not delegate further work.')
    await responsibilityDialog.getByLabel('Expected outcome').fill('A source-attributed status report with uncertainty stated.')
    await responsibilityDialog.getByRole('button', { name: 'Save advisory proposal' }).click()
    try {
      await responsibilityDialog.getByRole('heading', { name: 'Confirm exact responsibility' }).waitFor({ timeout: 10_000 })
    } catch (cause: unknown) {
      const alerts = await responsibilityDialog.getByRole('alert').allTextContents()
      throw new Error(`The advisory proposal was not saved: ${alerts.join(' | ') || 'no error notice appeared'}`, { cause })
    }
    const savedHistory = scaffold.ctx.homeActivityResponsibilities.list(activity.id)[0]
    if (savedHistory === undefined) throw new Error('The proposal was not saved in the Activity history.')
    const savedProposal = savedHistory.proposal
    expect(savedProposal.source).toMatchObject({ sessionId: coordinatorSessionId, eventSeq: expect.any(Number) })
    expect(savedProposal.proposal.target).toEqual({ workspaceId: firstTarget.workspaceId, sessionId: firstTarget.id })
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'activity-coordination-confirmation.png'), fullPage: true })

    await responsibilityDialog.getByRole('button', { name: 'Confirm and send to this Session' }).click()
    await responsibilityDialog.getByRole('status').filter({
      hasText: 'The target Session accepted the prompt. This confirms admission only; no completion or verification is implied.',
    }).first().waitFor({ timeout: 15_000 })
    const dispatchedHistory = scaffold.ctx.homeActivityResponsibilities.get(activity.id, savedProposal.responsibilityId)
    expect(dispatchedHistory?.facts.map(fact => fact.kind)).toEqual(['proposed', 'confirmed', 'dispatch-attempted', 'dispatch-settled'])
    const dispatchAttempt = dispatchedHistory?.facts.find(fact => fact.kind === 'dispatch-attempted')
    if (dispatchAttempt === undefined) throw new Error('The confirmed responsibility lacks its durable dispatch identity.')
    const targetEventsAfterDispatch = await readPersistedEvents(scaffold, firstTarget.id)
    const countDeliveryInputs = (events: Awaited<ReturnType<typeof readPersistedEvents>>): number => events.filter(event =>
      event.type === 'user/message' && event.data.source.kind === 'user' && 'rpcId' in event.data.source
      && String(event.data.source.rpcId) === String(dispatchAttempt.promptRequestId),
    ).length
    expect(countDeliveryInputs(targetEventsAfterDispatch)).toBe(1)
    await responsibilityDialog.getByRole('button', { name: 'Cancel' }).click()

    const existingSessionIds = new Set(scaffold.ctx.workspaceRegistry.list().flatMap(workspace => workspace.sessionIds))
    await page.getByRole('button', { name: 'New session', exact: true }).filter({ hasText: 'New Session' }).click()
    await page.getByRole('treeitem', { selected: true }).filter({ hasText: 'New Session' }).waitFor({ timeout: 10_000 })
    await expect.poll(() => scaffold.ctx.workspaceRegistry.list().flatMap(workspace => workspace.sessionIds)
      .find(sessionId => !existingSessionIds.has(sessionId))).toBeDefined()
    const freshCoordinatorSessionId = scaffold.ctx.workspaceRegistry.list().flatMap(workspace => workspace.sessionIds)
      .find(sessionId => !existingSessionIds.has(sessionId))
    if (freshCoordinatorSessionId === undefined || freshCoordinatorSessionId === coordinatorSessionId) {
      throw new Error('The recovery journey did not create an independent coordinator Session.')
    }
    await scaffold.ctx.homeActivityAssociations.linkSession(activity.id, freshCoordinatorSessionId)

    await input.fill('/coo')
    const reopenSuggestions = page.getByRole('listbox').last()
    await reopenSuggestions.waitFor({ timeout: 10_000 })
    await reopenSuggestions.getByRole('option').filter({ hasText: 'Coordinate Activity' }).click()
    const historyDialog = page.getByRole('dialog', { name: 'Add Activity context to conversation' })
    await historyDialog.waitFor({ timeout: 10_000 })
    await historyDialog.getByLabel('Activity').selectOption(activity.id)
    const responsibility = historyDialog.locator('details').filter({ hasText: savedTask })
    await responsibility.locator('summary').click()
    await responsibility.getByText(savedProposal.responsibilityId, { exact: true }).waitFor({ state: 'visible' })
    await responsibility.getByText('Prompt admission recorded', { exact: true }).waitFor({ state: 'visible' })
    await responsibility.getByRole('button', { name: 'Add this responsibility to this conversation' }).click()
    await responsibility.getByRole('status').filter({ hasText: 'Historical responsibility queued' }).waitFor({ state: 'visible' })
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'activity-coordination-history-reentry.png'), fullPage: true })
    await expect.poll(async () => JSON.stringify(await readPersistedEvents(scaffold, freshCoordinatorSessionId)))
      .toContain('user-selected-activity-responsibility-history')
    const targetEventsAfterReentry = await Promise.all(targetSessions.map(target =>
      readPersistedEvents(scaffold, target.id),
    ))
    expect(countDeliveryInputs(targetEventsAfterReentry[0] ?? [])).toBe(1)
    expect(countDeliveryInputs(targetEventsAfterReentry[1] ?? [])).toBe(0)
  }, 90_000)
})
