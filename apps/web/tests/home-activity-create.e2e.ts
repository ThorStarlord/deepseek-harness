// Keyless rendered evidence for the human /activity JSON creation interaction.
import { mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
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
const ERROR_EXPECTED = join(SNAPSHOT_DIR, 'activity-create-error.expected.md')
const ASSOCIATIONS_EXPECTED = join(SNAPSHOT_DIR, 'activity-associations.expected.md')
const ASSOCIATIONS_ERROR_EXPECTED = join(SNAPSHOT_DIR, 'activity-associations-error.expected.md')
const SCREENSHOT_DIR = fileURLToPath(new URL('../../../.artifacts/ui-review', import.meta.url))
const INPUT_SCREENSHOT = join(SCREENSHOT_DIR, 'home-activity-create-input.png')
const SAVED_SCREENSHOT = join(SCREENSHOT_DIR, 'home-activity-create-saved.png')
const ERROR_SCREENSHOT = join(SCREENSHOT_DIR, 'home-activity-create-error.png')
const ASSOCIATIONS_SCREENSHOT = join(SCREENSHOT_DIR, 'home-activity-associations.png')
const ASSOCIATIONS_BOTTOM_SCREENSHOT = join(SCREENSHOT_DIR, 'home-activity-associations-bottom.png')
const ASSOCIATIONS_ERROR_SCREENSHOT = join(SCREENSHOT_DIR, 'home-activity-associations-error.png')
const MODE = webSnapshotMode()
const PROMPT = 'Reply with the single word LIGHTHOUSE and stop.'

async function hostRpc<T>(scaffold: WebScaffold, endpoint: string, args: Readonly<Record<string, unknown>>): Promise<T> {
  const response = await scaffold.hostFetch(`/api/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request', rpcId: `home-activity-${randomUUID()}`, method: endpoint, payload: { args },
    }),
  })
  if (!response.ok) throw new Error(`${endpoint} failed over HTTP ${response.status}: ${await response.text()}`)
  const result = (await response.json() as {
    result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
  }).result
  if (!result.ok) throw new Error(`${endpoint} failed: ${result.error.code}: ${result.error.message}`)
  return result.value
}

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

    await input.fill('/activity create {')
    await input.press('Enter')
    await page.getByText(/Activity details must be valid JSON\./).waitFor({ timeout: 10_000 })
    await expect.poll(() => input.textContent(), { timeout: 10_000 }).toBe('')
    await expect.poll(() => page.getByRole('button', { name: 'Add files or run commands' }).isEnabled(), { timeout: 10_000 }).toBe(true)
    await page.screenshot({ path: ERROR_SCREENSHOT, fullPage: true })
    const errorSnapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(ERROR_EXPECTED, errorSnapshot, MODE)

    const activityText = await page.getByText(/Activity created: Release readiness/).last().textContent()
    const activityId = /ID: ([0-9a-f-]{36})/u.exec(activityText ?? '')?.[1]
    if (activityId === undefined) throw new Error('Rendered Activity creation did not include its stable id')
    const workspacePath = join(scaffold.workspaceCwd, 'activity-workspace-two')
    await mkdir(workspacePath, { recursive: true })
    const { workspace: secondWorkspace } = await hostRpc<{ workspace: { workspaceId: string; path: string } }>(
      scaffold, 'workspace/create', { request: { path: workspacePath } },
    )
    const { sessionId: secondSessionId } = await hostRpc<{ sessionId: string }>(
      scaffold, 'session/create', { request: { workspaceId: secondWorkspace.workspaceId } },
    )

    const submit = async (line: string, marker: RegExp) => {
      await input.fill(line)
      await input.press('Enter')
      await page.getByText(marker).last().waitFor({ timeout: 10_000 })
      await expect.poll(() => input.textContent(), { timeout: 10_000 }).toBe('')
    }
    await submit('/activity workspaces', /Available Workspaces/u)
    const workspaceText = await page.getByText(/Available Workspaces/u).last().textContent()
    const workspaceIds = [...(workspaceText ?? '').matchAll(/Workspace: .*? — ([0-9a-f-]{36})/gu)].map(match => match[1])
    expect(workspaceIds).toHaveLength(2)
    if (workspaceIds[0] === undefined || workspaceIds[1] === undefined) throw new Error('Workspace listing did not expose two selectable identities')
    const workspacePaths = [...(workspaceText ?? '').matchAll(/Directory: ([^\r\n]+?)(?:\s+Directory status:|$)/gu)]
      .map(match => match[1]?.trim())
      .filter((path): path is string => path !== undefined)
    const linkedWorkspacePath = workspacePaths.find(path => path.endsWith('activity-workspace-two'))
    const coordinatingWorkspacePath = workspacePaths.find(path => path !== linkedWorkspacePath)
    if (linkedWorkspacePath === undefined || coordinatingWorkspacePath === undefined) {
      throw new Error('Workspace listing did not expose stable directory paths')
    }
    const escapedAriaPath = (path: string): string => path.replaceAll('\\', '\\\\')
    const stablePathReplacements = {
      replacements: [
        [coordinatingWorkspacePath, '{{coordinating-workspace-directory}}'],
        [escapedAriaPath(coordinatingWorkspacePath), '{{coordinating-workspace-directory}}'],
        [linkedWorkspacePath, '{{linked-workspace-directory}}'],
        [escapedAriaPath(linkedWorkspacePath), '{{linked-workspace-directory}}'],
      ] as const,
    }
    await submit('/activity sessions', /Available DSH Sessions/u)
    const sessionsText = await page.getByText(/Available DSH Sessions/u).last().textContent()
    const sessionIds = [...(sessionsText ?? '').matchAll(/DSH Session: (\S+)/gu)].map(match => match[1])
    expect(sessionIds).toContain(secondSessionId)
    const firstSessionId = sessionIds.find(id => id !== secondSessionId)
    if (firstSessionId === undefined) throw new Error('Session listing did not expose the coordinating Session')

    const unknownWorkspaceId = '00000000-0000-4000-8000-000000000099'
    await submit(
      '/activity link ' + activityId + ' workspace ' + unknownWorkspaceId,
      /No Workspace has id .*Run \/activity workspaces/u,
    )
    await submit('/activity unsupported', /Usage: \/activity .*link .*context-id/u)
    await page.screenshot({ path: ASSOCIATIONS_ERROR_SCREENSHOT, fullPage: true })
    const associationErrorSnapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd, stablePathReplacements)
    await compareOrRefreshGolden(ASSOCIATIONS_ERROR_EXPECTED, associationErrorSnapshot, MODE)
    expect(associationErrorSnapshot).toContain('Run /activity workspaces')
    expect(associationErrorSnapshot).toContain('Usage: /activity')
    expect(associationErrorSnapshot).toContain('link <activity-id> workspace|session <context-id>')
    expect(associationErrorSnapshot).not.toContain('dsh-web-e2e-ws-')
    for (const workspaceId of [workspaceIds[0], workspaceIds[1]]) {
      await submit(`/activity link ${activityId} workspace ${workspaceId}`, /records a reference only/u)
    }
    for (const sessionId of [firstSessionId, secondSessionId]) {
      await submit(`/activity link ${activityId} session ${sessionId}`, /records a reference only/u)
    }
    await submit(`/activity open ${activityId}`, /Activity: Release readiness/u)
    const activityResult = page.getByRole('button', { name: /Activity: Release readiness/u }).last()
    await activityResult.click()
    await page.screenshot({ path: ASSOCIATIONS_SCREENSHOT, fullPage: true })
    const activityOutput = page.locator('pre').filter({ hasText: 'DSH Session links (selected separately' }).last()
    await activityOutput.evaluate((element) => {
      element.scrollLeft = 0
      element.scrollTop = element.scrollHeight
    })
    await expect.poll(async () => {
      const distance = await activityOutput.evaluate(element =>
        element.scrollHeight - element.clientHeight - element.scrollTop,
      )
      return Math.abs(distance) <= 1
    }, { timeout: 10_000 }).toBe(true)
    expect(await page.getByText(`DSH Session: ${firstSessionId}`, { exact: false }).last().isVisible()).toBe(true)
    expect(await page.getByText(`DSH Session: ${secondSessionId}`, { exact: false }).last().isVisible()).toBe(true)
    expect(await page.getByText(/these links do not assign Sessions to Workspaces/u).last().isVisible()).toBe(true)
    await page.screenshot({ path: ASSOCIATIONS_BOTTOM_SCREENSHOT, fullPage: true })
    const associationSnapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd, stablePathReplacements)

    await compareOrRefreshGolden(ASSOCIATIONS_EXPECTED, associationSnapshot, MODE)
    expect(associationSnapshot).toContain('Workspace links (selected separately)')
    expect(associationSnapshot).toContain('DSH Session links (selected separately')
    expect(associationSnapshot).toContain('these links do not assign Sessions to Workspaces')
    expect(associationSnapshot).not.toContain('dsh-web-e2e-ws-')

    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)
})
