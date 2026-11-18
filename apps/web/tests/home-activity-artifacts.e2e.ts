// Keyless rendered coverage for pointers across independent Activity Workspace contexts.
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, vi } from 'vitest'
import type { SubagentResult } from '@deepseek-ai/dsh-subagent'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/feedback-command', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.v3.jsonl')
const EXPECTED_DIR = fileURLToPath(new URL('./snapshots/home-activity-artifacts', import.meta.url))
const PENDING_EXPECTED = join(EXPECTED_DIR, 'pending.expected.md')
const REPORTED_EXPECTED = join(EXPECTED_DIR, 'reported.expected.md')
const SCREENSHOT_DIR = fileURLToPath(new URL('../../../.artifacts/ui-review', import.meta.url))
const PENDING_SCREENSHOT = join(SCREENSHOT_DIR, 'home-activity-artifacts-pending.png')
const REPORTED_SCREENSHOT = join(SCREENSHOT_DIR, 'home-activity-artifacts.png')
const MODE = webSnapshotMode()
const PROMPT = 'Reply with the single word LIGHTHOUSE and stop.'
const execFileAsync = promisify(execFile)

async function createLocalRepository(
  root: string,
  relativeFile: string,
  contents: string,
): Promise<{ readonly root: string; readonly revision: string }> {
  await mkdir(root, { recursive: true })
  const hooksPath = join(root, '.test-hooks')
  const templatePath = join(root, '.test-template')
  await Promise.all([mkdir(hooksPath), mkdir(templatePath)])
  const git = async (args: readonly string[]) => await execFileAsync(
    'git', ['-c', `core.hooksPath=${hooksPath.replaceAll('\\', '/')}`, ...args], {
      cwd: root, windowsHide: true, encoding: 'utf8',
    },
  )
  await git(['init', '--quiet', '--initial-branch=main', `--template=${templatePath.replaceAll('\\', '/')}`])
  const file = join(root, relativeFile)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, contents, 'utf8')
  await git(['add', '--', relativeFile])
  await git([
    '-c', 'user.name=DSH Test Fixture', '-c', 'user.email=dsh-test@example.invalid',
    'commit', '--quiet', '-m', 'Record test artifact',
  ])
  const [{ stdout: repositoryRoot }, { stdout: revision }] = await Promise.all([
    git(['rev-parse', '--show-toplevel']), git(['rev-parse', 'HEAD']),
  ])
  return { root: await realpath(repositoryRoot.trim()), revision: revision.trim() }
}

