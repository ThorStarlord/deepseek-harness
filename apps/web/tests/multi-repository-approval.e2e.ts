// Keyless assembled-Web inspection of the repository-read approval copy.
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Browser } from 'playwright'
import { expect, it } from 'vitest'
import { textResponse, toolCallResponse } from '../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { fixtureUserPrompts, launchWebScaffold, webSnapshotMode } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

const execFileAsync = promisify(execFile)
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const DIR = fileURLToPath(new URL('../../../snapshots/web/multi-repository-worker-tools', import.meta.url))
const PARENT_FIXTURE = join(DIR, 'session.v4.jsonl')
const READ_ONLY_PRESET = join(REPO_ROOT, 'packages/bundle/web-app/presets/multi-repository-read-only.patch.yml')
const MODE = webSnapshotMode()

it.skipIf(MODE === 'record')('shows partial-enforcement limits before a repository-read decision', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'dsh-web-multirepository-approval-'))
  let browser: Browser | undefined
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let runFailure: unknown
  let runFailed = false
  try {
    const replayOverride = join(fixtureRoot, 'coordinator.override.json')
    const repositories = [join(fixtureRoot, 'alpha'), join(fixtureRoot, 'beta')] as const
    for (const [index, path] of repositories.entries()) await prepareRepository(path, index === 0 ? 'Alpha' : 'Beta')

    const parentFixture = await readFile(PARENT_FIXTURE, 'utf8')
    const prompt = fixtureUserPrompts(parentFixture)[0]
    if (prompt === undefined) throw new Error('multi-repository snapshot has no coordinator prompt')
    const args = { repositories, task: 'Inspect the selected repositories with read-only workers.' }
    await writeFile(replayOverride, JSON.stringify([
      { kind: 'chunks', chunks: toolCallResponse('coordinate-repositories-approval', 'coordinate_repositories', args) },
      { kind: 'chunks', chunks: textResponse('COORDINATION_REPLAY_COMPLETE') },
    ]))

    scaffold = await launchWebScaffold({
      replayFixture: PARENT_FIXTURE,
      replayOverride,
      compareReplaySession: false,
      extraOverlayPath: READ_ONLY_PRESET,
    })
    const coordinatorWorkspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd, 'Coordinator fixture')
    const { sessionId } = await scaffold.ctx.sessionController.create({ cwd: scaffold.workspaceCwd })
    await coordinatorWorkspace.attachSession(sessionId)
    const coordinator = scaffold.ctx.agents.get(sessionId)
    if (coordinator === undefined) throw new Error('coordinator Session has no Agent')
    for (const [index, path] of repositories.entries()) {
      await scaffold.ctx.workspaceRegistry.create(path, index === 0 ? 'Alpha fixture' : 'Beta fixture')
    }
    browser = await chromium.launch()
    const page = await newEnglishPage(browser)
    await page.addInitScript((id) => {
      localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: id }))
    }, String(sessionId))
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await page.locator('[data-composer-input]').first().waitFor({ timeout: 30_000 })

    const selectedSessionId = await page.evaluate(() => {
      const saved = localStorage.getItem('dsh.sessions.current')
      return saved === null ? undefined : (JSON.parse(saved) as { sessionId?: string }).sessionId
    })
    expect(selectedSessionId).toBe(String(sessionId))

    const settled = scaffold.whenTurnSettled(60_000)
    const input = page.locator('[data-composer-input]').first()
    await input.fill(prompt)
    await input.press('Enter')

    const approval = page.locator('[data-approval-key]')
    await approval.waitFor({ timeout: 30_000 })
    expect(await approval.getByText(/When the sandbox reports partial enforcement/u).isVisible()).toBe(true)
    expect(await approval.getByText(/not OS-confined/u).isVisible()).toBe(true)
    expect(await approval.getByText(/On Windows/u).count()).toBe(0)
    await approval.getByRole('button', { name: 'Reject' }).click()

    const settledSessionId = await settled
    expect(String(settledSessionId)).toBe(String(coordinator.id))
    expect(coordinator.session.snapshotEvents().some(event => event.type === 'assistant/message'
      && event.data.message.content.some(block => block.type === 'text' && block.text === 'COORDINATION_REPLAY_COMPLETE')))
      .toBe(true)
    expect(scaffold.ctx.agents.list()).toHaveLength(1)
    expect(coordinator.session.snapshotEvents().some(event => event.type === 'tool/call'
      && event.data.name === 'coordinate_repositories')).toBe(true)
  } catch (error) {
    runFailed = true
    runFailure = error
  } finally {
    const failures: unknown[] = runFailed ? [runFailure] : []
    await Promise.resolve(browser?.close()).catch((error: unknown) => failures.push(error))
    await Promise.resolve(scaffold?.close()).catch((error: unknown) => failures.push(error))
    await rm(fixtureRoot, { recursive: true, force: true, maxRetries: 5 })
      .catch((error: unknown) => failures.push(error))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'multirepository approval e2e and cleanup failed')
  }
}, 120_000)

async function prepareRepository(root: string, title: string): Promise<void> {
  await mkdir(root, { recursive: true })
  await execFileAsync('git', ['init', '--quiet'], { cwd: root })
  await execFileAsync('git', ['config', 'user.name', 'Snapshot Fixture'], { cwd: root })
  await execFileAsync('git', ['config', 'user.email', 'snapshot@example.invalid'], { cwd: root })
  await writeFile(join(root, 'README.md'), `${title} repository fixture\n`)
  await execFileAsync('git', ['add', '--', 'README.md'], { cwd: root })
  await execFileAsync('git', ['commit', '--quiet', '-m', 'fixture baseline'], {
    cwd: root,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Snapshot Fixture',
      GIT_AUTHOR_EMAIL: 'snapshot@example.invalid',
      GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z',
      GIT_COMMITTER_NAME: 'Snapshot Fixture',
      GIT_COMMITTER_EMAIL: 'snapshot@example.invalid',
      GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
    },
  })
}
