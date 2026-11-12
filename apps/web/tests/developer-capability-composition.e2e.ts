// One Web Session composes an implementation, read-only review child, and
// evidence-aware completion against one disposable Git repository.
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { parseSessionLog, type ReplayEntry, type ReplayOverrideDoc } from '@deepseek-ai/dsh-llm-replay'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-subagent'
import {
  launchWebScaffold,
  watchConsole,
  type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const execFileAsync = promisify(execFile)
const COMPLETION_SKILL_NAME = 'evidence-aware-completion'
const REVIEW_SKILL_NAME = 'code-review'
const INITIAL_SOURCE = 'export function isValidLabel(value) { return value.length > 0 }\n'
const FIXED_SOURCE = "export function isValidLabel(value) { return typeof value === 'string' && value.trim().length > 0 }\n"
const KICKOFF_REPLY = 'The current helper accepts whitespace because it only checks whether the string has characters.'
const IMPLEMENTATION_SUMMARY = 'Updated src/label.mjs to reject whitespace-only labels. I did not run tests in this turn.'
const REVIEW_SUMMARY = 'Review received: no actionable findings; the captured repository state remained unchanged.'
const COMPLETION_SUMMARY = [
  'Implemented whitespace-only label rejection in src/label.mjs.',
  'No test command was observed in this Session, so the change remains unverified by tests.',
  'The requested read-only review returned no actionable findings; its repository, HEAD, Session and run are attributed in the handoff.',
  'This deterministic replay verifies DSH integration, not independent semantic correctness or real-model judgment.',
].join('\n')
const ORDINARY_REPLY = 'The helper accepts nonempty labels and rejects whitespace-only labels; I made no changes for this explanation.'

function textResponse(text: string): ReplayEntry {
  return {
    kind: 'chunks',
    chunks: [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text },
      { type: 'block-end', index: 0, block: { type: 'text', text } },
      { type: 'usage', usage: { inputTokens: 256, outputTokens: 32 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ],
  }
}

function toolCallResponse(idText: string, name: string, args: object): ReplayEntry {
  const id = ToolCallId(idText)
  const argumentsJson = JSON.stringify(args)
  return {
    kind: 'chunks',
    chunks: [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argumentsJson },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: argumentsJson } },
      { type: 'usage', usage: { inputTokens: 256, outputTokens: 16 } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ],
  }
}

const REPLAY: ReplayOverrideDoc = [
  textResponse(KICKOFF_REPLY),
  toolCallResponse('implement-label-fix', 'write', { file_path: 'src/label.mjs', content: FIXED_SOURCE }),
  textResponse(IMPLEMENTATION_SUMMARY),
  textResponse(REVIEW_SUMMARY),
  toolCallResponse('completion-load-skill', 'skill', { name: COMPLETION_SKILL_NAME }),
  textResponse(COMPLETION_SUMMARY),
  textResponse(ORDINARY_REPLY),
]

