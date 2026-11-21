// Keyless rendered coverage for the explicit Home Activity delegation command.
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, vi } from 'vitest'
import { NO_START_CAPABILITIES } from '@deepseek-ai/dsh-subagent'
import type { SubagentResult } from '@deepseek-ai/dsh-subagent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { PROFILE_TEMPLATES } from '@deepseek-ai/dsh-official-bundles'
import { captureActivityDelegationExecutionSelection } from '../../../packages/interaction/command-home-activity/src/execution-selection.ts'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/feedback-command', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.v3.jsonl')
const PENDING_EXPECTED = join(SNAPSHOT_DIR, 'activity-delegation-pending.expected.md')
const REPORTED_EXPECTED = join(SNAPSHOT_DIR, 'activity-delegation-reported.expected.md')
const CODEX_EXPECTED_DIR = fileURLToPath(new URL('./expected/home-activity-delegation/', import.meta.url))
const CODEX_ADMISSION_EXPECTED = join(CODEX_EXPECTED_DIR, 'codex-admission.expected.md')
const CONTINUATION_ADMISSION_EXPECTED = join(CODEX_EXPECTED_DIR, 'continuation-admission.expected.md')
const CODEX_PENDING_EXPECTED = join(CODEX_EXPECTED_DIR, 'codex-pending.expected.md')
const CODEX_REPORTED_EXPECTED = join(CODEX_EXPECTED_DIR, 'codex-reported.expected.md')
const CODEX_UNAVAILABLE_EXPECTED = join(CODEX_EXPECTED_DIR, 'codex-unavailable.expected.md')
const CODEX_UNCONFIRMED_EXPECTED = join(CODEX_EXPECTED_DIR, 'codex-unconfirmed.expected.md')
const SELECTION_CLASSIFICATION_EXPECTED = join(CODEX_EXPECTED_DIR, 'selection-classification.expected.md')
const SCREENSHOT_DIR = fileURLToPath(new URL('../../../.artifacts/ui-review', import.meta.url))
const PENDING_SCREENSHOT = join(SCREENSHOT_DIR, 'home-activity-delegation-pending.png')
const PENDING_SCROLLED_SCREENSHOT = join(SCREENSHOT_DIR, 'home-activity-delegation-pending-scrolled.png')
const REPORTED_SCREENSHOT = join(SCREENSHOT_DIR, 'home-activity-delegation.png')
const CONTINUATION_SCREENSHOT = join(SCREENSHOT_DIR, 'home-activity-continuation.png')
const SELECTION_CLASSIFICATION_SCREENSHOT = join(SCREENSHOT_DIR, 'home-activity-selection-classification.png')
const SELECTION_CLASSIFICATION_SCROLLED_SCREENSHOT = join(SCREENSHOT_DIR, 'home-activity-selection-classification-scrolled.png')
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
      const rendered = page.getByText(marker).last()
      await rendered.waitFor({ timeout: 10_000 })
      await expect.poll(() => input.textContent(), { timeout: 10_000 }).toBe('')
      return await rendered.textContent() ?? ''
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
    expect(admissionText).toContain('DSH profile: scaffold; bundle-set classification: unavailable')
    expect(admissionText).toMatch(/Active Agent preset: standard; composition classification: (?:experimental|unavailable)/u)
    expect(admissionText).toContain('These classifications do not establish sandbox isolation, permission enforcement, or Skill qualification.')
    expect(admissionText).toContain('The child Session is a separate one-shot DSH activation. Its result is not yet available, verified, or accepted.')
    await submit(`/activity open ${activity.id}`, /Activity: Release readiness/u)
    await page.getByRole('button', { name: /Activity: Release readiness/u }).last().click()
    await page.getByText(/Provider report: not recorded/u).last().waitFor({ timeout: 10_000 })

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
    expect(pendingSnapshot).toContain('Delegation state: admitted.')
    expect(pendingSnapshot).toContain('In scope 1: Inspect the release checklist.')
    expect(pendingSnapshot).toContain('Provider report: not recorded; opening the Activity does not wait for the child Session.')
    expect(pendingSnapshot).toContain('User disposition: pending; no review has been recorded.')
    expect(pendingSnapshot).toContain('Verification evidence: none recorded.')
    expect(pendingSnapshot).toContain('DSH profile: scaffold; bundle-set classification: unavailable')
    expect(pendingSnapshot).toContain('Active Agent preset: standard; composition classification:')
    expect(pendingSnapshot).toContain('These classifications do not establish sandbox isolation, permission enforcement, or Skill qualification.')
    await page.setViewportSize({ width: 1024, height: 700 })
    await mkdir(SCREENSHOT_DIR, { recursive: true })
    await page.screenshot({ path: PENDING_SCREENSHOT, fullPage: true })
    const pendingDetails = page.locator('pre').filter({ hasText: 'Activity: Release readiness' }).last()
    const maxScroll = await pendingDetails.evaluate(element => element.scrollHeight - element.clientHeight)
    expect(maxScroll).toBeGreaterThan(0)
    await pendingDetails.hover()
    await page.mouse.wheel(0, maxScroll + 100)
    await expect.poll(() => pendingDetails.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await expect.poll(() => pendingDetails.evaluate(element => element.scrollTop)).toBeGreaterThanOrEqual(maxScroll - 1)
    expect(await pendingDetails.textContent()).toContain('These classifications do not establish sandbox isolation, permission enforcement, or Skill qualification.')
    await page.screenshot({ path: PENDING_SCROLLED_SCREENSHOT, fullPage: true })

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
    const providerReportText = await page.locator('pre').filter({ hasText: 'Provider-reported output:' }).last().textContent() ?? ''
    const delegationId = /Delegation ([0-9a-f-]{36}): provider spawn/u.exec(providerReportText)?.[1]
    if (delegationId === undefined) throw new Error('Rendered Activity report omitted its stable delegation identity.')
    const reportObservedAt = /Provider report observed at: (\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z)/u.exec(providerReportText)?.[1]
    if (reportObservedAt === undefined) throw new Error('Rendered Activity report omitted its observation time.')
    const reportReplacements = [
      ...replacements,
      [delegationId, '{{delegation-id}}'],
      [reportObservedAt, '{{provider-report-observed-at}}'],
    ] as const
    await page.screenshot({ path: REPORTED_SCREENSHOT, fullPage: true })
    const reportedSnapshot = await captureStableAria(
      page, '[class*="centerCol"]', scaffold.workspaceCwd, { replacements: reportReplacements },
    )
    await compareOrRefreshGolden(REPORTED_EXPECTED, reportedSnapshot, MODE)
    expect(reportedSnapshot).toContain('Delegation state: reported.')
    expect(reportedSnapshot).toContain('Provider report: received; DSH has not independently verified it.')
    expect(reportedSnapshot).toContain('Reported outcome: provider-reported completion; not independently verified.')
    expect(reportedSnapshot).toContain('Provider report source: subagent-activation-result.')
    expect(reportedSnapshot).toContain('Provider report observed at: {{provider-report-observed-at}}.')
    expect(reportedSnapshot).toContain('Freshness: unknown; DSH has no freshness check for this saved report, so it may be stale.')
    expect(reportedSnapshot).toContain('Provider-reported output: The checklist contains two unverified migration steps.')
    expect(reportedSnapshot).toContain('DSH profile: scaffold; bundle-set classification: unavailable')
    expect(reportedSnapshot).not.toContain('Status: accepted.')

    const continuationResult = Promise.withResolvers<SubagentResult>()
    start.mockImplementation(async (spec) => {
      if (spec.childId === undefined) throw new Error('A DSH continuation must use a DSH child Session.')
      return {
        childId: spec.childId,
        name: 'activity-continuation',
        result: continuationResult.promise,
        dispose: async () => {},
      }
    })
    const continuationText = await submit(
      `/activity continue ${activity.id} spawn in-scope:1 Record the checklist verification step.`,
      /This is a new explicit provider request, not a resume of prior execution\./u,
    )
    expect(start).toHaveBeenCalledTimes(2)
    const continuationSpec = start.mock.calls[1]?.[0]
    if (continuationSpec === undefined) throw new Error('The DSH continuation provider was not invoked.')
    expect(continuationSpec?.provider).toBe('spawn')
    const continuationPrompt = continuationSpec.prompt[0]
    if (continuationPrompt?.type !== 'text') throw new Error('The DSH continuation prompt was not text.')
    expect(continuationPrompt.text).toContain('Continue the saved Activity objective: "Prepare the next release for review."')
    expect(continuationPrompt.text).toContain('Selected in-scope statement 1: "Inspect the release checklist."')
    expect(continuationText).toContain('Selected in-scope statement 1: "Inspect the release checklist."')
    expect(continuationText).toContain('User-requested bounded next step: "Record the checklist verification step."')
    expect(continuationText).toContain('Activity scope does not restrict child tools or permissions; DSH active runtime policy controls access.')
    const continuationChildSessionId = /Child Session: (\S+)/u.exec(continuationText)?.[1]
    if (continuationChildSessionId === undefined) throw new Error('Rendered continuation admission omitted its DSH child Session identity.')
    const stableContinuationText = continuationText
      .replaceAll(activity.id, '{{activity-id}}')
      .replaceAll(parentSessionId, '{{parent-session-id}}')
      .replaceAll(continuationChildSessionId, '{{continuation-child-session-id}}')
    await compareOrRefreshGolden(CONTINUATION_ADMISSION_EXPECTED, stableContinuationText, MODE)
    await page.getByText(/This is a new explicit provider request, not a resume of prior execution\./u).last().click()
    await page.getByText(/Requested task: Continue the saved Activity objective/u).last().waitFor({ timeout: 10_000 })
    await mkdir(SCREENSHOT_DIR, { recursive: true })
    await page.screenshot({ path: CONTINUATION_SCREENSHOT, fullPage: true })

    continuationResult.resolve({
      stopReason: 'completed',
      output: [{ type: 'text', text: 'The requested verification step is recorded.' }],
    })
    const continuationRequest = scaffold.ctx.homeActivityDelegations.list(activity.id)
      .find(item => item.request.task.includes('User-requested bounded next step:'))
    if (continuationRequest === undefined) throw new Error('The continuation request was not persisted.')
    await vi.waitFor(() => {
      expect(scaffold.ctx.homeActivityDelegations.get(continuationRequest.id)?.status).toBe('reported')
    })
    const reopenedContinuation = await submit(`/activity open ${activity.id}`, /Activity: Release readiness/u)
    expect(reopenedContinuation).toContain('Requested task: Continue the saved Activity objective: "Prepare the next release for review."')
    await page.getByRole('button', { name: /Activity: Release readiness/u }).last().click()
    await page.getByText(/The requested verification step is recorded\./u).last().waitFor({ timeout: 10_000 })
    expect(start).toHaveBeenCalledTimes(2)

    start.mockRestore()
    let codexProviderStarts = 0
    const registerCodexProvider = () => scaffold.ctx.subagents.registerProvider({
      name: 'codex',
      capabilities: NO_START_CAPABILITIES,
      inheritsParentContext: false,
      async start() {
        codexProviderStarts += 1
        throw new Error('simulated transport loss after turn/start')
      },
    })
    const disposeCodexProvider = registerCodexProvider()
    const codexActivity = await scaffold.ctx.homeActivities.create({
      name: 'Codex one-shot',
      objective: 'Receive one bounded external Codex report.',
      boundaries: { inScope: ['Review the checklist.'], outOfScope: ['Do not publish.'] },
    })
    const codexResult = Promise.withResolvers<SubagentResult>()
    const codexStart = vi.spyOn(scaffold.ctx.subagents, 'startActivation').mockImplementation(async (spec) => {
      if (spec.childId !== undefined) throw new Error('Codex must not receive a reserved DSH Session id.')
      return {
        childId: SessionId('codex-provider-run-1'),
        name: 'activity-codex-one-shot',
        result: codexResult.promise,
        dispose: async () => {},
      }
    })
    await submit(
      `/activity delegate ${codexActivity.id} codex Review the release checklist once.`,
      /Delegation admitted: provider codex/u,
    )
    const codexAdmission = await page.getByText(/Delegation admitted: provider codex/u).last().textContent() ?? ''
    await page.getByText(/Delegation admitted: provider codex/u).last().click()
    const codexAdmissionDetails = page.locator('pre').filter({ hasText: 'Codex adapter run id' }).last()
    await codexAdmissionDetails.waitFor({ state: 'visible', timeout: 10_000 })
    expect(codexAdmission).toContain('Runtime profile and preset: unavailable (the native Codex provider does not expose DSH composition).')
    const codexDelegation = scaffold.ctx.homeActivityDelegations.list(codexActivity.id)[0]
    if (codexDelegation === undefined) throw new Error('The Codex command did not persist its stable delegation identity.')
    const codexDelegationId = codexDelegation.id
    const codexReplacements = [
      [codexActivity.id, '{{activity-id}}'],
      [parentSessionId, '{{parent-session-id}}'],
      ['codex-provider-run-1', '{{provider-run-id}}'],
      [codexDelegationId, '{{delegation-id}}'],
      [codexActivity.createdAt, '{{activity-created-at}}'],
    ] as const
    expect(codexAdmission).toContain('Codex adapter run id (not a DSH Session or native Codex conversation id): codex-provider-run-1')
    expect(codexAdmission).not.toContain('Child Session: codex-provider-run-1')
    expect(codexAdmission).toContain('Activity does not expose transcript inspection, continuation, resume, or rollback.')
    expect(codexStart.mock.calls[0]?.[0]?.childId).toBeUndefined()
    await mkdir(CODEX_EXPECTED_DIR, { recursive: true })
    await compareOrRefreshGolden(
      CODEX_ADMISSION_EXPECTED,
      await captureStableAria(page, '[class*="centerCol"] pre:has-text("Codex adapter run id")', scaffold.workspaceCwd,
        { replacements: codexReplacements }),
      MODE,
    )

    await submit(`/activity open ${codexActivity.id}`, /Activity: Codex one-shot/u)
    await page.getByRole('button', { name: /Activity: Codex one-shot/u }).last().click()
    await page.getByText(/Codex outcome is pending/u).last().waitFor({ timeout: 10_000 })
    await compareOrRefreshGolden(
      CODEX_PENDING_EXPECTED,
      await captureStableAria(page, '[class*="centerCol"] pre:has-text("Codex outcome is pending")', scaffold.workspaceCwd,
        { replacements: codexReplacements }),
      MODE,
    )
    codexResult.resolve({
      stopReason: 'completed',
      output: [{ type: 'text', text: 'The checklist needs one migration step.' }],
    })
    await vi.waitFor(() => {
      expect(scaffold.ctx.homeActivityDelegations.list(codexActivity.id)[0]?.status).toBe('reported')
    })
    await submit(`/activity open ${codexActivity.id}`, /Activity: Codex one-shot/u)
    await page.getByRole('button', { name: /Activity: Codex one-shot/u }).last().click()
    await page.getByText(/Codex-reported output: The checklist needs one migration step\./u)
      .last().waitFor({ timeout: 10_000 })
    const codexReport = await page.locator('pre').filter({ hasText: 'Codex-reported output:' }).last().textContent() ?? ''
    expect(codexReport).toContain('Runtime profile and preset: unavailable (the native Codex provider does not expose DSH composition).')
    expect(codexReport).toContain('Delegation state: reported.')
    expect(codexReport).toContain('Provider report: received; DSH has not independently verified it.')
    expect(codexReport).toContain('Reported outcome: provider-reported completion; not independently verified.')
    expect(codexReport).toContain('Provider report source: subagent-activation-result.')
    expect(codexReport).toContain('Freshness: unknown; DSH has no freshness check for this saved report, so it may be stale.')
    const codexReportObservedAt = /Provider report observed at: (\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z)/u.exec(codexReport)?.[1]
    if (codexReportObservedAt === undefined) throw new Error('Rendered Codex report omitted its observation time.')
    const codexReportReplacements = [
      ...codexReplacements,
      [codexReportObservedAt, '{{provider-report-observed-at}}'],
    ] as const
    expect(codexReport).toContain('User disposition: pending; no review has been recorded.')
    expect(codexReport).toContain('Verification evidence: none recorded.')
    expect(codexReport).not.toContain('Child Session: codex-provider-run-1')
    await compareOrRefreshGolden(
      CODEX_REPORTED_EXPECTED,
      await captureStableAria(page, '[class*="centerCol"] pre:has-text("Codex-reported output:")', scaffold.workspaceCwd,
        { replacements: codexReportReplacements }),
      MODE,
    )

    codexStart.mockRestore()
    disposeCodexProvider()
    const unavailableActivity = await scaffold.ctx.homeActivities.create({
      name: 'Unavailable Codex',
      objective: 'Show the unavailable provider state.',
      boundaries: { inScope: ['Report that Codex is unavailable.'], outOfScope: ['Start another provider.'] },
    })
    expect(scaffold.ctx.subagents.getProvider('codex')).toBeUndefined()
    const codexUnavailable = await submit(
      `/activity delegate ${unavailableActivity.id} codex Review the release checklist.`,
      /The Codex provider is unavailable/u,
    )
    expect(codexUnavailable).toContain('DSH did not attempt activation.')
    const unavailableRecord = scaffold.ctx.homeActivityDelegations.list(unavailableActivity.id)[0]
    expect(unavailableRecord?.status).toBe('not-admitted')
    if (unavailableRecord === undefined) throw new Error('Unavailable-provider state omitted its saved request identity.')
    await compareOrRefreshGolden(
      CODEX_UNAVAILABLE_EXPECTED,
      await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd, {
        replacements: [
          ...replacements,
          [delegationId, '{{spawn-delegation-id}}'],
          ...codexReplacements,
          [unavailableActivity.id, '{{unavailable-activity-id}}'],
          [unavailableRecord.id, '{{unavailable-delegation-id}}'],
        ],
      }),
      MODE,
    )

    registerCodexProvider()
    const uncertainActivity = await scaffold.ctx.homeActivities.create({
      name: 'Codex startup uncertainty',
      objective: 'Keep an ambiguous external start from being retried.',
      boundaries: { inScope: ['Record whether startup is confirmed.'], outOfScope: ['Retry external work.'] },
    })
    const uncertainResult = await submit(
      `/activity delegate ${uncertainActivity.id} codex Review the release checklist once.`,
      /DSH could not confirm whether Codex started/u,
    )
    expect(uncertainResult).toContain('It may have started; do not repeat this task unless you have independently confirmed it did not start.')
    await page.getByText(/DSH could not confirm whether Codex started/u).last().click()
    const uncertainRecord = scaffold.ctx.homeActivityDelegations.list(uncertainActivity.id)[0]
    expect(uncertainRecord).toMatchObject({
      status: 'unconfirmed',
      request: { provider: 'codex' },
      uncertainty: { reason: 'codex-start-outcome-unknown' },
    })
    expect(uncertainRecord?.admission).toBeUndefined()
    await submit(`/activity open ${uncertainActivity.id}`, /Activity: Codex startup uncertainty/u)
    await page.getByRole('button', { name: /Activity: Codex startup uncertainty/u }).last().click()
    await page.getByText(/do not repeat the task unless you independently confirm it did not start/u)
      .last().waitFor({ timeout: 10_000 })
    const uncertaintyText = await page.locator('pre')
      .filter({ hasText: 'Outcome: unknown; no provider result was recorded.' }).last().textContent() ?? ''
    const uncertaintyObservedAt = /Uncertainty observed at: (\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z)/u.exec(uncertaintyText)?.[1]
    if (uncertaintyObservedAt === undefined) throw new Error('Rendered uncertainty omitted its observation time.')
    expect(uncertaintyText).toContain('Outcome: unknown; no provider result was recorded.')
    expect(uncertaintyText).toContain('Uncertainty source: native Codex start response.')
    expect(uncertaintyText).toContain(`Uncertainty observed at: ${uncertaintyObservedAt}.`)
    expect(codexProviderStarts).toBe(1)
    await compareOrRefreshGolden(
      CODEX_UNCONFIRMED_EXPECTED,
      await captureStableAria(page, '[class*="centerCol"] pre:has-text("do not repeat the task unless you independently confirm it did not start")',
        scaffold.workspaceCwd, {
          replacements: [
            [uncertainActivity.id, '{{activity-id}}'],
            [parentSessionId, '{{parent-session-id}}'],
            [uncertainActivity.createdAt, '{{activity-created-at}}'],
            [uncertaintyObservedAt, '{{uncertainty-observed-at}}'],
            ...(uncertainRecord === undefined ? [] : [[uncertainRecord.id, '{{delegation-id}}'] as const]),
          ],
        }),
      MODE,
    )
    expect(codexProviderStarts).toBe(1)

    // This keyless renderer fixture records classification metadata without admitting or starting a provider.
    const classificationActivity = await scaffold.ctx.homeActivities.create({
      name: 'Selection classification review',
      objective: 'Show the recorded DSH profile and preset maturity labels.',
      boundaries: { inScope: ['Inspect the displayed configuration facts.'], outOfScope: ['Start delegated work.'] },
    })
    const presets: NonNullable<Parameters<typeof captureActivityDelegationExecutionSelection>[1]> = {
      composedPreset: () => 'session-query-review',
      inspectCompositions: () => [{
        id: 'session-query-review',
        modules: [{ moduleName: '@deepseek-ai/dsh-tool-session-query', useHostBase: true }],
        leakedServices: [],
      }],
    }
    const executionSelection = captureActivityDelegationExecutionSelection({
      name: 'web', startedBundles: PROFILE_TEMPLATES.web!.bundles,
    }, presets, scaffold.ctx)
    expect(executionSelection).toMatchObject({
      profile: { name: 'web', classification: 'stable', classificationSource: 'shipped-profile-template' },
      preset: {
        id: 'session-query-review', activeModules: ['@deepseek-ai/dsh-tool-session-query'],
        classification: 'experimental', classificationSource: 'experimental-package-metadata',
      },
    })
    const classificationRequest = await scaffold.ctx.homeActivityDelegations.createRequest({
      activityId: classificationActivity.id,
      provider: 'spawn',
      task: 'Inspect the displayed configuration facts without starting work.',
      parentSessionId,
      executionSelection,
    })
    expect(classificationRequest.status).toBe('requested')
    expect(classificationRequest.admission).toBeUndefined()
    const activation = vi.spyOn(scaffold.ctx.subagents, 'startActivation')
    await submit(`/activity open ${classificationActivity.id}`, /Activity: Selection classification review/u)
    await page.getByRole('button', { name: /Activity: Selection classification review/u }).last().click()
    const classificationDetails = page.locator('pre').filter({
      hasText: 'DSH profile: web; bundle-set classification: stable',
    }).last()
    await classificationDetails.waitFor({ state: 'visible', timeout: 10_000 })
    const classificationText = await classificationDetails.textContent() ?? ''
    expect(classificationText).toContain('Profile bundles used at launch: @deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app')
    expect(classificationText).toContain('The stable classification matches the exact ordered bundle list of a shipped profile template; profile patches and overlays are not classified.')
    expect(classificationText).toContain('Active Agent preset: session-query-review; composition classification: experimental')
    expect(classificationText).toContain('Active preset modules: @deepseek-ai/dsh-tool-session-query')
    expect(classificationText).toContain('The experimental classification comes from an explicitly experimental active module.')
    expect(classificationText).toContain('These classifications do not establish sandbox isolation, permission enforcement, or Skill qualification.')
    expect(classificationText).toContain('Status: request saved; provider admission has not been confirmed.')
    expect(activation).not.toHaveBeenCalled()
    await page.setViewportSize({ width: 1024, height: 700 })
    await mkdir(SCREENSHOT_DIR, { recursive: true })
    await page.screenshot({ path: SELECTION_CLASSIFICATION_SCREENSHOT, fullPage: true })
    const classificationMaxScroll = await classificationDetails.evaluate(element => element.scrollHeight - element.clientHeight)
    expect(classificationMaxScroll).toBeGreaterThan(0)
    await classificationDetails.hover()
    await page.mouse.wheel(0, classificationMaxScroll + 100)
    await expect.poll(() => classificationDetails.evaluate(element => element.scrollTop))
      .toBeGreaterThanOrEqual(classificationMaxScroll - 1)
    const caveatInViewport = await classificationDetails.evaluate((element) => {
      const text = 'These classifications do not establish sandbox isolation, permission enforcement, or Skill qualification.'
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()
      while (node !== null) {
        const start = node.textContent?.indexOf(text) ?? -1
        if (start >= 0) {
          const range = document.createRange()
          range.setStart(node, start)
          range.setEnd(node, start + text.length)
          const rect = range.getBoundingClientRect()
          return rect.top >= 0 && rect.bottom <= window.innerHeight
        }
        node = walker.nextNode()
      }
      return false
    })
    expect(caveatInViewport).toBe(true)
    await mkdir(CODEX_EXPECTED_DIR, { recursive: true })
    await page.screenshot({ path: SELECTION_CLASSIFICATION_SCROLLED_SCREENSHOT, fullPage: true })
    const classificationSnapshot = await captureStableAria(
      page, '[class*="centerCol"] pre:has-text("DSH profile: web; bundle-set classification: stable")',
      scaffold.workspaceCwd, { replacements: [
        [classificationActivity.id, '{{activity-id}}'],
        [parentSessionId, '{{parent-session-id}}'],
        [classificationRequest.id, '{{delegation-id}}'],
        [classificationActivity.createdAt, '{{activity-created-at}}'],
      ] },
    )
    await compareOrRefreshGolden(SELECTION_CLASSIFICATION_EXPECTED, classificationSnapshot, MODE)
    activation.mockRestore()
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)
})
