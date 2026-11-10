import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SandboxedFileSystem } from '@deepseek-ai/dsh-fs-sandbox'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import Sandbox from '@deepseek-ai/dsh-sandbox-local'
import type { SandboxEnforcement } from '@deepseek-ai/dsh-sandbox'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SandboxBashExecutor } from '@deepseek-ai/dsh-bash-sandbox'
import * as ShellEnv from '@deepseek-ai/dsh-shell-env'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import Subagents from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as ToolBash from '@deepseek-ai/dsh-tool-bash'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import * as ToolMultiRepository from '../src/index.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const execFileAsync = promisify(execFile)
const thirdFileFromBash = 'third-write-from-bash.txt'
const thirdFileFromFs = 'third-write-from-fs.txt'
const workspaceFile = 'worker-output.txt'

interface Fixture {
  readonly ctx: Context
  readonly root: string
  readonly dshHome: string
  readonly alpha: Workspace
  readonly beta: Workspace
  readonly third: Workspace
  readonly alphaHead: string
  readonly betaHead: string
  readonly fullEnforcement: boolean
  readonly enforcement: SandboxEnforcement | 'unavailable'
  readonly parentId: SessionId
  readonly parent: Agent
}

let fixture: Fixture | undefined
const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  fixture = undefined
}, 30_000)

async function setup(): Promise<Fixture> {
  const root = await realpath(await mkdtemp(join(homedir(), '.dsh-multi-repository-')))
  roots.push(root)
  const dshHome = join(root, 'dsh-home')
  const workspaceRoot = join(root, 'workspaces')
  const parentCwd = join(root, 'parent')
  const alphaPath = join(workspaceRoot, 'alpha')
  const betaPath = join(workspaceRoot, 'beta')
  const thirdPath = join(workspaceRoot, 'unselected-third')
  await Promise.all([dshHome, parentCwd, alphaPath, betaPath, thirdPath].map(path => mkdir(path, { recursive: true })))
  vi.stubEnv('DSH_HOME', dshHome)
  const alphaHead = await initializeRepository(alphaPath, 'Alpha repository instructions: ALPHA ONLY.')
  const betaHead = await initializeRepository(betaPath, 'Beta repository instructions: BETA ONLY.')
  await initializeRepository(thirdPath, 'Third repository is not selected.')

  const alpha = workspaceRecord('workspace-alpha', 'Alpha repo', alphaPath)
  const beta = workspaceRecord('workspace-beta', 'Beta repo', betaPath)
  const third = workspaceRecord('workspace-third', 'Unselected third repo', thirdPath)
  const parentId = SessionId(`multi-repository-parent-${randomUUID()}`)
  let fullEnforcement = false
  let enforcement: SandboxEnforcement | 'unavailable' = 'unavailable'

  const handler = (options: GenerateOptions): StreamChunk[] => {
    if (options.sessionId === parentId) {
      const calls = toolCalls(options)
      if (calls.length === 0) {
        return toolCallResponse('coordinate-two-repositories', 'coordinate_repositories', {
          repositories: [alphaPath, betaPath],
          task: 'Read this repository’s instructions and write a short result file for this repository.',
        })
      }
      if (fullEnforcement) {
        const transcript = JSON.stringify(options.messages)
        if (!transcript.includes('Alpha repo') || !transcript.includes('Beta repo')
          || !transcript.includes(alphaHead) || !transcript.includes(betaHead)
          || !transcript.includes(thirdFileFromBash) || !transcript.includes(thirdFileFromFs)) {
          throw new Error('parent did not receive both attributed repository results and their Git evidence')
        }
        return textResponse('Alpha repo and Beta repo completed in separate clones; both unselected-repository writes were denied.')
      }
      return textResponse('Repository coordination stopped because full write enforcement was unavailable.')
    }

    const calls = toolCalls(options)
    const transcript = JSON.stringify(options.messages)
    const alphaChild = transcript.includes('Alpha repo')
    const repoLabel = alphaChild ? 'Alpha repo' : 'Beta repo'
    const ownInstruction = alphaChild ? 'ALPHA ONLY' : 'BETA ONLY'
    if (calls.length === 0) return toolCallResponse('read-repository-instructions', 'read', { file_path: 'AGENTS.md' })
    if (calls.length === 1) {
      if (!transcript.includes(ownInstruction) || transcript.includes(alphaChild ? 'BETA ONLY' : 'ALPHA ONLY')) {
        throw new Error(`${repoLabel} child did not read only its own repository instructions`)
      }
      return toolCallResponse('write-selected-clone', 'bash', {
        description: `Write the selected ${repoLabel} clone.`,
        command: `printf '%s' ${shellQuote(`${repoLabel} result`)} > ${shellQuote(workspaceFile)}`,
      })
    }
    if (calls.length === 2) {
      return toolCallResponse('attempt-third-repository-shell-write', 'bash', {
        description: 'Attempt a write to the unselected third repository.',
        command: `printf forbidden > ${shellQuote(join(thirdPath, thirdFileFromBash))}`,
      })
    }
    if (calls.length === 3) {
      return toolCallResponse('attempt-third-repository-filesystem-write', 'write', {
        file_path: join(thirdPath, thirdFileFromFs),
        content: 'forbidden',
      })
    }
    if (!transcript.toLowerCase().includes('denied') && !transcript.toLowerCase().includes('sandbox')) {
      throw new Error(`${repoLabel} child did not receive a denial for both third-repository writes`)
    }
    return textResponse(
      `${repoLabel} wrote its selected clone; ${thirdFileFromBash} and ${thirdFileFromFs} writes to the third repository were denied.`,
    )
  }

  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(Sandbox)
  await ctx.plugin(SandboxPolicy, { mode: 'workspace-write', workspaceRoot: parentCwd })
  await ctx.plugin(SandboxedFileSystem, { cwd: parentCwd })
  await ctx.plugin(LocalSubprocess)
  await ctx.plugin(ShellEnv)
  await ctx.plugin(SandboxBashExecutor, { cwd: parentCwd, timeoutMs: 30_000 })
  await ctx.plugin(WorkingDirectory)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Subagents)
  await ctx.plugin(Spawn, { providerName: 'spawn' })
  await ctx.plugin(ToolBash)
  await ctx.plugin(ToolFs)
  ctx.provide('workspaceRegistry', { list: () => [alpha, beta, third] } as never)
  await ctx.plugin(ToolMultiRepository)
  ctx.llm.registerAdapter(['mock'], new MockAdapter(Array.from({ length: 20 }, () => handler)))
  ctx.llm.registerAdapter(['single'], new MockAdapter([textResponse('ordinary single-repository child completed')]))

  try {
    enforcement = (await ctx.sandbox.confine(['git', '--version'], {
      mode: 'workspace-write',
      workspaceRoot: alphaPath,
    })).enforcement
    fullEnforcement = enforcement === 'full'
  } catch {
    enforcement = 'unavailable'
  }

  const parent = await ctx.agentLoop.create(parentId, { provider: 'mock', model: 'mock' }, { cwd: parentCwd })
  return { ctx, root, dshHome, alpha, beta, third, alphaHead, betaHead, fullEnforcement, enforcement, parentId, parent }
}