describe('Web development capability composition', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let replayDir: string
  let tripwire: ReturnType<typeof watchConsole>
  let sessionId: Awaited<ReturnType<WebScaffold['whenTurnSettled']>> | undefined
  let repositoryRoot: string
  let reviewStartCount = 0
  let removeReviewCounter: (() => void) | undefined

  beforeAll(async () => {
    replayDir = await mkdtemp(join(tmpdir(), 'dsh-capability-composition-replay-'))
    const replayOverride = join(replayDir, 'replay.override.json')
    const reviewChildFixture = join(replayDir, 'review-child.jsonl')
    await writeFile(replayOverride, JSON.stringify(REPLAY))
    const childLog = createReviewChildFixture()
    expect(parseSessionLog(childLog)).toHaveLength(10)
    await writeFile(reviewChildFixture, childLog)
    scaffold = await launchWebScaffold({
      replayFixture: join(replayDir, 'override-only.jsonl'),
      replayOverride,
      replayChildFixtures: [reviewChildFixture],
      paceMs: 10,
    })
    repositoryRoot = join(scaffold.workspaceCwd, 'workspace')
    await initializeRepository(repositoryRoot)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    removeReviewCounter = scaffold.ctx.on('subagent/start', () => { reviewStartCount += 1 })
  }, 120_000)

  afterAll(async () => {
    const failures: unknown[] = []
    removeReviewCounter?.()
    await browser?.close().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (replayDir !== undefined) {
      await rm(replayDir, { recursive: true, force: true })
        .catch((error: unknown) => failures.push(error))
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'capability composition cleanup failed')
  })

  it('implements without mandatory stages, returns optional review, and reports missing test evidence', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-developer-capability-composition'))
    const composer = page.locator('[data-composer-input][contenteditable="true"]').last()
    await composer.waitFor({ timeout: 15_000 })

    const kickoff = scaffold.whenTurnSettled()
    await composer.fill('Explain how the label helper treats whitespace. Do not edit the repository.')
    await composer.press('Enter')
    await page.getByText(KICKOFF_REPLY, { exact: true }).waitFor({ timeout: 20_000 })
    sessionId = await kickoff
    const session = scaffold.ctx.sessions.get(sessionId)
    if (session === undefined) throw new Error('development Session is unavailable')
    const ordinaryEvents = session.snapshotEvents()
    expect(ordinaryEvents.filter(event => event.type === 'tool/call')).toHaveLength(0)
    expect(ordinaryEvents.some(event => event.type === 'user/message'
      && event.data.source.kind === 'skill-invocation')).toBe(false)
    expect(ordinaryEvents.flatMap(event => event.type === 'user/message'
      && event.data.source.kind === 'agent-instructions'
      ? event.data.content.flatMap(block => block.type === 'text' ? [block.text] : [])
      : []).join('\n')).toContain('Use the Node built-in test runner.')
    expect(reviewStartCount).toBe(0)

    scaffold.ctx.permissionPresets.set(session, 'workspace-write')
    expect(scaffold.ctx.permissionPresets.current(session)).toBe('workspace-write')
    const parentAgent = scaffold.ctx.agents.get(sessionId)
    if (parentAgent === undefined) throw new Error('development Agent is unavailable')
    expect(scaffold.ctx.workingDirectory.get(parentAgent.session)).toBe(repositoryRoot)
    const implementationTurn = scaffold.whenTurnSettled()
    await composer.fill('Fix whitespace-only label acceptance in src/label.mjs. Do not invoke TDD or review in this turn.')
    await composer.press('Enter')
    await page.getByText(IMPLEMENTATION_SUMMARY, { exact: true }).waitFor({ timeout: 30_000 })
    await implementationTurn
    const writeCalls = session.snapshotEvents().filter(isToolCall).filter(event => event.data.name === 'write')
    expect(writeCalls).toHaveLength(1)
    const implementationResult = resultFor(session.snapshotEvents(), writeCalls[0]!)
    expect(implementationResult).toContain('Updated file')
    expect(implementationResult).toContain(join(repositoryRoot, 'src/label.mjs'))
    expect(await readFile(join(repositoryRoot, 'src/label.mjs'), 'utf8')).toBe(FIXED_SOURCE)
    expect(session.snapshotEvents().some(event => event.type === 'user/message'
      && event.data.source.kind === 'skill-invocation')).toBe(false)

    const beforeReview = await snapshotRepository(repositoryRoot)
    const reviewRun = observeReviewRun(scaffold, session)
    const reviewTurn = waitForSessionTurn(scaffold, sessionId)
    const review = await executeRemote<{ result: { kind: string; text?: string } }>(
      scaffold,
      'commands/execute',
      { agentId: sessionId, line: '/review inspect label validation', submittedAttachments: [] },
    )
    expect(review.result.kind, review.result.text).toBe('success')
    expect(await reviewTurn).toBe(sessionId)
    const reviewEvidence = await reviewRun
    expect(reviewEvidence.toolNames).toEqual(['skill'])
    expect(reviewEvidence.childSessionId).not.toBe(sessionId)
    expect(reviewEvidence.runId.length).toBeGreaterThan(0)
    expect(reviewEvidence.parentHandoff).toContain('[DSH code review handoff]')
    expect(reviewEvidence.parentHandoff).toContain(`Repository: ${repositoryRoot}`)
    expect(reviewEvidence.parentHandoff).toContain(`Branch: ${await git(repositoryRoot, ['branch', '--show-current'])}`)
    expect(reviewEvidence.parentHandoff).toContain(`Committed HEAD: ${await git(repositoryRoot, ['rev-parse', 'HEAD'])}`)
    expect(reviewEvidence.parentHandoff).toContain(`Reviewer Session: ${reviewEvidence.childSessionId}`)
    expect(reviewEvidence.parentHandoff).toContain(`Reviewer run: ${reviewEvidence.runId}`)
    expect(reviewEvidence.parentHandoff).toContain('src/label.mjs')
    expect(reviewEvidence.parentHandoff).toContain('No actionable findings.')
    const parentReply = session.snapshotEvents().filter(event => event.type === 'assistant/message')
      .flatMap(event => event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []))
      .at(-1)
    expect(parentReply).toBe(REVIEW_SUMMARY)
    expect(await snapshotRepository(repositoryRoot)).toBe(beforeReview)

    const completionTurn = scaffold.whenTurnSettled()
    await composer.fill('Report this completed change, the checks actually run, the review outcome and any limits.')
    await composer.press('Enter')
    await page.getByText(COMPLETION_SUMMARY, { exact: true }).waitFor({ timeout: 30_000 })
    await completionTurn
    const events = session.snapshotEvents()
    const completionCall = events.find((event): event is Extract<SessionEvent, { type: 'tool/call' }> => event.type === 'tool/call'
      && event.data.name === 'skill'
      && event.data.arguments.includes(COMPLETION_SKILL_NAME))
    expect(completionCall?.data.arguments ?? '')
      .toContain(COMPLETION_SKILL_NAME)
    expect(toolResultForCall(events, completionCall)).toContain('**Not observed:**')

    const toolCallCount = events.filter(event => event.type === 'tool/call').length
    const childRunCount = reviewStartCount
    const ordinaryTurn = scaffold.whenTurnSettled()
    await composer.fill('Explain the label helper without editing the repository.')
    await composer.press('Enter')
    await page.getByText(ORDINARY_REPLY, { exact: true }).waitFor({ timeout: 20_000 })
    await ordinaryTurn
    expect(session.snapshotEvents().filter(event => event.type === 'tool/call')).toHaveLength(toolCallCount)
    expect(reviewStartCount).toBe(childRunCount)
    expect(await snapshotRepository(repositoryRoot)).toBe(beforeReview)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 90_000)
})

