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
import SessionStore, { SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence'
import type { SessionPersistenceSnapshot } from '@deepseek-ai/dsh-session-persistence'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { Workspace } from '@deepseek-ai/dsh-workspace/types'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { Session } from '@deepseek-ai/dsh-session'
import type { Agent as DshAgent } from '@deepseek-ai/dsh-agent'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import Storage, { StorageError } from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import HomeActivityService, { ActivityError, ActivityId } from '@deepseek-ai/dsh-home-activity'
import HomeActivityDelegations from '@deepseek-ai/dsh-home-activity/delegations'
import HomeActivityAssociationService, {
  HomeActivityAssociationStorageError,
} from '@deepseek-ai/dsh-home-activity/associations'
import HomeActivityArtifactService from '@deepseek-ai/dsh-home-activity/artifacts'
import HomeActivityHandoffService from '@deepseek-ai/dsh-home-activity/handoffs'
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
  await ctx.plugin(HomeActivityArtifactService)
  await ctx.plugin(HomeActivityHandoffService)
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
    'commands', 'homeActivities', 'homeActivityDelegations', 'subagents',
    'homeActivityAssociations', 'homeActivityArtifacts', 'homeActivityHandoffs', 'workspaceRegistry', 'sessionPersistence',
  ])
  const descriptor = test.ctx.commands.list(test.agent).find(command =>
    command.definitionId === '@deepseek-ai/dsh-command-home-activity',
  )
  if (descriptor === undefined) throw new Error('Activity command was not registered')
  expect(descriptor.name).toBe('activity')
  expect(descriptor.description).toContain('DSH-native task')
  expect(descriptor.input?.hint).toContain('artifact add <activity-id> <delegation-id> <workspace-id> <JSON>')
  expect(descriptor.input?.hint).toContain('handoff add <activity-id> <JSON>')

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

