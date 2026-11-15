import { afterEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import { createInboxStub, unsupportedModel } from '@deepseek-ai/dsh-agent-loop-testkit'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { Session } from '@deepseek-ai/dsh-session'
import type { Agent as DshAgent } from '@deepseek-ai/dsh-agent'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import Storage, { StorageError } from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import HomeActivityService, { ActivityError } from '@deepseek-ai/dsh-home-activity'
import HomeActivityDelegations from '@deepseek-ai/dsh-home-activity/delegations'
import * as commandHomeActivity from '../src/index.ts'

const roots: string[] = []
const contexts: Context[] = []

class FixtureWorkingDirectory extends Service {
  private readonly directories = new WeakMap<Session, string>()

  constructor(ctx: Context) {
    super(ctx, 'workingDirectory')
  }

  get(session: Session): string {
    return this.directories.get(session) ?? session.header.cwd ?? process.cwd()
  }

  async ensure(agent: DshAgent, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    return this.get(agent.session)
  }

  async set(agent: DshAgent, path: string, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    this.directories.set(agent.session, path)
    return path
  }
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-command-')); roots.push(root)
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(FixtureWorkingDirectory)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(HomeActivityService)
  await ctx.plugin(HomeActivityDelegations)
  const commandFiber = await ctx.plugin(commandHomeActivity)
  const session = ctx.sessions.create(SessionId(`home-activity-${randomUUID()}`))
  const inbox = createInboxStub()
  let status: AgentStatus = 'idle'
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    model: unsupportedModel(),
    inbox,
    ctx: new Context(),
    get status() { return status },
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject(input) { this.inbox.append('next-step', input) },
    cancel() { status = 'idle' },
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  ctx.agents.enter(agent)
  return { ctx, agent, session, commandFiber }
}

async function run(test: Awaited<ReturnType<typeof harness>>, suffix: string) {
  const execution = await test.ctx.commands.execute(
    test.agent,
    `/activity${suffix}`,
    [],
    new AbortController().signal,
  )
  if (execution === undefined) throw new Error('/activity was not registered')
  return execution.result
}

it('registers a discoverable command and creates, lists, and reopens without starting work', async () => {
  const test = await harness()
  expect(commandHomeActivity.inject).toEqual(['commands', 'homeActivities', 'homeActivityDelegations', 'subagents'])
  expect(test.ctx.commands.list(test.agent)).toContainEqual(expect.objectContaining({
    definitionId: '@deepseek-ai/dsh-command-home-activity',
    name: 'activity',
    input: { hint: 'create <JSON> | list | open <activity-id> | delegate <activity-id> spawn <task>' },
  }))

  const create = await run(test, ' create {"name":"Release readiness","objective":"Prepare the next release for review.","boundaries":{"inScope":["Review release notes"],"outOfScope":["Do not publish"]}}')
  expect(create.kind).toBe('success')
  expect(create.text).toContain('Saved only; its objective has not been started.')
  const id = /ID: ([0-9a-f-]{36})/u.exec(create.text ?? '')?.[1]
  expect(id).toBeDefined()
  const listed = await run(test, ' list')
  expect(listed.kind).toBe('success')
  expect(listed.text).toContain(`Release readiness — ${id}`)
  const opened = await run(test, ` open ${id}`)
  expect(opened).toMatchObject({ kind: 'success' })
  expect(opened.text).toContain('Objective: Prepare the next release for review.')
  expect(opened.text).toContain('In scope: Review release notes')
  expect(opened.text).toContain('Out of scope: Do not publish')
  expect(opened.text).toContain('runtime permissions are unchanged')
  expect(test.session.snapshotEvents().filter(event => event.type.startsWith('goal/'))).toEqual([])
  expect(test.session.snapshotEvents().filter(event => event.type === 'turn/start' || event.type === 'turn/end')).toEqual([])
  await test.commandFiber.dispose()
  expect(test.ctx.commands.find(test.agent, 'activity')).toBeUndefined()
})

it('rejects invalid JSON, missing scope, malformed ids, and unknown Activities clearly', async () => {
  const test = await harness()
  const invalidJson = await run(test, ' create {')
  expect(invalidJson.kind).toBe('error')
  expect(invalidJson.text).toContain('valid JSON')
  const missingScope = await run(test, ' create {"name":"x","objective":"y","boundaries":{"inScope":[],"outOfScope":[]}}')
  expect(missingScope.kind).toBe('error')
  expect(missingScope.text).toContain('invalid')
  const malformedId = await run(test, ' open nope')
  expect(malformedId.kind).toBe('error')
  expect(malformedId.text).toContain('UUID')
  const unknownActivity = await run(test, ' open 00000000-0000-4000-8000-000000000000')
  expect(unknownActivity.kind).toBe('error')
  expect(unknownActivity.text).toContain('No saved Activity')
  const unsupported = await run(test, ' delete all')
  expect(unsupported.kind).toBe('error')
  expect(unsupported.text).toContain('Usage: /activity')
})

it('handles empty catalogs and rejects oversized command input', async () => {
  const test = await harness()
  const empty = await run(test, ' list')
  expect(empty.kind).toBe('success')
  expect(empty.text).toContain('No saved Activities')
  const oversized = await run(test, ` ${'x'.repeat(16_385)}`)
  expect(oversized.kind).toBe('error')
  expect(oversized.text).toContain('must not exceed 16384 bytes')
})

it('returns expected Activity errors and a safe message for other create failures', async () => {
  const test = await harness()
  vi.spyOn(test.ctx.homeActivities, 'create').mockRejectedValueOnce(new ActivityError('invalid-request', 'specific validation failure'))
  await expect(run(test, ' create {"name":"x","objective":"y","boundaries":{"inScope":["z"],"outOfScope":[]}}'))
    .resolves.toEqual({ kind: 'error', text: 'specific validation failure' })
  vi.spyOn(test.ctx.homeActivities, 'create').mockRejectedValueOnce(new Error('private storage location'))
  await expect(run(test, ' create {"name":"x","objective":"y","boundaries":{"inScope":["z"],"outOfScope":[]}}'))
    .resolves.toEqual({
      kind: 'error',
      text: 'Activity could not be saved. Run /activity list before retrying.',
    })
})

it('does not expose details when Activity reads fail', async () => {
  const test = await harness()
  vi.spyOn(test.ctx.homeActivities, 'list').mockImplementation(() => { throw new Error('private storage location') })
  await expect(run(test, ' list')).resolves.toEqual({
    kind: 'error',
    text: 'Activity storage could not be read; no saved details were confirmed.',
  })
})

it('reports an ambiguous storage failure with a safe list-before-retry instruction', async () => {
  const test = await harness()
  vi.spyOn(test.ctx.homeActivities, 'create').mockRejectedValue(new StorageError('unknown-state', 'private storage path'))
  await expect(run(test, ' create {"name":"x","objective":"y","boundaries":{"inScope":["z"],"outOfScope":[]}}'))
    .resolves.toEqual({
      kind: 'error',
      text: 'Activity storage could not confirm the save. Run /activity list before retrying.',
    })
})