function workspaceRecord(id: string, title: string, path: string): Workspace {
  return { id: WorkspaceId(id), title, path } as never
}

async function initializeRepository(path: string, instructions: string): Promise<string> {
  await writeFile(join(path, 'AGENTS.md'), `${instructions}\n`)
  await writeFile(join(path, 'baseline.txt'), `${instructions}\n`)
  const git = async (...args: string[]): Promise<string> => {
    const windows = process.platform === 'win32'
    const env = gitTestEnvironment(windows)
    const result = await execFileAsync('git', ['-c', `core.hooksPath=${windows ? 'NUL' : '/dev/null'}`, ...args], { cwd: path, env })
    return result.stdout
  }
  await git('init', '-b', 'main')
  await git('add', '--', 'AGENTS.md', 'baseline.txt')
  await git('-c', 'user.name=DSH fixture', '-c', 'user.email=dsh-fixture@example.invalid', 'commit', '--no-gpg-sign', '-m', 'initial state')
  return (await git('rev-parse', 'HEAD')).trim()
}

async function gitAt(cwd: string, ...args: string[]): Promise<string> {
  const windows = process.platform === 'win32'
  const env = gitTestEnvironment(windows)
  const result = await execFileAsync('git', ['-c', `core.hooksPath=${windows ? 'NUL' : '/dev/null'}`, ...args], { cwd, env })
  return result.stdout
}