interface ReviewEvidence {
  readonly childSessionId: string
  readonly runId: string
  readonly toolNames: string[]
  readonly parentHandoff: string
}

function waitForSessionTurn(scaffold: WebScaffold, sessionId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      stop()
      reject(new Error(`parent Session ${sessionId} did not complete its review handoff turn`))
    }, 30_000)
    const stop = scaffold.ctx.on('session/event', (candidate, event) => {
      if (String(candidate.id) !== sessionId || event.type !== 'turn/end') return
      clearTimeout(timeout)
      stop()
      resolve(String(candidate.id))
    })
  })
}

function observeReviewRun(
  scaffold: WebScaffold,
  parent: Session,
): Promise<ReviewEvidence> {
  return new Promise((resolve, reject) => {
    let active = true
    let stop = (): void => undefined
    const timeout = setTimeout(() => {
      active = false
      stop()
      reject(new Error('review child did not finish within 30 seconds'))
    }, 30_000)
    let childSessionId = ''
    let runId = ''
    let child: import('@deepseek-ai/dsh-agent').Agent | undefined
    stop = scaffold.ctx.on('subagent/start', ({ id, runId: startedRunId }) => {
      const candidate = scaffold.ctx.agents.get(id)
      if (candidate === undefined) return
      child = candidate
      childSessionId = String(candidate.session.id)
      runId = String(startedRunId)
    })
    const poll = (): void => {
      const handoff = parent?.snapshotEvents().flatMap(event => event.type === 'user/message'
        ? event.data.content.flatMap(block => block.type === 'text' ? [block.text] : [])
        : []).find(text => text.startsWith('[DSH code review handoff]'))
      if (child !== undefined && handoff !== undefined) {
        const childEvents = child.session.snapshotEvents()
        const toolNames = childEvents.flatMap(event => event.type === 'tool/call' ? [event.data.name] : [])
        active = false
        clearTimeout(timeout)
        stop()
        resolve({ childSessionId, runId, toolNames, parentHandoff: handoff })
        return
      }
      if (active) setTimeout(poll, 10)
    }
    setTimeout(poll, 10)
  })
}