async function hostRpc<T>(scaffold: WebScaffold, endpoint: string, args: Readonly<Record<string, unknown>>): Promise<T> {
  const response = await scaffold.hostFetch(`/api/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request', rpcId: `home-activity-artifact-${randomUUID()}`, method: endpoint, payload: { args },
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

describe('web e2e: Home Activity artifact pointers', () => {
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

  it.skipIf(MODE === 'record')('renders pointers from two repository Sessions with separate user-selected contexts', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-home-activity-artifacts'))
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
    const firstSessionSnapshot = await scaffold.ctx.sessionPersistence.stat(parentSessionId)
    if (firstSessionSnapshot?.header.cwd === undefined) throw new Error('The first parent Session did not record its Workspace directory.')
    const firstWorkspace = scaffold.ctx.workspaceRegistry.list().find(workspace => workspace.path === firstSessionSnapshot.header.cwd)
    if (firstWorkspace === undefined) throw new Error('The first parent Session directory did not match a registered Workspace.')
    const secondWorkspacePath = join(scaffold.workspaceCwd, 'artifact-repository-two')
    await mkdir(secondWorkspacePath, { recursive: true })
    const { workspace: secondWorkspace } = await hostRpc<{ workspace: { workspaceId: string } }>(
      scaffold, 'workspace/create', { request: { path: secondWorkspacePath } },
    )
    const secondWorkspaceRecord = scaffold.ctx.workspaceRegistry.list().find(workspace => workspace.id === secondWorkspace.workspaceId)
    if (secondWorkspaceRecord === undefined) throw new Error('The second Workspace registry record could not be read.')
    const firstRepository = await createLocalRepository(
      firstWorkspace.path, 'reports/review.md', 'The release checklist has two unverified migration steps.\n',
    )
    const secondRepository = await createLocalRepository(
      secondWorkspaceRecord.path, 'src/change.ts', 'export const reviewTarget = "repository two"\n',
    )
    expect(firstRepository.root).not.toBe(secondRepository.root)
    expect(secondRepository.revision).toMatch(/^[0-9a-f]{40}$/u)
    const { sessionId: secondParentSessionId } = await hostRpc<{ sessionId: string }>(
      scaffold, 'session/create', { request: { workspaceId: secondWorkspace.workspaceId } },
    )
    const secondSessionSnapshot = await scaffold.ctx.sessionPersistence.stat(secondParentSessionId)
    expect(secondSessionSnapshot?.header.cwd).toBe(secondWorkspaceRecord.path)
    expect(firstWorkspace.id).not.toBe(secondWorkspace.workspaceId)
    const childResults: ReturnType<typeof Promise.withResolvers<SubagentResult>>[] = []
    const requestedChildSessionIds: string[] = []
    const start = vi.spyOn(scaffold.ctx.subagents, 'startActivation').mockImplementation(async (spec) => {
      if (spec.childId === undefined) throw new Error('The Activity command did not reserve a child Session id.')
      requestedChildSessionIds.push(spec.childId)
      const childResult = Promise.withResolvers<SubagentResult>()
      childResults.push(childResult)
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
      const output = page.getByText(marker).last()
      await output.waitFor({ timeout: 10_000 })
      await expect.poll(() => input.textContent(), { timeout: 10_000 }).toBe('')
      return await output.textContent() ?? ''
    }

    const firstWorkspaceId = firstWorkspace.id
    const secondWorkspaceId = secondWorkspace.workspaceId
    await submit('/activity workspaces', /Available Workspaces/u)
    const workspaceText = await page.getByText(/Available Workspaces/u).last().textContent() ?? ''
    expect(workspaceText).toContain(firstWorkspaceId)
    expect(workspaceText).toContain(secondWorkspaceId)
    await submit(`/activity link ${activity.id} workspace ${firstWorkspaceId}`, /records a reference only/u)
    await submit(`/activity link ${activity.id} workspace ${secondWorkspaceId}`, /records a reference only/u)
    await submit(`/activity link ${activity.id} session ${parentSessionId}`, /records a reference only/u)
    await submit(`/activity link ${activity.id} session ${secondParentSessionId}`, /records a reference only/u)
    const pathReplacements = [
      [secondWorkspaceRecord.path, '{{workspace-directory-2}}'],
      [secondWorkspaceRecord.path.replaceAll('\\', '\\\\'), '{{workspace-directory-2}}'],
      [firstWorkspace.path, '{{workspace-directory-1}}'],
      [firstWorkspace.path.replaceAll('\\', '\\\\'), '{{workspace-directory-1}}'],
    ] as const
    await submit(
      `/activity delegate ${activity.id} spawn Inspect the release checklist.`,
      /Delegation admitted: provider spawn/u,
    )
    expect(start).toHaveBeenCalledTimes(1)
    const startSpec = start.mock.calls[0]?.[0]
    if (startSpec === undefined) throw new Error('The DSH subagent provider was not invoked.')
    expect(startSpec.provider).toBe('spawn')
    expect(startSpec.parent.id).toBe(parentSessionId)
    const firstChildSessionId = requestedChildSessionIds[0]
    if (firstChildSessionId === undefined) throw new Error('The accepted activation has no child Session identity.')

    const admissionText = await page.getByText(/Delegation admitted: provider spawn/u).last().textContent() ?? ''
    expect(admissionText).toContain(`Child Session: ${firstChildSessionId}`)
    expect(admissionText).toContain('Its provider report is pending; opening the Activity shows user disposition separately.')
    await submit(`/activity open ${activity.id}`, /Activity: Release readiness/u)
    await page.getByRole('button', { name: /Activity: Release readiness/u }).last().click()
    await page.getByText(/Provider report: not recorded/u).last().waitFor({ timeout: 10_000 })

    const replacements = [
      [activity.id, '{{activity-id}}'],
      [parentSessionId, '{{parent-session-id}}'],
      [secondParentSessionId, '{{parent-session-id-2}}'],
      [firstChildSessionId, '{{child-session-id}}'],
      [activity.createdAt, '{{activity-created-at}}'],
    ] as const
    const pendingSnapshot = await captureStableAria(
      page, '[class*="centerCol"]', scaffold.workspaceCwd, { replacements: [...replacements, ...pathReplacements] },
    )
    await compareOrRefreshGolden(PENDING_EXPECTED, pendingSnapshot, MODE)
    expect(pendingSnapshot).toContain('Delegation state: admitted.')
    expect(pendingSnapshot).toContain('Provider report: not recorded; opening the Activity does not wait for the child Session.')
    await mkdir(SCREENSHOT_DIR, { recursive: true })
    await page.screenshot({ path: PENDING_SCREENSHOT, fullPage: true })

    const firstDelegation = scaffold.ctx.homeActivityDelegations.list(activity.id)
      .find(record => record.request.task === 'Inspect the release checklist.')
    if (firstDelegation === undefined) throw new Error('The first request was not durably recorded.')
    expect(firstDelegation.request.parentSessionId).toBe(parentSessionId)
    const firstChildResult = childResults[0]
    if (firstChildResult === undefined) throw new Error('The first activation result was not captured.')
    firstChildResult.resolve({
      stopReason: 'completed',
      output: [{ type: 'text', text: 'The checklist contains two unverified migration steps.' }],
    })
    await vi.waitFor(async () => {
      expect(scaffold.ctx.homeActivityDelegations.get(firstDelegation.id)?.status).toBe('reported')
    })

    const secondAdmission = await executeCommand(
      scaffold,
      secondParentSessionId,
      `/activity delegate ${activity.id} spawn Inspect the patch in repository two.`,
    )
    expect(secondAdmission.kind).toBe('success')
    expect(secondAdmission.text).toContain('Delegation admitted: provider spawn')
    expect(start).toHaveBeenCalledTimes(2)
    expect(start.mock.calls[1]?.[0].provider).toBe('spawn')
    expect(start.mock.calls[1]?.[0].parent.id).toBe(secondParentSessionId)
    const secondChildSessionId = requestedChildSessionIds[1]
    if (secondChildSessionId === undefined) throw new Error('The second accepted activation has no child Session identity.')
    const secondDelegation = scaffold.ctx.homeActivityDelegations.list(activity.id)
      .find(record => record.request.task === 'Inspect the patch in repository two.')
    if (secondDelegation === undefined) throw new Error('The second request was not durably recorded.')
    expect(secondDelegation.request.parentSessionId).toBe(secondParentSessionId)
    const secondChildResult = childResults[1]
    if (secondChildResult === undefined) throw new Error('The second activation result was not captured.')
    secondChildResult.resolve({
      stopReason: 'completed',
      output: [{ type: 'text', text: 'Repository two reported a focused patch.' }],
    })
    await vi.waitFor(async () => {
      expect(scaffold.ctx.homeActivityDelegations.get(secondDelegation.id)?.status).toBe('reported')
    })

    const firstPointer = await submit(
      `/activity artifact add ${activity.id} ${firstDelegation.id} ${firstWorkspaceId} {"label":"Repository one report","location":"reports/review.md"}`,
      /Artifact reference recorded: Repository one report/u,
    )
    const secondPointer = (await executeCommand(
      scaffold,
      secondParentSessionId,
      `/activity artifact add ${activity.id} ${secondDelegation.id} ${secondWorkspaceId} {"label":"Repository two patch","location":"src/change.ts","revision":"${secondRepository.revision}"}`,
    )).text ?? ''
    expect(secondPointer).toContain('Artifact reference recorded: Repository two patch')
    expect(firstPointer).toContain('Source revision: unknown')
    expect(secondPointer).toContain(`Source revision: ${secondRepository.revision}`)
    expect(firstPointer).toContain(`User-selected Workspace context: ${firstWorkspaceId}`)
    expect(secondPointer).toContain(`User-selected Workspace context: ${secondWorkspaceId}`)
    expect(firstPointer).toContain('This is a user-linked pointer only')
    expect(secondPointer).toContain('This is a user-linked pointer only')
    expect(firstPointer).toContain('does not verify execution context')
    expect(secondPointer).toContain('does not verify execution context')
    expect(scaffold.ctx.homeActivityArtifacts.list(activity.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ delegationId: firstDelegation.id, workspaceId: firstWorkspaceId }),
      expect.objectContaining({ delegationId: secondDelegation.id, workspaceId: secondWorkspaceId }),
    ]))

    await submit(`/activity open ${activity.id}`, /Activity: Release readiness/u)
    await page.getByRole('button', { name: /Activity: Release readiness/u }).last().click()
    await page.getByText(/Provider-reported output: Repository two reported a focused patch\./u)
      .last().waitFor({ timeout: 10_000 })
    const delegationIds = [...(await page.locator('pre').filter({ hasText: 'Provider-reported output:' }).last().textContent() ?? '')
      .matchAll(/Delegation ([0-9a-f-]{36}): provider spawn/gu)].map(match => match[1])
    expect(delegationIds).toContain(firstDelegation.id)
    expect(delegationIds).toContain(secondDelegation.id)
    const replacementsWithDelegations = [
      ...replacements,
      [secondChildSessionId, '{{child-session-id-2}}'],
      [firstDelegation.id, '{{delegation-id-1}}'],
      [secondDelegation.id, '{{delegation-id-2}}'],
      [secondWorkspaceId, '{{workspace-id-2}}'],
      [secondRepository.revision, '{{source-revision-2}}'],
    ] as const
    const reportReplacements = [...replacementsWithDelegations, ...pathReplacements] as const
    const renderedReport = page.locator('pre').filter({ hasText: 'User-linked artifact references' }).last()
    await renderedReport.scrollIntoViewIfNeeded()
    const conversationScroll = page.locator('[data-conversation-scroll]').first()
    await conversationScroll.evaluate((element) => { element.scrollTop = element.scrollHeight })
    await page.screenshot({ path: REPORTED_SCREENSHOT, fullPage: true })
    const reportedSnapshot = await captureStableAria(
      page, '[class*="centerCol"]', scaffold.workspaceCwd, { replacements: reportReplacements },
    )
    await compareOrRefreshGolden(REPORTED_EXPECTED, reportedSnapshot, MODE)
    expect(reportedSnapshot).toContain('Delegation state: reported.')
    expect(reportedSnapshot).toContain('Provider report: received; DSH has not independently verified it.')
    expect(reportedSnapshot).toContain('Provider-reported output: The checklist contains two unverified migration steps.')
    expect(reportedSnapshot).toContain('Repository one report')
    expect(reportedSnapshot).toContain('Repository two patch')
    expect(reportedSnapshot).toContain('Source revision: unknown')
    expect(reportedSnapshot).toContain('Source revision: {{source-revision-2}}')
    expect(reportedSnapshot).toContain('Requesting Session: {{parent-session-id-2}}')
    expect(reportedSnapshot).toContain('Requesting Session: {{parent-session-id}}')
    expect(reportedSnapshot).toContain('User-selected Workspace context (execution Workspace unverified)')
    expect(reportedSnapshot).toContain('Workspace contexts are independent; no shared checkout or Git root is inferred.')
    expect(reportedSnapshot).not.toContain('Status: accepted.')
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    const { sessionId: recoveryParentSessionId } = await hostRpc<{ sessionId: string }>(
      scaffold, 'session/create', { request: { workspaceId: firstWorkspaceId } },
    )
    expect(recoveryParentSessionId).not.toBe(parentSessionId)
    expect(recoveryParentSessionId).not.toBe(secondParentSessionId)
    const recoveryOpen = await executeCommand(
      scaffold, recoveryParentSessionId, `/activity open ${activity.id}`,
    )
    expect(recoveryOpen.kind).toBe('success')
    const reopenedActivityText = recoveryOpen.text ?? ''
    expect(reopenedActivityText).toContain('Repository one report')
    expect(reopenedActivityText).toContain('Repository two patch')
    expect(reopenedActivityText).toContain('Source revision: unknown')
    expect(reopenedActivityText).toContain(`Source revision: ${secondRepository.revision}`)
    expect(reopenedActivityText).toContain(`Requesting Session: ${parentSessionId}`)
    expect(reopenedActivityText).toContain(`Requesting Session: ${secondParentSessionId}`)
    expect(reopenedActivityText).toContain(
      `User-selected Workspace context (execution Workspace unverified): workspace — ${firstWorkspaceId}`,
    )
    expect(reopenedActivityText).toContain(
      `User-selected Workspace context (execution Workspace unverified): artifact-repository-two — ${secondWorkspaceId}`,
    )
    expect(start).toHaveBeenCalledTimes(2)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)
})