function gitTestEnvironment(windows: boolean): NodeJS.ProcessEnv {
  const inheritedGitVariables = new Set([
    'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_PREFIX',
    'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  ])
  const env: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !name.startsWith('GIT_CONFIG_') && !inheritedGitVariables.has(name)) env[name] = value
  }
  env.GIT_CONFIG_NOSYSTEM = '1'
  env.GIT_CONFIG_GLOBAL = windows ? 'NUL' : '/dev/null'
  env.GIT_NO_REPLACE_OBJECTS = '1'
  env.GIT_TERMINAL_PROMPT = '0'
  return env
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function toolCalls(options: GenerateOptions): string[] {
  return options.messages.flatMap(message => message.content.flatMap(block => block.type === 'tool-call' ? [block.name] : []))
}

function stringField(record: Record<string, JsonValue>, name: string): string {
  const value = record[name]
  if (typeof value !== 'string') throw new Error(`repository result is missing ${name}`)
  return value
}

function repositoryRows(value: JsonValue | undefined): Record<string, JsonValue>[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.repositories)) {
    throw new Error('multi-repository tool result did not contain repository rows')
  }
  return value.repositories.flatMap(row => row !== null && typeof row === 'object' && !Array.isArray(row) ? [row] : [])
}

async function runParentTurn(parent: Agent): Promise<void> {
  parent.followup(createUserMessage({
    content: [{ type: 'text', text: 'Implement this related coding task in Alpha repo and Beta repo.' }],
    source: { kind: 'user' },
  }))
  await parent.whenIdle()
}