function resultFor(
  events: readonly SessionEvent[],
  call: Extract<SessionEvent, { type: 'tool/call' }>,
): string {
  const result = events.find(event => event.type === 'tool/result' && event.data.message.toolCallId === call.data.callId)
  return result?.type === 'tool/result'
    ? result.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
    : ''
}

function isToolCall(event: SessionEvent): event is Extract<SessionEvent, { type: 'tool/call' }> {
  return event.type === 'tool/call'
}

function toolResultForCall(
  events: readonly SessionEvent[],
  call: Extract<SessionEvent, { type: 'tool/call' }> | undefined,
): string {
  if (call === undefined) return ''
  return resultFor(events, call)
}

async function executeRemote<T>(
  scaffold: WebScaffold,
  method: string,
  args: Readonly<Record<string, unknown>>,
): Promise<T> {
  const response = await scaffold.hostFetch(`/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: `capability-composition-${randomUUID()}`,
      method,
      payload: { args },
    }),
  })
  if (!response.ok) throw new Error(`${method} failed over HTTP ${response.status}: ${await response.text()}`)
  const result = (await response.json() as {
    result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
  }).result
  if (!result.ok) throw new Error(`${method} failed: ${result.error.code}: ${result.error.message}`)
  return result.value
}

async function initializeRepository(root: string): Promise<void> {
  await mkdir(root, { recursive: true })
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, '.gitignore'), '*\n!/.gitignore\n!/AGENTS.md\n!/src/\n!/src/**\n')
  await writeFile(join(root, 'AGENTS.md'), 'Use the Node built-in test runner. Keep the label helper focused on string inputs.\n')
  await writeFile(join(root, 'src/label.mjs'), INITIAL_SOURCE)
  await git(root, ['init', '--initial-branch', 'capability-composition'])
  await git(root, ['add', '--', '.gitignore', 'AGENTS.md', 'src/label.mjs'])
  await git(root, ['-c', 'user.name=DSH composition fixture', '-c', 'user.email=dsh-composition@example.invalid', 'commit', '--no-gpg-sign', '-m', 'initial label helper'])
}

function createReviewChildFixture(): string {
  const callId = 'review-load-skill'
  const argumentsJson = JSON.stringify({ name: REVIEW_SKILL_NAME })
  const skillCall = {
    type: 'tool-call',
    id: callId,
    name: 'skill',
    arguments: argumentsJson,
  }
  const skillCallStream = [
    { type: 'chunk', time: 1, chunk: { type: 'block-start', index: 0, blockType: 'tool-call' } },
    { type: 'tool-call-chunks', time0: 2, index: 0, dt: [], id: callId, name: 'skill', args: [argumentsJson] },
    { type: 'chunk', time: 3, chunk: { type: 'block-end', index: 0, block: skillCall } },
    { type: 'chunk', time: 4, chunk: { type: 'usage', usage: { inputTokens: 256, outputTokens: 16 } } },
    { type: 'chunk', time: 5, chunk: { type: 'finish', reason: { kind: 'tool-calls' } } },
  ]
  const reviewText = 'No actionable findings. src/label.mjs supports the requested whitespace validation change.'
  const reviewTextStream = [
    { type: 'chunk', time: 6, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
    { type: 'text-chunks', time0: 7, index: 0, dt: [], texts: [reviewText] },
    { type: 'chunk', time: 8, chunk: { type: 'block-end', index: 0, block: { type: 'text', text: reviewText } } },
    { type: 'chunk', time: 9, chunk: { type: 'usage', usage: { inputTokens: 256, outputTokens: 32 } } },
    { type: 'chunk', time: 10, chunk: { type: 'finish', reason: { kind: 'stop' } } },
  ]
  const message = (id: string, content: object[], stream: object[], usage: { inputTokens: number; outputTokens: number }) => ({
    turn: 1,
    step: id === 'review-call' ? 1 : 2,
    message: {
      role: 'assistant',
      content,
      source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      id,
    },
    stream,
    usage,
  })
  const rows = [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'step/start', data: { turn: 1, step: 1 } },
    {
      type: 'assistant/message',
      data: message('review-call', [skillCall], skillCallStream, { inputTokens: 256, outputTokens: 16 }),
      surfaceOp: 'append',
    },
    { type: 'tool/call', data: { turn: 1, step: 1, callId, name: 'skill', arguments: argumentsJson } },
    {
      type: 'tool/result',
      data: {
        turn: 1,
        step: 1,
        message: {
          role: 'tool',
          source: { kind: 'tool', callId },
          toolCallId: callId,
          content: [{ type: 'text', text: 'Loaded code-review Skill instructions.' }],
          isError: false,
          id: 'review-skill-result',
        },
      },
      surfaceOp: 'append',
    },
    { type: 'step/end', data: { turn: 1, step: 1 } },
    { type: 'step/start', data: { turn: 1, step: 2 } },
    {
      type: 'assistant/message',
      data: message('review-finding', [{ type: 'text', text: reviewText }], reviewTextStream, { inputTokens: 256, outputTokens: 32 }),
      surfaceOp: 'append',
    },
    { type: 'step/end', data: { turn: 1, step: 2 } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  const header = {
    type: 'session',
    version: 4,
    id: 'recorded-review-child',
    createdAt: 1,
    cwd: process.cwd(),
    parentSession: 'recorded-parent',
    isSeeded: false,
    origin: 'subagent',
    delegationDepth: 1,
    agentPreset: 'code-review',
  }
  return [header, ...rows].map(row => JSON.stringify(row)).join('\n') + '\n'
}

async function snapshotRepository(root: string): Promise<string> {
  const files = await Promise.all(['.gitignore', 'AGENTS.md', 'src/label.mjs'].map(async (path) => {
    try {
      return [path, (await readFile(join(root, path))).toString('base64')] as const
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [path, null] as const
      throw error
    }
  }))
  return JSON.stringify({
    files,
    index: (await readFile(join(root, '.git/index'))).toString('base64'),
    branch: await git(root, ['branch', '--show-current']),
    head: await git(root, ['rev-parse', 'HEAD']),
    status: await git(root, ['status', '--porcelain=v1', '--untracked-files=all', '--ignored=no']),
  })
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const windows = process.platform === 'win32'
  const env: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
  )
  env.GIT_CONFIG_NOSYSTEM = '1'
  env.GIT_CONFIG_GLOBAL = windows ? 'NUL' : '/dev/null'
  env.GIT_OPTIONAL_LOCKS = '0'
  env.GIT_TERMINAL_PROMPT = '0'
  return (await execFileAsync('git', ['-c', `core.hooksPath=${windows ? 'NUL' : '/dev/null'}`, ...args], { cwd, env })).stdout.trim()
}
