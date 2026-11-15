import { afterEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import { createInboxStub, unsupportedModel } from '@deepseek-ai/dsh-agent-loop-testkit'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence'
import type { SessionPersistenceSnapshot } from '@deepseek-ai/dsh-session-persistence'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { Workspace } from '@deepseek-ai/dsh-workspace/types'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import Storage, { StorageError } from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import HomeActivityService, { ActivityError, ActivityId } from '@deepseek-ai/dsh-home-activity'
import HomeActivityAssociationService, {
  HomeActivityAssociationStorageError,
} from '@deepseek-ai/dsh-home-activity/associations'
import * as commandHomeActivity from '../src/index.ts'

const roots: string[] = []
const contexts: Context[] = []

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
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(HomeActivityService)
  const workspaces = new Map<string, Workspace>([
    ['00000000-0000-4000-8000-000000000011', workspace('00000000-0000-4000-8000-000000000011', 'Project one')],
    ['00000000-0000-4000-8000-000000000012', workspace('00000000-0000-4000-8000-000000000012', 'Project two')],
  ])
  const persistedSessions = new Map<string, SessionPersistenceSnapshot>()
  const persistence = {
    stat: vi.fn(async (id: SessionId) => persistedSessions.get(id)),
    list: vi.fn(async () => [...persistedSessions.values()]),
    open: vi.fn(async () => { throw new Error('Activity commands must not read or write Session logs') }),
  }
  const workspaceRegistry = {
    get: (id: WorkspaceId) => workspaces.get(id),
    list: () => [...workspaces.values()],
  }
  ctx.provide('workspaceRegistry', workspaceRegistry as never)
  ctx.provide('sessionPersistence', persistence as never)
  await ctx.plugin(HomeActivityAssociationService)
  const commandFiber = await ctx.plugin(commandHomeActivity)
  const primary = createAgent(ctx, SessionId(`home-activity-${randomUUID()}`))
  const secondary = createAgent(ctx, SessionId(`home-activity-coordinator-${randomUUID()}`))
  for (const session of [primary.session, secondary.session]) persistedSessions.set(session.id, snapshot(session.id))
  return {
    ctx,
    agent: primary.agent,
    session: primary.session,
    secondaryAgent: secondary.agent,
    secondarySession: secondary.session,
    workspaces,
    persistedSessions,
    persistence,
    workspaceRegistry,
    commandFiber,
  }
}

function createAgent(ctx: Context, id: ReturnType<typeof SessionId>) {
  const session = ctx.sessions.create(id)
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
  return { agent, session }
}

function workspace(id: string, title: string): Workspace {
  return { id: WorkspaceId(id), path: `C:\\projects\\${title}`, title, status: async () => 'ok' } as Workspace
}

function snapshot(id: SessionId): SessionPersistenceSnapshot {
  return {
    header: { version: SESSION_FORMAT_VERSION, id, createdAt: Date.UTC(2026, 10, 15), isSeeded: false, cwd: `C:\\sessions\\${id}` },
    revision: SessionPersistenceRevision(`rev-${id}`),
  }
}

async function run(test: Awaited<ReturnType<typeof harness>>, suffix: string, agent = test.agent) {
  const execution = await test.ctx.commands.execute(
    agent,
    `/activity${suffix}`,
    [],
    new AbortController().signal,
  )
  if (execution === undefined) throw new Error('/activity was not registered')
  return execution.result
}