describe('multi-repository workflow', () => {
  it('coordinates two repositories with separate child Sessions and denies an unselected third repository', async ({ skip }) => {
    fixture = await setup()
    if (!fixture.fullEnforcement) skip()
    const started: string[] = []
    const lifecycle: { readonly type: 'start' | 'end'; readonly id: string; readonly runId: string }[] = []
    fixture.ctx.on('subagent/start', ({ id, runId }) => {
      started.push(String(id))
      lifecycle.push({ type: 'start', id: String(id), runId: String(runId) })
    })
    fixture.ctx.on('subagent/end', ({ id, runId }) => {
      lifecycle.push({ type: 'end', id: String(id), runId: String(runId) })
    })
    await runParentTurn(fixture.parent)

    const events = fixture.parent.session.snapshotEvents()
    const coordination = events.find((event): event is SessionEvent<'tool/result'> =>
      event.type === 'tool/result' && event.data.meta !== undefined,
    )
    expect(coordination?.data.message.isError).toBe(false)
    const rows = repositoryRows(coordination?.data.meta)
    expect(rows).toHaveLength(2)
    expect(started).toHaveLength(2)

    const output = coordination!.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
    expect(output).toContain(fixture.alphaHead)
    expect(output).toContain(fixture.betaHead)
    expect(output).toContain(fixture.alpha.path)
    expect(output).toContain(fixture.beta.path)
    expect(output).toContain(thirdFileFromBash)
    expect(output).toContain(thirdFileFromFs)
    expect(output).toContain('?? worker-output.txt')

    const alphaRow = rows[0]!
    const betaRow = rows[1]!
    expect(stringField(alphaRow, 'sourceRoot')).toBe(fixture.alpha.path)
    expect(stringField(betaRow, 'sourceRoot')).toBe(fixture.beta.path)
    const alphaSessionId = SessionId(stringField(alphaRow, 'childSessionId'))
    const betaSessionId = SessionId(stringField(betaRow, 'childSessionId'))
    const alphaRunId = stringField(alphaRow, 'runId')
    const betaRunId = stringField(betaRow, 'runId')
    expect(alphaSessionId).not.toBe(betaSessionId)
    expect(alphaRunId).not.toBe(betaRunId)

    const alphaSession = fixture.ctx.sessions.get(alphaSessionId)
    const betaSession = fixture.ctx.sessions.get(betaSessionId)
    expect(alphaSession?.header.cwd).toBe(stringField(alphaRow, 'cloneRoot'))
    expect(betaSession?.header.cwd).toBe(stringField(betaRow, 'cloneRoot'))
    expect(alphaSession?.header.parentSession).toBe(fixture.parentId)
    expect(betaSession?.header.parentSession).toBe(fixture.parentId)
    expect(lifecycle).toContainEqual({ type: 'start', id: String(alphaSessionId), runId: alphaRunId })
    expect(lifecycle).toContainEqual({ type: 'end', id: String(alphaSessionId), runId: alphaRunId })
    expect(lifecycle).toContainEqual({ type: 'start', id: String(betaSessionId), runId: betaRunId })
    expect(lifecycle).toContainEqual({ type: 'end', id: String(betaSessionId), runId: betaRunId })

    for (const [session, ownMarker, otherMarker] of [
      [alphaSession, 'ALPHA ONLY', 'BETA ONLY'],
      [betaSession, 'BETA ONLY', 'ALPHA ONLY'],
    ] as const) {
      expect(session).toBeDefined()
      const toolResults = session!.snapshotEvents().filter((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result')
      const toolText = toolResults.flatMap(event => event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n')
      expect(toolText).toContain(ownMarker)
      expect(toolText).not.toContain(otherMarker)
      expect(toolResults.filter(event => event.data.message.isError)).toHaveLength(2)
      expect(session!.snapshotEvents().some(event => event.type === 'sandbox/mode'
        && event.data.mode === 'workspace-write' && event.data.source === 'delegation')).toBe(true)
      expect(session!.snapshotEvents().some(event => event.type === 'permission/preset')).toBe(false)
    }

    expect(await readFile(join(stringField(alphaRow, 'cloneRoot'), workspaceFile), 'utf8')).toBe('Alpha repo result')
    expect(await readFile(join(stringField(betaRow, 'cloneRoot'), workspaceFile), 'utf8')).toBe('Beta repo result')
    await expect(readFile(join(fixture.third.path, thirdFileFromBash), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(fixture.third.path, thirdFileFromFs), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await gitAt(fixture.alpha.path, 'status', '--porcelain')).toBe('')
    expect(await gitAt(fixture.beta.path, 'status', '--porcelain')).toBe('')

    const parentOutput = events
      .filter((event): event is SessionEvent<'assistant/message'> => event.type === 'assistant/message')
      .flatMap(event => event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []))
      .at(-1)
    expect(parentOutput).toContain('Alpha repo and Beta repo completed')
    expect((await readdir(fixture.dshHome)).length).toBe(2)
  })

  it('refuses clone setup before child startup when the selected sandbox reports partial enforcement', async ({ skip }) => {
    fixture = await setup()
    if (fixture.enforcement !== 'partial') skip()
    const started: string[] = []
    fixture.ctx.on('subagent/start', ({ id }) => { started.push(String(id)) })
    await runParentTurn(fixture.parent)

    const failures = fixture.parent.session.snapshotEvents().filter((event): event is SessionEvent<'tool/result'> =>
      event.type === 'tool/result' && event.data.message.isError === true,
    )
    expect(failures).toHaveLength(1)
    expect(failures[0]?.data.error?.code).toBe('SANDBOX_ENFORCEMENT_INCOMPLETE')
    expect(started).toEqual([])
    expect(await readdir(fixture.dshHome)).toEqual([])
  }, 30_000)

  it('refuses DSH_HOME inside an unselected Git repository before creating clones', async () => {
    fixture = await setup()
    const thirdHome = join(fixture.third.path, '.dsh-home')
    await mkdir(thirdHome)
    vi.stubEnv('DSH_HOME', thirdHome)
    await runParentTurn(fixture.parent)

    const failures = fixture.parent.session.snapshotEvents().filter((event): event is SessionEvent<'tool/result'> =>
      event.type === 'tool/result' && event.data.message.isError === true,
    )
    expect(failures).toHaveLength(1)
    expect(failures[0]?.data.error?.code).toBe('RUN_HOME_INSIDE_GIT_REPOSITORY')
    expect(await readdir(thirdHome)).toEqual([])
    expect(await readdir(fixture.dshHome)).toEqual([])
  }, 30_000)

  it('keeps an ordinary single-repository in-process subagent working', async () => {
    fixture = await setup()
    const activation = await fixture.ctx.subagents.startActivation({
      provider: 'spawn',
      label: 'single repository task',
      name: 'single-repository-worker',
      parent: fixture.parent,
      prompt: [{ type: 'text', text: 'Return the single-repository result.' }],
      signal: new AbortController().signal,
      delivery: 'caller',
      agentOptions: { provider: 'single', model: 'single' },
    })
    const result = await activation.result
    expect(result.stopReason).toBe('completed')
    expect(result.output).toEqual([{ type: 'text', text: 'ordinary single-repository child completed' }])
    expect(activation.runId).toBeTruthy()
    await activation.dispose()
  })
})
