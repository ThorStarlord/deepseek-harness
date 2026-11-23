// Keyless Web coverage for reopening a saved Activity Strategic Brief.
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
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

describe.skipIf(MODE === 'record')('web e2e: Activity strategic evidence reentry', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let workspaceRoot: string | undefined

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, replayChildFixtures: [FIXTURE], paceMs: 5, compareReplaySession: false })
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

  it('renders and recovers a source-linked reconsideration in another Session without starting work', async () => {
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
    const submit = async (line: string, marker: RegExp, target = input) => {
      await target.fill(line)
      await target.press('Enter')
      const output = page.getByText(marker).last()
      await output.waitFor({ timeout: 10_000 })
      await expect.poll(() => target.textContent(), { timeout: 10_000 }).toBe('')
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

    const deliberation = await scaffold.ctx.homeActivityStrategicDeliberations.record({
      activityId: activity.id,
      originSessionId: 'later-deterministic-session',
      requestId: '00000000-0000-4000-8000-000000000032',
      sourceEpisodeId: episode.id,
      sourceEpisodeRevision: episode.revision,
      decisionQuestion: 'Which bounded next responsibility is warranted by this historical evidence?',
      outcome: 'next-responsibility',
      disposition: 'adapt',
      proposedResponsibility: 'Use the existing Sensemaking Skills for one explicit assessment and record any retrieval gap.',
      scope: 'within-activity',
      rationale: 'The prior recommendation remains useful as a hypothesis, but the source observations are historical and do not establish current provider behavior. Reuse the existing method for one bounded assessment, then reconsider only if its source-attributed result identifies a material retrieval gap.',
      evidenceUses: [
        { evidenceId: 'E1', treatment: 'supports', rationale: 'The saved Activity and brief provide a durable point of reentry.' },
        { evidenceId: 'E2', treatment: 'limits', rationale: 'The Skill describes an analysis method but does not prove the current runtime can retrieve it successfully.' },
      ],
      uncertaintyReviews: [
        { uncertaintyId: 'U1', treatment: 'remains-open', rationale: 'No live strategic assessment or current source read occurred in this deterministic recovery scenario.' },
      ],
      newUncertainties: [
        { id: 'N1', statement: 'The currently installed DSH profile may expose a different Skill set than the historical brief recorded.', evidenceIds: ['E2'] },
        { id: 'N2', statement: 'A later real assessment may identify decision-time retrieval friction that this saved record cannot establish.', evidenceIds: ['E1', 'E2'] },
      ],
      skillDigests: [
        { name: 'using-sensemaking', provider: 'deterministic-web-fixture', digest: '3'.repeat(64) },
        { name: 'strategic-repository-analysis', provider: 'deterministic-web-fixture', digest: '4'.repeat(64) },
      ],
      requestedAt: '2026-11-22T10:01:00.000Z',
    })

    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    const [sessionResponse] = await Promise.all([
      page.waitForResponse('**/api/session/create'),
      page.getByRole('button', { name: 'New session', exact: true }).last().click(),
    ])
    const sessionPayload = await sessionResponse.json() as {
      readonly result: { readonly ok: true; readonly value: { readonly sessionId: string } }
    }
    const freshSessionId = sessionPayload.result.value.sessionId
    expect(freshSessionId).not.toBe(String(parentSessionId))
    const freshInput = page.locator(`[data-conversation-session="${freshSessionId}"] [data-composer-input]`).first()
    await freshInput.waitFor({ state: 'visible', timeout: 10_000 })
    const freshTurnSettled = scaffold.whenTurnSettled()
    await freshInput.fill(PROMPT)
    await freshInput.press('Enter')
    await freshTurnSettled
    await page.getByText('LIGHTHOUSE', { exact: true }).last().waitFor({ timeout: 15_000 })
    const renderedResult = await submit(
      `/activity decision ${activity.id} ${deliberation.revision}`,
      /Activity Strategic Deliberation 1/u,
      freshInput,
    )
    expect(renderedResult).toContain(`Source brief ${episode.id}, revision ${episode.revision}`)
    const recoveredCommand = page.getByRole('button', { name: /Activity: Sensemaking workflow integration/u }).last()
    await recoveredCommand.waitFor({ timeout: 15_000 })
    await recoveredCommand.click()
    const renderedDecision = page.locator('pre').filter({ hasText: 'Activity Strategic Deliberation 1' }).last()
    await renderedDecision.waitFor({ state: 'visible', timeout: 10_000 })
    const recoveredText = await renderedDecision.textContent() ?? ''
    expect(recoveredText).toContain(`Source brief ${episode.id}, revision ${episode.revision}`)
    expect(recoveredText).toContain('Historical evidence considered:')
    expect(recoveredText).toContain('E2 (limits)')
    expect(recoveredText).toContain('Prior uncertainties:')
    expect(recoveredText).toContain('New uncertainties:')
    expect(recoveredText).toContain('Current repositories, source files, and changed observations were not checked.')
    const scrollCue = page.locator('[class*="scrollCue"]')
    await expect.poll(() => scrollCue.isVisible()).toBe(true)
    expect(await renderedDecision.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
    expect(await renderedDecision.getAttribute('tabindex')).toBe('0')
    expect(await renderedDecision.getAttribute('aria-label')).toBe('Scroll for more output')
    await renderedDecision.evaluate((element) => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => scrollCue.isVisible()).toBe(false)
    await renderedDecision.evaluate((element) => { element.scrollTop = 0 })
    await expect.poll(() => scrollCue.isVisible()).toBe(true)
    expect(scaffold.ctx.homeActivityStrategicEpisodes.list(activity.id)).toEqual([episode])
    expect(scaffold.ctx.homeActivityStrategicDeliberations.list(activity.id)).toEqual([deliberation])
    expect(startActivation).not.toHaveBeenCalled()
  }, 60_000)
})