it('records user-supplied external handoffs for discovery from another Session without starting native work', async () => {
  const test = await harness()
  const activity = await test.ctx.homeActivities.create({
    name: 'External review', objective: 'Keep the separately obtained review attached.',
    boundaries: { inScope: ['Save the source reference.'], outOfScope: ['Do not import an external transcript.'] },
  })
  const startActivation = vi.spyOn(test.ctx.subagents, 'startActivation')
  const raw = JSON.stringify({
    source: 'Claude Code interface',
    summary: 'The external report recommends reviewing two tests.',
    sourceReference: 'https://example.invalid/review/42',
    artifacts: [{ label: 'Review notes', location: 'reports/review.md', revision: 'a'.repeat(40) }],
  })
  const recorded = await run(test, ` handoff add ${activity.id} ${raw}`)
  expect(recorded.kind).toBe('success')
  expect(recorded.text).toContain('Origin: user-supplied external report')
  expect(recorded.text).toContain(`Recorded in DSH Session: ${test.session.id}`)
  expect(recorded.text).toContain('does not import a native Session or confirm external execution')
  const handoff = test.ctx.homeActivityHandoffs.list(activity.id)[0]
  if (handoff === undefined) throw new Error('The user-supplied handoff was not saved')

  const reopened = await run(test, ` open ${activity.id}`, test.secondaryAgent)
  expect(reopened.kind).toBe('success')
  expect(reopened.text).toContain(`External handoff: Claude Code interface — ${handoff.id}`)
  expect(reopened.text).toContain(`Recorded in DSH Session: ${test.session.id}`)
  expect(reopened.text).toContain('User-supplied source reference: https://example.invalid/review/42')
  expect(reopened.text).toContain('User-supplied artifact reference: Review notes — reports/review.md')
  expect(reopened.text).toContain('not been independently verified or accepted')
  expect(startActivation).not.toHaveBeenCalled()
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

  const firstLink = await run(test, ` link ${activityId} workspace ${firstWorkspace}`, test.secondaryAgent)
  expect(firstLink.kind).toBe('success')
  expect(firstLink.text).toContain('records a reference only')
  await run(test, ` link ${activityId} workspace ${secondWorkspace}`, test.secondaryAgent)
  await run(test, ` link ${activityId} session ${test.session.id}`, test.secondaryAgent)
  await run(test, ` link ${activityId} session ${otherSession}`, test.secondaryAgent)
  const duplicateLink = await run(test, ` link ${activityId} session ${otherSession}`, test.secondaryAgent)
  expect(duplicateLink.kind).toBe('success')
  expect(duplicateLink.text).toContain('already linked')

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

it('reports association limits with a safe recovery command', async () => {
  const test = await harness()
  const activity = await test.ctx.homeActivities.create({
    name: 'Review', objective: 'Review the change.',
    boundaries: { inScope: ['Inspect the patch.'], outOfScope: ['Do not merge.'] },
  })
  const workspaceIds = Array.from({ length: 257 }, (_, index) =>
    `10000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`,
  )
  for (const id of workspaceIds) test.workspaces.set(id, workspace(id, `Project ${id.slice(-4)}`))
  for (const id of workspaceIds.slice(0, 256)) {
    await test.ctx.homeActivityAssociations.linkWorkspace(ActivityId(activity.id), WorkspaceId(id))
  }

  const result = await run(test, ` link ${activity.id} workspace ${workspaceIds[256]}`)
  expect(result).toMatchObject({ kind: 'error' })
  expect(result.text).toContain('An Activity can have at most 256 Workspace references.')
  expect(result.text).toContain(`Run /activity open ${activity.id}`)
  expect(result.text).toContain(`/activity unlink ${activity.id} workspace <workspace-id>`)
})

it('records user-linked artifact pointers for two Workspace contexts and shows absent revisions as unknown', async () => {
  const test = await harness()
  const activity = await test.ctx.homeActivities.create({
    name: 'Two repository review', objective: 'Inspect separately delegated outputs.',
    boundaries: { inScope: ['Review each output in its own Workspace.'], outOfScope: ['Do not merge or release.'] },
  })
  const firstWorkspace = WorkspaceId('00000000-0000-4000-8000-000000000011')
  const secondWorkspace = WorkspaceId('00000000-0000-4000-8000-000000000012')
  await test.ctx.homeActivityAssociations.linkWorkspace(activity.id, firstWorkspace)
  await test.ctx.homeActivityAssociations.linkWorkspace(activity.id, secondWorkspace)
  const firstDelegation = await test.ctx.homeActivityDelegations.createRequest({
    activityId: activity.id, provider: 'spawn', task: 'Inspect repository one output.', parentSessionId: test.session.id,
  })
  const secondDelegation = await test.ctx.homeActivityDelegations.createRequest({
    activityId: activity.id, provider: 'spawn', task: 'Inspect repository two output.', parentSessionId: test.secondarySession.id,
  })
  const eventsBefore = test.session.snapshotEvents()
  const first = await run(test, ` artifact add ${activity.id} ${firstDelegation.id} ${firstWorkspace} {"label":"Repository one report","location":"reports/review.md"}`)
  const second = await run(test, ` artifact add ${activity.id} ${secondDelegation.id} ${secondWorkspace} {"label":"Repository two patch","location":"src/change.ts","revision":"${'b'.repeat(40)}"}`)
  expect(first.kind).toBe('success')
  expect(first.text).toContain('Source revision: unknown')
  expect(first.text).toContain(`Requesting Session: ${test.session.id}`)
  expect(first.text).toContain('This is a user-linked pointer only')
  expect(second.kind).toBe('success')
  expect(second.text).toContain(`User-selected Workspace context: ${secondWorkspace}`)
  expect(second.text).toContain(`Requesting Session: ${test.secondarySession.id}`)
  expect(second.text).toContain('does not verify execution context')
  const eventsAfter = test.session.snapshotEvents()
  expect(eventsAfter.filter(event => !event.type.startsWith('command/')))
    .toEqual(eventsBefore.filter(event => !event.type.startsWith('command/')))

  const opened = await run(test, ` open ${activity.id}`, test.secondaryAgent)
  expect(opened.kind).toBe('success')
  expect(opened.text).toContain(`Workspace: Project one — ${firstWorkspace}`)
  expect(opened.text).toContain(`Workspace: Project two — ${secondWorkspace}`)
  expect(opened.text).toContain(`Delegation: ${firstDelegation.id}`)
  expect(opened.text).toContain(`Delegation: ${secondDelegation.id}`)
  expect(opened.text).toContain(`Requesting Session: ${test.session.id}`)
  expect(opened.text).toContain(`Requesting Session: ${test.secondarySession.id}`)
  expect(opened.text).toContain('execution Workspace unverified')
  expect(opened.text).toContain('Source location: reports/review.md')
  expect(opened.text).toContain(`Source revision: ${'b'.repeat(40)}`)
  expect(opened.text).toContain('Source revision: unknown')
  expect(opened.text).toContain('producer and contents are not independently verified')
  expect(opened.text).not.toContain('user-accepted')
})

it('rejects a pointer whose Workspace is not linked to the Activity', async () => {
  const test = await harness()
  const activity = await test.ctx.homeActivities.create({
    name: 'Workspace ownership', objective: 'Keep references attributed.',
    boundaries: { inScope: ['Record a pointer.'], outOfScope: ['Do not change the source.'] },
  })
  const delegation = await test.ctx.homeActivityDelegations.createRequest({
    activityId: activity.id, provider: 'spawn', task: 'Review output.', parentSessionId: test.session.id,
  })
  const result = await run(test, ` artifact add ${activity.id} ${delegation.id} 00000000-0000-4000-8000-000000000012 {"label":"Misattributed","location":"report.md"}`)
  expect(result).toMatchObject({ kind: 'error' })
  expect(result.text).toContain('Workspace is not linked to this Activity')
  expect(test.ctx.homeActivityArtifacts.list(activity.id)).toEqual([])
})

it('shows a user-selected Workspace separately when it differs from the delegation Session', async () => {
  const test = await harness()
  const activity = await test.ctx.homeActivities.create({
    name: 'Unverified artifact context', objective: 'Keep the source context visible.',
    boundaries: { inScope: ['Record a pointer.'], outOfScope: ['Do not treat a pointer as proof.'] },
  })
  const firstWorkspace = WorkspaceId('00000000-0000-4000-8000-000000000011')
  const secondWorkspace = WorkspaceId('00000000-0000-4000-8000-000000000012')
  await test.ctx.homeActivityAssociations.linkWorkspace(activity.id, firstWorkspace)
  await test.ctx.homeActivityAssociations.linkWorkspace(activity.id, secondWorkspace)
  const delegation = await test.ctx.homeActivityDelegations.createRequest({
    activityId: activity.id, provider: 'spawn', task: 'Inspect a result.', parentSessionId: test.session.id,
  })

  const recorded = await run(
    test,
    ` artifact add ${activity.id} ${delegation.id} ${secondWorkspace} {"label":"User-selected context","location":"report.md"}`,
  )
  expect(recorded.kind).toBe('success')
  const opened = await run(test, ` open ${activity.id}`, test.secondaryAgent)
  expect(opened.text).toContain(`Delegation: ${delegation.id}`)
  expect(opened.text).toContain(`Requesting Session: ${test.session.id}`)
  expect(opened.text).toContain('User-selected Workspace context (execution Workspace unverified): Project two')
  expect(opened.text).toContain('Reference recorded by user command; its producer and contents are not independently verified.')
})

it('separates unknown references from storage failures and supports unlink correction', async () => {
  const test = await harness()
  const activity = await test.ctx.homeActivities.create({
    name: 'Review', objective: 'Review the change.',
    boundaries: { inScope: ['Inspect the patch.'], outOfScope: ['Do not merge.'] },
  })
  const unknownWorkspace = '00000000-0000-4000-8000-000000000099'
  const missingActivity = await run(test, ' link 00000000-0000-4000-8000-000000000098 workspace ' + unknownWorkspace)
  expect(missingActivity.kind).toBe('error')
  expect(missingActivity.text).toContain('Run /activity list')
  const unknownSession = SessionId('unknown-session')
  const missingWorkspace = await run(test, ` link ${activity.id} workspace ${unknownWorkspace}`)
  expect(missingWorkspace.kind).toBe('error')
  expect(missingWorkspace.text).toContain('Run /activity workspaces')
  const missingSession = await run(test, ` link ${activity.id} session ${unknownSession}`)
  expect(missingSession.kind).toBe('error')
  expect(missingSession.text).toContain('Run /activity sessions')
  const firstWorkspace = '00000000-0000-4000-8000-000000000011'
  const replacementWorkspace = '00000000-0000-4000-8000-000000000012'
  await run(test, ` link ${activity.id} workspace ${firstWorkspace}`)
  const unlinked = await run(test, ` unlink ${activity.id} workspace ${firstWorkspace}`)
  expect(unlinked.kind).toBe('success')
  expect(unlinked.text).toContain('Workspace record remain unchanged')
  await run(test, ` link ${activity.id} workspace ${replacementWorkspace}`)
  expect(test.ctx.homeActivities.get(activity.id)).toEqual(activity)
  expect(test.ctx.homeActivityAssociations.get(activity.id)).toEqual({
    workspaceIds: [WorkspaceId(replacementWorkspace)], sessionIds: [],
  })

  vi.spyOn(test.ctx.homeActivityAssociations, 'linkWorkspace').mockRejectedValueOnce(new StorageError('unknown-state', 'private path'))
  const storageFailure = await run(test, ` link ${activity.id} workspace ${replacementWorkspace}`)
  expect(storageFailure.kind).toBe('error')
  expect(storageFailure.text).toContain('Activity association storage failed')
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
