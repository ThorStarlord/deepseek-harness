// Keyless Web-profile replay of the model-visible repository-worker tools.
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import {
  fixtureContext, normalizeSessionSnapshots, redactSessionSnapshotIds, refreshFixtureReplacements,
  scrubSessionSnapshot, stabilizeFixtureMessageIds, stabilizeRefreshLog, tokenizeSessionFixtureCwd,
} from '@deepseek-ai/dsh-session-snapshot'
import { prepareSessionSnapshotFixtureForComparison } from '@deepseek-ai/dsh-llm-replay'
import type {} from '@deepseek-ai/dsh-user-approval'
import { textResponse, toolCallResponse } from '../../../packages/core/agent-loop/tests/mock-adapter.ts'
import {
  fixtureUserPrompts, launchWebScaffold, normalizeWebSessionVolatiles, rawSessionLog,
  recordedSessionFixturePath, webSnapshotMode,
} from './scaffold.ts'
import { REPO_ROOT } from './support.ts'

const execFileAsync = promisify(execFile)
const DIR = fileURLToPath(new URL('../../../snapshots/web/multi-repository-worker-tools', import.meta.url))
const PARENT_FIXTURE = join(DIR, 'session.v4.jsonl')
const CHILD_FIXTURES = [join(DIR, 'session.1.v4.jsonl'), join(DIR, 'session.2.v4.jsonl')]
const READ_ONLY_PRESET = join(REPO_ROOT, 'packages/bundle/web-app/presets/multi-repository-read-only.patch.yml')
const LINE_COUNT = 405
const FILE_COUNT = 501
const MODE = webSnapshotMode()
const traceStage = (stage: string): void => { process.stderr.write(`[multi-repository-snapshot] ${stage}\n`) }