it('registers a discoverable command and creates, lists, and reopens without starting work', async () => {
  const test = await harness()
  expect(commandHomeActivity.inject).toEqual([
    'commands', 'homeActivities', 'homeActivityAssociations', 'workspaceRegistry', 'sessionPersistence',
  ])
  expect(test.ctx.commands.list(test.agent)).toContainEqual(expect.objectContaining({
    definitionId: '@deepseek-ai/dsh-command-home-activity',
    name: 'activity',
    description: expect.stringContaining('Workspaces or DSH Sessions'),
    input: { hint: 'create <JSON> | list | open <activity-id> | workspaces | sessions | link/unlink <activity-id> workspace|session <context-id>' },
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
  expect(unsupported.text).toContain('link <activity-id> workspace|session <context-id>')
})

it('links selected Workspaces and Sessions independently and reopens them from another Session', async () => {
  const test = await harness()
  const saved = await run(test, ' create {"name":"Release readiness","objective":"Prepare the next release for review.","boundaries":{"inScope":["Review release notes"],"outOfScope":["Do not publish"]}}')
  const activityId = /ID: ([0-9a-f-]{36})/u.exec(saved.text ?? '')?.[1]
  expect(activityId).toBeDefined()
  const beforeSourceEvents = test.session.snapshotEvents()
  const firstWorkspace = '00000000-0000-4000-8000-000000000011'
  const secondWorkspace = '00000000-0000-4000-8000-000000000012'
  const otherSession = SessionId('stored-session-two')
  test.persistedSessions.set(otherSession, snapshot(otherSession))

  const workspaces = await run(test, ' workspaces', test.secondaryAgent)
  expect(workspaces.text).toContain(`Workspace: Project one — ${firstWorkspace}`)
  expect(workspaces.text).toContain(`Workspace: Project two — ${secondWorkspace}`)
  const sessions = await run(test, ' sessions', test.secondaryAgent)
  expect(sessions.text).toContain(`DSH Session: ${test.session.id}`)
  expect(sessions.text).toContain(`DSH Session: ${otherSession}`)

  await expect(run(test, ` link ${activityId} workspace ${firstWorkspace}`, test.secondaryAgent))
    .resolves.toMatchObject({ kind: 'success', text: expect.stringContaining('records a reference only') })
  await run(test, ` link ${activityId} workspace ${secondWorkspace}`, test.secondaryAgent)
  await run(test, ` link ${activityId} session ${test.session.id}`, test.secondaryAgent)
  await run(test, ` link ${activityId} session ${otherSession}`, test.secondaryAgent)
  await expect(run(test, ` link ${activityId} session ${otherSession}`, test.secondaryAgent))
    .resolves.toMatchObject({ kind: 'success', text: expect.stringContaining('already linked') })

  const opened = await run(test, ` open ${activityId}`, test.secondaryAgent)
  expect(opened.kind).toBe('success')
  expect(opened.text).toContain(`Workspace: Project one — ${firstWorkspace}`)
  expect(opened.text).toContain(`Workspace: Project two — ${secondWorkspace}`)
  expect(opened.text).toContain(`DSH Session: ${test.session.id}`)
  expect(opened.text).toContain(`DSH Session: ${otherSession}`)
  expect(opened.text).toContain('these links do not assign Sessions to Workspaces')
  expect(test.session.snapshotEvents()).toEqual(beforeSourceEvents)
  expect(test.persistence.open).not.toHaveBeenCalled()

  test.workspaces.delete(firstWorkspace)
  test.persistedSessions.delete(otherSession)
  const stale = await run(test, ` open ${activityId}`, test.secondaryAgent)
  expect(stale.text).toContain(`Unavailable Workspace: ${firstWorkspace}`)
  expect(stale.text).toContain(`Unavailable DSH Session: ${otherSession}`)
  expect(test.ctx.homeActivityAssociations.get(ActivityId(activityId!))).toMatchObject({
    workspaceIds: [WorkspaceId(firstWorkspace), WorkspaceId(secondWorkspace)],
    sessionIds: [test.session.id, otherSession],
  })
  expect(test.session.snapshotEvents()).toEqual(beforeSourceEvents)
})

it('separates unknown references from storage failures and supports unlink correction', async () => {
  const test = await harness()
  const activity = await test.ctx.homeActivities.create({
    name: 'Review', objective: 'Review the change.',
    boundaries: { inScope: ['Inspect the patch.'], outOfScope: ['Do not merge.'] },
  })
  const unknownWorkspace = '00000000-0000-4000-8000-000000000099'
  await expect(run(test, ' link 00000000-0000-4000-8000-000000000098 workspace ' + unknownWorkspace))
    .resolves.toMatchObject({ kind: 'error', text: expect.stringContaining('Run /activity list') })
  const unknownSession = SessionId('unknown-session')
  await expect(run(test, ` link ${activity.id} workspace ${unknownWorkspace}`))
    .resolves.toMatchObject({ kind: 'error', text: expect.stringContaining('Run /activity workspaces') })
  await expect(run(test, ` link ${activity.id} session ${unknownSession}`))
    .resolves.toMatchObject({ kind: 'error', text: expect.stringContaining('Run /activity sessions') })
  const firstWorkspace = '00000000-0000-4000-8000-000000000011'
  const replacementWorkspace = '00000000-0000-4000-8000-000000000012'
  await run(test, ` link ${activity.id} workspace ${firstWorkspace}`)
  await expect(run(test, ` unlink ${activity.id} workspace ${firstWorkspace}`))
    .resolves.toMatchObject({ kind: 'success', text: expect.stringContaining('Workspace record remain unchanged') })
  await run(test, ` link ${activity.id} workspace ${replacementWorkspace}`)
  expect(test.ctx.homeActivities.get(activity.id)).toEqual(activity)
  expect(test.ctx.homeActivityAssociations.get(activity.id)).toEqual({
    workspaceIds: [WorkspaceId(replacementWorkspace)], sessionIds: [],
  })

  vi.spyOn(test.ctx.homeActivityAssociations, 'linkWorkspace').mockRejectedValueOnce(new StorageError('unknown-state', 'private path'))
  await expect(run(test, ` link ${activity.id} workspace ${replacementWorkspace}`))
    .resolves.toMatchObject({ kind: 'error', text: expect.stringContaining('Activity association storage failed') })
})

it('handles empty catalogs and rejects oversized command input', async () => {
  const test = await harness()
  const empty = await run(test, ' list')
  expect(empty.kind).toBe('success')
  expect(empty.text).toContain('No saved Activities')
  const oversized = await run(test, ` ${'x'.repeat(16_385)}`)
  expect(oversized.kind).toBe('error')
  expect(oversized.text).toContain('must not exceed 16384 bytes')
  const oversizedAssociation = await run(test, ` workspaces ${'x'.repeat(16_385)}`)
  expect(oversizedAssociation.kind).toBe('error')
  expect(oversizedAssociation.text).toContain('must not exceed 16384 bytes')
})

it('renders unavailable, empty, and unreadable Workspace and Session catalogs', async () => {
  const test = await harness()
  const firstWorkspace = test.workspaces.get('00000000-0000-4000-8000-000000000011')!
  vi.spyOn(firstWorkspace, 'status').mockResolvedValue('missing-dir')
  const withoutCwdId = SessionId('session-without-cwd')
  const withoutCwd = snapshot(withoutCwdId)
  const { cwd: _cwd, ...header } = withoutCwd.header
  test.persistedSessions.set(withoutCwdId, { ...withoutCwd, header })

  const workspaces = await run(test, ' workspaces')
  expect(workspaces.text).toContain('Directory status: unavailable.')
  const sessions = await run(test, ' sessions')
  expect(sessions.text).toContain(`DSH Session: ${withoutCwdId}`)
  expect(sessions.text).not.toContain(`Session working directory: C:\\sessions\\${withoutCwdId}`)
  const activity = await test.ctx.homeActivities.create({
    name: 'Review', objective: 'Review the change.',
    boundaries: { inScope: ['Inspect the patch.'], outOfScope: ['Do not merge.'] },
  })
  await test.ctx.homeActivityAssociations.linkWorkspace(activity.id, WorkspaceId(firstWorkspace.id))
  await test.ctx.homeActivityAssociations.linkSession(activity.id, withoutCwdId)
  const opened = await run(test, ` open ${activity.id}`)
  expect(opened.text).toContain('Directory status: unavailable; the Workspace record remains linked.')
  expect(opened.text).not.toContain(`Session working directory: C:\\sessions\\${withoutCwdId}`)

  test.workspaces.clear()
  test.persistedSessions.clear()
  expect((await run(test, ' workspaces')).text).toContain('No Workspaces are registered.')
  expect((await run(test, ' sessions')).text).toContain('No stored DSH Sessions are available.')

  vi.spyOn(test.workspaceRegistry, 'list').mockImplementation(() => { throw new Error('private Workspace path') })
  expect(await run(test, ' workspaces')).toEqual({
    kind: 'error', text: 'The Workspace catalog could not be read; no available contexts were confirmed.',
  })
  vi.spyOn(test.persistence, 'list').mockRejectedValueOnce(new Error('private Session path'))
  expect(await run(test, ' sessions')).toEqual({
    kind: 'error', text: 'The DSH Session catalog could not be read; no available Sessions were confirmed.',
  })
})

it('validates link and unlink identities and reports changed and unchanged results', async () => {
  const test = await harness()
  const activity = await test.ctx.homeActivities.create({
    name: 'Review', objective: 'Review the change.',
    boundaries: { inScope: ['Inspect the patch.'], outOfScope: ['Do not merge.'] },
  })
  const workspaceId = '00000000-0000-4000-8000-000000000011'
  const sessionId = SessionId('session-to-unlink')
  test.persistedSessions.set(sessionId, snapshot(sessionId))

  for (const action of ['link', 'unlink']) {
    expect((await run(test, ` ${action} malformed workspace ${workspaceId}`)).text).toContain('Activity id must be a UUID.')
    expect((await run(test, ` ${action} ${activity.id} workspace invalid`)).text).toContain('Workspace id must be a UUID.')
    expect((await run(test, ` ${action} ${activity.id} session ${'s'.repeat(257)}`)).text)
      .toContain('Session id must be one non-whitespace token of at most 256 characters.')
  }
  expect((await run(test, ' workspaces extra')).text).toContain('Usage: /activity')

  expect((await run(test, ` unlink ${activity.id} workspace ${workspaceId}`)).text).toContain('no context was changed')
  expect((await run(test, ` unlink ${activity.id} session ${sessionId}`)).text).toContain('no context was changed')
  expect((await run(test, ` unlink 00000000-0000-4000-8000-000000000098 session ${sessionId}`)).text)
    .toContain('Run /activity list')
  await run(test, ` link ${activity.id} workspace ${workspaceId}`)
  await run(test, ` link ${activity.id} session ${sessionId}`)
  expect((await run(test, ` unlink ${activity.id} workspace ${workspaceId}`)).text).toContain('Workspace record remain unchanged')
  expect((await run(test, ` unlink ${activity.id} session ${sessionId}`)).text).toContain('Session log remain unchanged')

  vi.spyOn(test.ctx.homeActivityAssociations, 'linkWorkspace').mockRejectedValueOnce(
    new HomeActivityAssociationStorageError(new Error('private storage path')),
  )
  expect((await run(test, ` link ${activity.id} workspace ${workspaceId}`)).text).toContain('Activity association storage failed')
  vi.spyOn(test.ctx.homeActivityAssociations, 'linkWorkspace').mockRejectedValueOnce(new Error('untrusted registry error'))
  expect((await run(test, ` link ${activity.id} workspace ${workspaceId}`)).text)
    .toContain('The selected context could not be verified')
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
    text: 'Activity or context links could not be read; no current link state was confirmed.',
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
