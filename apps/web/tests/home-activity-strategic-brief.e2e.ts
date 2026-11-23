// Keyless Web coverage for reopening a saved Activity Strategic Brief.
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, vi } from 'vitest'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/feedback-command/session.v4.jsonl', import.meta.url))
const EXPECTED = fileURLToPath(new URL('./snapshots/home-activity-strategic-brief/brief.expected.md', import.meta.url))
const MODE = webSnapshotMode()
const PROMPT = 'Reply with the single word LIGHTHOUSE and stop.'
const OBSERVED_AT_START = '2026-11-22T10:00:00.000Z'
const OBSERVED_AT_END = '2026-11-22T10:00:10.000Z'

async function hostRpc<T>(scaffold: WebScaffold, endpoint: string, args: Readonly<Record<string, unknown>>): Promise<T> {
  const response = await scaffold.hostFetch(`/api/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request', rpcId: `home-activity-strategic-brief-${randomUUID()}`,
      method: endpoint, payload: { args },
    }),
  })
  if (!response.ok) throw new Error(`${endpoint} failed over HTTP ${response.status}`)
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

describe.skipIf(MODE === 'record')('web e2e: Home Activity Strategic Brief recovery', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let workspaceRoot: string | undefined

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, paceMs: 5, compareReplaySession: false })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    try {
      await browser?.close()
      await scaffold?.close()
    } finally {
      if (workspaceRoot !== undefined) await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('renders a saved source-attributed brief and recovers it in another Session without starting work', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-home-activity-strategic-brief'))
    const input = page.locator('[data-composer-input]').first()
    const settled = scaffold.whenTurnSettled()
    await input.fill(PROMPT)
    await input.press('Enter')
    const parentSessionId = await settled
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor({ timeout: 15_000 })

    workspaceRoot = await mkdtemp(join(tmpdir(), 'dsh-home-activity-strategic-brief-'))
    const harnessRoot = join(workspaceRoot, 'deepseek-harness')
    const sensemakingRoot = join(workspaceRoot, 'sensemaking-skills')
    await mkdir(harnessRoot)
    await mkdir(sensemakingRoot)
    const harnessWorkspace = await scaffold.ctx.workspaceRegistry.create(harnessRoot, 'DeepSeek Harness')
    const sensemakingWorkspace = await scaffold.ctx.workspaceRegistry.create(sensemakingRoot, 'Sensemaking Skills')

    const activity = await scaffold.ctx.homeActivities.create({
      name: 'Sensemaking workflow integration',
      objective: 'Improve the practical integration of Sensemaking capabilities into DeepSeek Harness development workflows.',
      boundaries: {
        inScope: ['Assess the selected DSH and Sensemaking repositories.'],
        outOfScope: ['Do not implement recommendations or modify either repository.'],
      },
    })
    const revisionA = 'a'.repeat(40)
    const revisionB = 'b'.repeat(40)
    // Deterministic fixture data exercises display/recovery only; no provider or source assessment runs here.
    const episode = await scaffold.ctx.homeActivityStrategicEpisodes.record({
      activityId: activity.id,
      originSessionId: String(parentSessionId),
      requestId: '00000000-0000-4000-8000-000000000031',
      skillDigests: [
        { name: 'using-sensemaking', provider: 'deterministic-web-fixture', digest: '1'.repeat(64) },
        { name: 'multi-repository-strategic-analysis', provider: 'deterministic-web-fixture', digest: '2'.repeat(64) },
      ],
      requestedAt: '2026-11-22T10:00:30.000Z',
      status: 'complete',
      repositories: [
        {
          workspaceId: harnessWorkspace.id, title: harnessWorkspace.title, status: 'observed', revision: revisionA,
          workingTree: 'clean', sourceChanged: false, observedAtStart: OBSERVED_AT_START, observedAtEnd: OBSERVED_AT_END,
        },
        {
          workspaceId: sensemakingWorkspace.id, title: sensemakingWorkspace.title, status: 'observed', revision: revisionB,
          workingTree: 'clean', sourceChanged: false, observedAtStart: OBSERVED_AT_START, observedAtEnd: OBSERVED_AT_END,
        },
      ],
      evidence: [
        {
          id: 'E1', workspaceId: harnessWorkspace.id, revision: revisionA, path: 'packages/home/activity/README.md',
          lineStart: 12, note: 'Activity intent is durable and separate from Session lifecycle.',
        },
        {
          id: 'E2', workspaceId: sensemakingWorkspace.id, revision: revisionB,
          path: 'skills/multi-repository-strategic-analysis/SKILL.md', lineStart: 20,
          note: 'The existing Skill defines multi-repository analysis steps.',
        },
      ],
      findings: [
        {
          kind: 'source-observation', category: 'capability',
          statement: 'The current Skill-based interface can guide a source-grounded assessment.', evidenceIds: ['E1', 'E2'],
        },
        {
          kind: 'hypothesis', category: 'opportunity',
          statement: 'A native adapter may improve retrieval only if repeated use exposes a concrete gap.', evidenceIds: ['E1', 'E2'],
        },
      ],
      alternatives: [
        {
          name: 'Reuse existing Skill interfaces', consequence: 'Avoid a second strategic controller.',
          evidenceIds: ['E1', 'E2'], uncertaintyIds: ['U1'],
        },
        {
          name: 'Build a native retrieval adapter', consequence: 'Add maintenance cost before a retrieval gap is established.',
          evidenceIds: ['E1', 'E2'], uncertaintyIds: ['U1'],
        },
      ],
      uncertainties: [
        { id: 'U1', statement: 'Repeated decision-time retrieval may reveal a need for a native adapter.', evidenceIds: ['E1', 'E2'] },
      ],
      recommendation: {
        disposition: 'INVESTIGATE',
        responsibility: 'Use the existing Skill interface in a real DSH assessment and record any retrieval gap.',
        rationale: 'The current sources support a bounded real use before adding retrieval infrastructure.',
        scope: 'within-activity', evidenceIds: ['E1', 'E2'], uncertaintyIds: ['U1'],
      },
    })
    expect(episode.revision).toBe(1)

    const startActivation = vi.spyOn(scaffold.ctx.subagents, 'startActivation')
    const submit = async (line: string, marker: RegExp) => {
      await input.fill(line)
      await input.press('Enter')
      const output = page.getByText(marker).last()
      await output.waitFor({ timeout: 10_000 })
      await expect.poll(() => input.textContent(), { timeout: 10_000 }).toBe('')
      return await output.textContent() ?? ''
    }

    await submit(`/activity open ${activity.id}`, /Activity: Sensemaking workflow integration/u)
    await page.getByRole('button', { name: /Activity: Sensemaking workflow integration/u }).last().click()
    const renderedBrief = page.locator('pre').filter({ hasText: 'Latest Activity Strategic Brief' }).last()
    await renderedBrief.waitFor({ state: 'visible', timeout: 10_000 })
    const rendered = await renderedBrief.textContent() ?? ''
    expect(rendered).toContain('not independently verified or user-accepted')
    expect(rendered).toContain('Recommendation: INVESTIGATE')
    expect(rendered).toContain(`DeepSeek Harness (${harnessWorkspace.id}) at ${revisionA}`)
    expect(rendered).toContain(`Sensemaking Skills (${sensemakingWorkspace.id}) at ${revisionB}`)
    expect(rendered).toContain('current repository state has not been checked since then')
    expect(rendered).toContain('Opening an Activity shows stored episodes only. It does not re-read repositories or start another assessment.')
    expect(startActivation).not.toHaveBeenCalled()

    const snapshot = await captureStableAria(page, 'pre:has-text("Latest Activity Strategic Brief")', scaffold.workspaceCwd, {
      replacements: [
        [activity.id, '{{activity-id}}'],
        [activity.createdAt, '{{activity-created-at}}'],
        [String(parentSessionId), '{{origin-session-id}}'],
        [harnessWorkspace.id, '{{workspace-id-harness}}'],
        [sensemakingWorkspace.id, '{{workspace-id-sensemaking}}'],
        [episode.recordedAt, '{{recorded-at}}'],
      ],
    })
    await mkdir(new URL('./snapshots/home-activity-strategic-brief/', import.meta.url), { recursive: true })
    await compareOrRefreshGolden(EXPECTED, snapshot, MODE)

    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    const freshSession = await hostRpc<{ sessionId: string }>(
      scaffold, 'session/create', { request: { workspaceId: harnessWorkspace.id } },
    )
    expect(freshSession.sessionId).not.toBe(parentSessionId)
    const reopened = await executeCommand(scaffold, freshSession.sessionId, `/activity open ${activity.id}`)
    expect(reopened.kind).toBe('success')
    expect(reopened.text).toContain('Latest Activity Strategic Brief')
    expect(reopened.text).toContain('Recommendation: INVESTIGATE')
    expect(reopened.text).toContain(`Assessment 1: complete; recorded ${episode.recordedAt}`)
    expect(scaffold.ctx.homeActivityStrategicEpisodes.list(activity.id)).toEqual([episode])
    expect(startActivation).not.toHaveBeenCalled()
  }, 60_000)
})