it.skipIf(MODE === 'record')('replays repository listing and paged staged reads in Web child Sessions', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'dsh-web-multi-repository-replay-'))
  const repositoryRoot = join(fixtureRoot, 'repositories')
  await mkdir(repositoryRoot)
  const repositoryPaths = [join(repositoryRoot, 'alpha'), join(repositoryRoot, 'beta')] as const
  for (const [index, path] of repositoryPaths.entries()) await prepareRepository(path, index === 0 ? 'alpha' : 'beta')
  const replayChildFixtures = await Promise.all(CHILD_FIXTURES.map(async (path, index) => {
    const replayPath = join(fixtureRoot, `child-replay-${index}.jsonl`)
    const content = (await readFile(path, 'utf8'))
      .replaceAll('READ_ONLY_REPOSITORY_REVIEW_COMPLETE_alpha', 'READ_ONLY_REPOSITORY_REVIEW_COMPLETE')
      .replaceAll('READ_ONLY_REPOSITORY_REVIEW_COMPLETE_beta', 'READ_ONLY_REPOSITORY_REVIEW_COMPLETE')
      .replace(/"outputTokens":(?:41|42)/g, '"outputTokens":42')
    await writeFile(replayPath, content)
    return replayPath
  }))

  const parentFixture = await readFile(PARENT_FIXTURE, 'utf8')
  const prompt = fixtureUserPrompts(parentFixture)[0]
  if (prompt === undefined) throw new Error('multi-repository snapshot has no coordinator prompt')
  const args = {
    repositories: repositoryPaths,
    task: 'List the selected repository files and inspect staged lines 401 and 402 of docs/evidence.txt.',
  }
  const replayOverride = join(fixtureRoot, 'coordinator.override.json')
  await writeFile(replayOverride, JSON.stringify([
    { kind: 'chunks', chunks: toolCallResponse('coordinate-repositories-replay', 'coordinate_repositories', args) },
    { kind: 'chunks', chunks: textResponse('COORDINATION_REPLAY_COMPLETE') },
  ]))

  const scaffold = await launchWebScaffold({
    replayFixture: PARENT_FIXTURE,
    replayOverride,
    replayChildFixtures,
    compareReplaySession: false,
    extraOverlayPath: READ_ONLY_PRESET,
  })
  traceStage('replay ready')
  const sessions: Session[] = []
  const stopSessions = scaffold.ctx.on('session/created', (session) => { sessions.push(session) })
  const stopApproval = scaffold.ctx.on('approval/request', request =>
    Promise.resolve(request.toolName === 'coordinate_repositories' ? 'allowed-once' : 'rejected'), { prepend: true })
  try {
    const workspaces = await Promise.all(repositoryPaths.map((path, index) =>
      scaffold.ctx.workspaceRegistry.create(path, index === 0 ? 'Alpha fixture' : 'Beta fixture')))
    expect(workspaces).toHaveLength(2)
    const { sessionId } = await scaffold.ctx.sessionController.create({ cwd: scaffold.workspaceCwd })
    const parent = scaffold.ctx.agents.get(sessionId)
    if (parent === undefined) throw new Error('Web replay coordinator has no Agent')
    parent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }))
    await parent.whenIdle()
    await scaffold.ctx.sessions.flush(parent.session)
    traceStage('parent turn settled')

    const children = sessions.filter(session => session.header.parentSession === parent.session.id)
    expect(children).toHaveLength(2)
    traceStage('two child Sessions created')
    const workerCwds = children.map(session => scaffold.ctx.workingDirectory.get(session))
    expect(new Set(workerCwds)).toEqual(new Set(repositoryPaths))
    const orderedChildren = children.toSorted((left, right) => left.header.createdAt - right.header.createdAt
      || scaffold.ctx.workingDirectory.get(left).localeCompare(scaffold.ctx.workingDirectory.get(right)))
    for (const child of orderedChildren) {
      const events = child.snapshotEvents()
      const requestHeaders = events.filter(event => event.type === 'request/header')
      expect(requestHeaders.length).toBeGreaterThan(0)
      const toolSchema = JSON.stringify(requestHeaders[0])
      expect(toolSchema).toContain('"name":"read_staged_file"')
      expect(toolSchema).toContain('"offset"')
      expect(toolSchema).toContain('"limit"')

      const listingResult = events.find(event => event.type === 'tool/result'
        && event.data.message.toolCallId === 'worker-list-files')
      expect(JSON.stringify(listingResult)).toContain('additional safe paths omitted')
      expect(JSON.stringify(listingResult)).toContain('of 501')

      const stagedResult = events.find(event => event.type === 'tool/result'
        && event.data.message.toolCallId === 'worker-read-staged')
      expect(JSON.stringify(stagedResult)).toContain('lines 401')
      expect(JSON.stringify(stagedResult)).toContain('of 405')
      expect(JSON.stringify(stagedResult)).toContain('401: staged-')
      expect(JSON.stringify(stagedResult)).toContain('402: staged-')
      expect(events.filter(event => event.type === 'tool/call').map(event => event.data.name))
        .toEqual(['repository_list_files', 'read_staged_file'])
      const finalAssistant = events.filter(event => event.type === 'assistant/message').at(-1)
      expect(finalAssistant?.type === 'assistant/message'
        ? finalAssistant.data.message.content.find(block => block.type === 'text')?.text
        : undefined).toBe('READ_ONLY_REPOSITORY_REVIEW_COMPLETE')
    }
    traceStage('child request and result assertions passed')

    const coordinationResult = parent.session.snapshotEvents().find(event => event.type === 'tool/result'
      && event.data.message.toolCallId === 'coordinate-repositories-replay')
    expect(JSON.stringify(coordinationResult)).toContain('READ_ONLY_REPOSITORY_REVIEW_COMPLETE')
    expect(parent.session.snapshotEvents().some(event => event.type === 'assistant/message'
      && event.data.message.content.some(block => block.type === 'text' && block.text === 'COORDINATION_REPLAY_COMPLETE')))
      .toBe(true)
    expect(new Set(children.map(session => String(session.id))).size).toBe(2)

    const fixtureByChild = orderedChildren.map(child => ({
      child,
      label: scaffold.ctx.workingDirectory.get(child) === repositoryPaths[0] ? 'alpha' : 'beta',
    }))
    for (const { child, label } of fixtureByChild) {
      const stagedResult = child.snapshotEvents().find(event => event.type === 'tool/result'
        && event.data.message.toolCallId === 'worker-read-staged')
      expect(JSON.stringify(stagedResult)).toContain(`staged-${label}-401`)
      expect(JSON.stringify(stagedResult)).toContain(`staged-${label}-402`)
    }

    let expected = await Promise.all(CHILD_FIXTURES.map(path => readFile(path, 'utf8')))
    const raw = orderedChildren.map((child) => {
      const repositoryPath = scaffold.ctx.workingDirectory.get(child)
      const label = repositoryPath === repositoryPaths[0] ? 'alpha' : 'beta'
      return normalizeWorkerRepositoryPath(
        normalizeWebSessionVolatiles(rawSessionLog(child), scaffold.workspaceCwd),
        repositoryPath,
        label,
      )
    })
    const rawWithParent = [
      normalizeWebSessionVolatiles(rawSessionLog(parent.session), scaffold.workspaceCwd),
      ...raw,
    ]
    let expectedWithParent = [parentFixture, ...expected]
    const context = {
      sessionIds: [String(parent.session.id), ...orderedChildren.map(child => String(child.id))],
      cwd: scaffold.workspaceCwd,
    }
    if (MODE === 'refresh') {
      traceStage('refresh normalization started')
      const allSessions = [parent.session, ...orderedChildren]
      const replacements = refreshFixtureReplacements(rawWithParent.map((content, index) => ({
        id: allSessions[index]!.id,
        createdAt: allSessions[index]!.header.createdAt,
        content,
      })), expectedWithParent)
      const allExpected = redactSessionSnapshotIds(stabilizeFixtureMessageIds(rawWithParent.map((log, index) =>
        tokenizeSessionFixtureCwd(scrubSessionSnapshot(stabilizeRefreshLog(
          prepareSessionSnapshotFixtureForComparison(log), expectedWithParent[index]!, replacements, context,
        ))).split(scaffold.harnessHome).join('{{harnessHome}}')), expectedWithParent))
      expected = allExpected.slice(1)
      expectedWithParent = [parentFixture, ...expected]
      await Promise.all(expected.map((log, index) => writeFile(
        recordedSessionFixturePath(CHILD_FIXTURES[index]!, orderedChildren[index]!.header.version), log,
      )))
    }
    traceStage('persisted child snapshot comparison')
    expect(normalizeSessionSnapshots(rawWithParent, context).slice(1))
      .toEqual(normalizeSessionSnapshots(expectedWithParent, fixtureContext(expectedWithParent[0]!)).slice(1))
    traceStage('persisted child snapshot comparison passed')
  } finally {
    traceStage('teardown started')
    stopApproval()
    stopSessions()
    try { await scaffold.close() } finally {
      traceStage('scaffold closed')
      await rm(fixtureRoot, { recursive: true, force: true, maxRetries: 5 })
      traceStage('fixture root removed')
    }
  }
}, 120_000)

async function prepareRepository(root: string, label: string): Promise<void> {
  await mkdir(join(root, 'docs'), { recursive: true })
  await execFileAsync('git', ['init'], { cwd: root })
  await execFileAsync('git', ['config', 'user.name', 'Snapshot Fixture'], { cwd: root })
  await execFileAsync('git', ['config', 'user.email', 'snapshot@example.invalid'], { cwd: root })
  await writeFile(join(root, 'README.md'), `Repository ${label}\n`)
  await writeFile(join(root, 'docs', 'evidence.txt'), 'baseline\n')
  await execFileAsync('git', ['add', '--', 'README.md', 'docs/evidence.txt'], { cwd: root })
  await execFileAsync('git', ['commit', '-m', 'fixture baseline'], {
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
  await writeFile(join(root, 'docs', 'evidence.txt'), Array.from(
    { length: LINE_COUNT }, (_, index) => `staged-${label}-${index + 1}`,
  ).join('\n'))
  await execFileAsync('git', ['add', '--', 'docs/evidence.txt'], { cwd: root })
  await Promise.all(Array.from({ length: FILE_COUNT - 2 }, (_, index) => writeFile(
    join(root, `extra-${String(index).padStart(3, '0')}.txt`), `fixture-${index}\n`,
  )))
}

function normalizeWorkerRepositoryPath(log: string, repositoryPath: string, label: string): string {
  const escaped = repositoryPath.replaceAll('\\', '\\\\')
  const variants = [repositoryPath, escaped, escaped.replaceAll('\\', '\\\\')]
    .sort((left, right) => right.length - left.length)
  return variants.reduce((content, variant) => content.split(variant).join(`{{repository:${label}}}`), log)
}
