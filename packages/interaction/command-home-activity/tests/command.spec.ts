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
import { brandString } from '@deepseek-ai/dsh-brand'
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
  HomeActivityAssociationError,
  HomeActivityAssociationStorageError,
} from '@deepseek-ai/dsh-home-activity/associations'
import HomeActivityArtifactService from '@deepseek-ai/dsh-home-activity/artifacts'
import HomeActivityHandoffService from '@deepseek-ai/dsh-home-activity/handoffs'
import HomeActivityReviewService, {
  ActivityReviewError,
  ActivityReviewStorageError,
} from '@deepseek-ai/dsh-home-activity/reviews'
import HomeActivityAnnotationService, {
  ActivityAnnotationError,
  ActivityAnnotationStorageError,
} from '@deepseek-ai/dsh-home-activity/annotations'
import type { ActivityAnnotation, ActivityAnnotationId } from '@deepseek-ai/dsh-home-activity/annotations'
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
  await ctx.plugin(HomeActivityReviewService)
  await ctx.plugin(HomeActivityAnnotationService)
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
    'homeActivityAssociations', 'homeActivityArtifacts', 'homeActivityHandoffs',
    'homeActivityReviews', 'homeActivityAnnotations',
    'workspaceRegistry', 'sessionPersistence',
  ])
  const descriptor = test.ctx.commands.list(test.agent).find(command =>
    command.definitionId === '@deepseek-ai/dsh-command-home-activity',
  )
  if (descriptor === undefined) throw new Error('Activity command was not registered')
  expect(descriptor.name).toBe('activity')
  expect(descriptor.description).toContain('DSH-native task')
  expect(descriptor.description).toContain('coordination notes')
  expect(descriptor.description).toContain('one-shot Codex or Claude Code task')
  expect(descriptor.input?.hint).toContain('artifact add <activity-id> <delegation-id> <workspace-id> <JSON>')
  expect(descriptor.input?.hint).toContain('handoff add <activity-id> <JSON>')
  expect(descriptor.input?.hint).toContain('continue <activity-id> spawn|codex|claude-code in-scope:<n> <bounded next step>')
  expect(descriptor.input?.hint).toContain('review set <activity-id> <delegation-id> <JSON>')

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
  expect(opened.text).toContain('In scope 1: Review release notes')
  expect(opened.text).toContain('Out of scope: Do not publish')
  expect(opened.text).toContain('runtime permissions are unchanged')
  expect(test.session.snapshotEvents().filter(event => event.type.startsWith('goal/'))).toEqual([])
  expect(test.session.snapshotEvents().filter(event => event.type === 'turn/start' || event.type === 'turn/end')).toEqual([])
  await test.commandFiber.dispose()
  expect(test.ctx.commands.find(test.agent, 'activity')).toBeUndefined()
})

it('rejects continuation without an explicit existing in-scope selection before starting work', async () => {
  const test = await harness()
  const activity = await test.ctx.homeActivities.create({
    name: 'Release readiness',
    objective: 'Prepare the next release for review.',
    boundaries: { inScope: ['Review the release checklist.'], outOfScope: ['Do not publish.'] },
  })
  const start = vi.spyOn(test.ctx.subagents, 'startActivation')

  const omittedSelection = await run(test, ` continue ${activity.id} spawn Review the release checklist.`)
  const unrelatedSelection = await run(test, ` continue ${activity.id} spawn out-of-scope:1 Publish the release.`)
  const unknownSelection = await run(test, ` continue ${activity.id} spawn in-scope:2 Publish the release.`)

  expect(omittedSelection).toMatchObject({ kind: 'error' })
  expect(omittedSelection.text).toContain('Usage: /activity continue')
  expect(unrelatedSelection).toMatchObject({ kind: 'error' })
  expect(unrelatedSelection.text).toContain('An out-of-scope statement cannot be continued.')
  expect(unknownSelection).toMatchObject({ kind: 'error' })
  expect(unknownSelection.text).toContain('Choose an existing in-scope statement numbered 1–1')
  expect(unknownSelection.text).toContain(`run /activity open ${activity.id} to see the numbered statements`)
  expect(test.ctx.homeActivityDelegations.list(activity.id)).toEqual([])
  expect(start).not.toHaveBeenCalled()
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

it('corrects only the user annotation and shows its history beside the unchanged provider report', async () => {
  const test = await harness()
  const activity = await test.ctx.homeActivities.create({
    name: 'Release review', objective: 'Review the reported release state.',
    boundaries: { inScope: ['Compare provider results with current checks.'], outOfScope: ['Do not release.'] },
  })
  const delegation = await test.ctx.homeActivityDelegations.createRequest({
    activityId: activity.id, provider: 'spawn', task: 'Report release readiness.', parentSessionId: test.session.id,
  })
  const admission = {
    childSessionId: SessionId('annotation-child-session'),
    activationName: 'activity-annotation-review',
    admittedAt: '2026-11-17T00:00:01.000Z',
    source: 'subagents.startActivation' as const,
  }
  await test.ctx.homeActivityDelegations.recordAdmitted(delegation.id, admission)
  const report = await test.ctx.homeActivityDelegations.recordReported(delegation.id, admission, {
    stopReason: 'stop', outputText: 'The build is ready for release.', nonTextBlockTypes: [], outputTruncated: false,
    reportedAt: '2026-11-17T00:00:02.000Z', source: 'subagent-activation-result',
  })
  const startActivation = vi.spyOn(test.ctx.subagents, 'startActivation')
  const beforeCommandEvents = test.session.snapshotEvents().filter(event => event.type === 'turn/start' || event.type === 'turn/end')

  const first = await run(test, ` annotate ${activity.id} {"text":"The release appears ready based on the provider report."}`)
  expect(first.kind).toBe('success')
  expect(first.text).toContain('This starts the annotation history.')
  const correction = await run(test, ` annotate ${activity.id} {"text":"Correction: the release remains blocked because migration validation failed."}`)
  expect(correction.kind).toBe('success')
  expect(correction.text).toContain('revision 2')
  expect(correction.text).toContain('Earlier user annotations remain in history.')
  expect(correction.text).toContain('Provider-reported and specialist-authored facts were not changed.')

  const opened = await run(test, ` open ${activity.id}`, test.secondaryAgent)
  expect(opened.kind).toBe('success')
  expect(opened.text).toContain('Current annotation (revision 2): Correction: the release remains blocked because migration validation failed.')
  expect(opened.text).toContain('Revision 1 (')
  expect(opened.text).toContain('The release appears ready based on the provider report.')
  expect(opened.text).toContain('supersedes')
  expect(opened.text).toContain('Provider-reported output: The build is ready for release.')
  expect(opened.text).toContain('Provider report: received; DSH has not independently verified it.')
  expect(test.ctx.homeActivityDelegations.get(delegation.id)).toEqual(report)
  expect(test.ctx.homeActivityAnnotations.list(activity.id)).toHaveLength(2)
  expect(startActivation).not.toHaveBeenCalled()
  expect(test.session.snapshotEvents().filter(event => event.type === 'turn/start' || event.type === 'turn/end'))
    .toEqual(beforeCommandEvents)
})

it('requires a DSH restart before inspecting annotation history after a write failure', async () => {
  const test = await harness()
  const activity = await test.ctx.homeActivities.create({
    name: 'Write recovery', objective: 'Inspect annotation state after a storage failure.',
    boundaries: { inScope: ['Preserve the saved note.'], outOfScope: ['Do not retry automatically.'] },
  })
  vi.spyOn(test.ctx.homeActivityAnnotations, 'correct').mockRejectedValue(
    new ActivityAnnotationStorageError(new Error('injected storage failure')),
  )

  const result = await run(test, ` annotate ${activity.id} {"text":"A correction."}`)

  expect(result.kind).toBe('error')
  expect(result.text).toContain('persistence may be uncertain')
  expect(result.text).toContain(`Restart DSH, then run /activity open ${activity.id}`)
  expect(result.text).toContain('before deciding whether to retry')
})

it('bounds opened annotation history while retaining the full saved revision list', async () => {
  const test = await harness()
  const activity = await test.ctx.homeActivities.create({
    name: 'Long review history', objective: 'Inspect the latest coordination note.',
    boundaries: { inScope: ['Review saved notes.'], outOfScope: ['Do not execute work.'] },
  })
  const revisions: ActivityAnnotation[] = []
  for (let index = 0; index < 256; index += 1) {
    const previous = revisions.at(-1)
    revisions.push({
      id: brandString<ActivityAnnotationId>(randomUUID()),
      activityId: activity.id,
      revision: index + 1,
      text: `${index + 1}: ${'x'.repeat(3_990)}`,
      ...(previous === undefined ? {} : { supersedes: previous.id }),
      source: 'user-command',
      recordedAt: '2026-11-18T00:00:00.000Z',
    })
  }
  vi.spyOn(test.ctx.homeActivityAnnotations, 'list').mockReturnValue(Object.freeze(revisions))

  const opened = await run(test, ` open ${activity.id}`)

  expect(opened.kind).toBe('success')
  expect(opened.text).toContain('Current annotation (revision 256): 256:')
  expect(opened.text).toContain('248 earlier revisions are saved; this view shows the latest 8.')
  expect(opened.text).toContain('Revision 249 (')
  expect(opened.text).toContain('Revision 256 (')
  expect(opened.text).not.toContain('Revision 248 (')
  expect(opened.text?.length).toBeLessThan(50_000)
})

it('describes the visible annotation subset when the history limit is reached', async () => {
  const test = await harness()
  const activity = await test.ctx.homeActivities.create({
    name: 'Capped review history', objective: 'Keep the visible history limit accurate.',
    boundaries: { inScope: ['Review the current note.'], outOfScope: ['Do not change saved history.'] },
  })
  vi.spyOn(test.ctx.homeActivityAnnotations, 'correct').mockRejectedValue(
    new ActivityAnnotationError('annotation-limit', 'An Activity can have at most 256 annotation revisions.'),
  )

  const result = await run(test, ` annotate ${activity.id} {"text":"A new note."}`)

  expect(result.kind).toBe('error')
  expect(result.text).toContain('An Activity can have at most 256 annotation revisions.')
  expect(result.text).toContain(
    `Run /activity open ${activity.id} to view the current note and latest 8 revisions; older revisions remain saved but are not shown by that command.`,
  )
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
  const workspaceId = '10000000-0000-4000-8000-000000000001'
  const linkWorkspace = vi.spyOn(test.ctx.homeActivityAssociations, 'linkWorkspace').mockRejectedValueOnce(
    new HomeActivityAssociationError(
      'association-limit',
      'An Activity can have at most 256 Workspace references. Remove an existing Workspace reference before adding another.',
    ),
  )

  const result = await run(test, ` link ${activity.id} workspace ${workspaceId}`)
  expect(result).toMatchObject({ kind: 'error' })
  expect(result.text).toContain('An Activity can have at most 256 Workspace references.')
  expect(result.text).toContain(`Run /activity open ${activity.id}`)
  expect(result.text).toContain(`/activity unlink ${activity.id} workspace <workspace-id>`)
  expect(linkWorkspace).toHaveBeenCalledWith(
    ActivityId(activity.id), WorkspaceId(workspaceId),
  )
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
  const activity = await test.ctx.homeActivities.create({
    name: 'Read failure', objective: 'Keep an existing Activity intact.',
    boundaries: { inScope: ['Read saved reports.'], outOfScope: ['Do not start execution.'] },
  })
  vi.spyOn(test.ctx.homeActivityDelegations, 'list').mockImplementation(() => { throw new Error('private provider data') })
  await expect(run(test, ` open ${activity.id}`)).resolves.toEqual({
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

it('keeps a successful provider report separate from failed verification and the user disposition across Sessions', async () => {
  const test = await harness()
  const activity = await test.ctx.homeActivities.create({
    name: 'Release review', objective: 'Review a reported release change.',
    boundaries: { inScope: ['Inspect the report and evidence.'], outOfScope: ['Do not publish the release.'] },
  })
  const delegation = await test.ctx.homeActivityDelegations.createRequest({
    activityId: activity.id,
    provider: 'spawn',
    task: 'Review the release change.',
    parentSessionId: test.session.id,
  })
  const admission = {
    childSessionId: SessionId('review-child'),
    activationName: 'activity-review',
    admittedAt: '2026-11-18T12:00:00.000Z',
    source: 'subagents.startActivation' as const,
  }
  await test.ctx.homeActivityDelegations.recordAdmitted(delegation.id, admission)
  await test.ctx.homeActivityDelegations.recordReported(delegation.id, admission, {
    stopReason: 'stop',
    outputText: 'The provider reported the requested change complete.',
    nonTextBlockTypes: [],
    outputTruncated: false,
    reportedAt: '2026-11-18T12:01:00.000Z',
    source: 'subagent-activation-result',
  })
  const providerReport = test.ctx.homeActivityDelegations.get(delegation.id)
  const startActivation = vi.spyOn(test.ctx.subagents, 'startActivation')

  const initial = await run(test, ` open ${activity.id}`, test.secondaryAgent)
  expect(initial.text).toContain('Delegation state: reported.')
  expect(initial.text).toContain('Provider report: received; DSH has not independently verified it.')
  expect(initial.text).toContain('User disposition: pending; no review has been recorded.')
  expect(initial.text).toContain('Verification evidence: none recorded.')

  const recorded = await run(test, ` review set ${activity.id} ${delegation.id} {"disposition":"requires-investigation","evidence":{"source":"Release CI run","result":"failed","summary":"The publish validation job failed.","reference":"https://example.test/checks/release-validation","observedAt":"2026-11-18T12:02:00.000Z"}}`)
  expect(recorded).toMatchObject({ kind: 'success' })
  expect(recorded.text).toContain('User-supplied evidence recorded: Release CI run reports failed.')
  expect(recorded.text).toContain('DSH did not verify its source or result.')
  expect(recorded.text).toContain('provider execution report was not changed')

  const conflicting = await run(test,
    ` review set ${activity.id} ${delegation.id} {"disposition":"requires-investigation","evidence":{"source":"Independent smoke check","result":"passed","summary":"The smoke check reported success."}}`)
  expect(conflicting.text).toContain('Independent smoke check reports passed.')

  const reopened = await run(test, ` open ${activity.id}`, test.secondaryAgent)
  expect(reopened.text).toContain('Delegation state: reported.')
  expect(reopened.text).toContain('Provider report: received; DSH has not independently verified it.')
  expect(reopened.text).toContain('User disposition: requires investigation')
  expect(reopened.text).toContain('Release CI run reports failed.')
  expect(reopened.text).toContain('The publish validation job failed.')
  expect(reopened.text).toContain('Evidence observed: 2026-11-18T12:02:00.000Z')
  expect(reopened.text).toContain('Independent smoke check reports passed.')
  expect(reopened.text).toContain('The smoke check reported success.')
  expect(reopened.text).toContain('not checked by DSH')
  expect(test.ctx.homeActivityDelegations.get(delegation.id)).toEqual(providerReport)

  const accepted = await run(test, ` review set ${activity.id} ${delegation.id} {"disposition":"accepted"}`)
  expect(accepted.text).toContain('User disposition recorded: accepted.')
  expect(accepted.text).toContain('previously recorded evidence was retained')
  const acceptedView = await run(test, ` open ${activity.id}`, test.secondaryAgent)
  expect(acceptedView.text).toContain('Delegation state: reported.')
  expect(acceptedView.text).toContain('Provider report: received; DSH has not independently verified it.')
  expect(acceptedView.text).toContain('User disposition: accepted')
  expect(acceptedView.text).not.toContain('not verified or accepted')
  expect(acceptedView.text).toContain('Release CI run reports failed.')
  expect(test.ctx.homeActivityDelegations.get(delegation.id)).toEqual(providerReport)
  expect(startActivation).not.toHaveBeenCalled()
})

it('classifies known provider stop reasons and shows report source and freshness', async () => {
  const test = await harness()
  const activity = await test.ctx.homeActivities.create({
    name: 'Provider outcome review', objective: 'Inspect outcome source fields.',
    boundaries: { inScope: ['Compare provider status with its report.'], outOfScope: ['Do not retry work.'] },
  })
  const cases = [
    ['completed', 'provider-reported completion; not independently verified'],
    ['error', 'provider-reported failure; output may be partial'],
    ['aborted', 'provider-reported interruption; output may be partial'],
    ['max-tokens', 'partial output; the provider reached its token limit'],
    ['refusal', 'provider refusal; the requested task was not completed'],
    ['provider-specific-stop', 'unknown; the provider stop reason is not classified'],
  ] as const
  for (const [index, [stopReason]] of cases.entries()) {
    const delegation = await test.ctx.homeActivityDelegations.createRequest({
      activityId: activity.id,
      provider: 'spawn',
      task: `Inspect outcome ${stopReason}.`,
      parentSessionId: test.session.id,
    })
    const admission = {
      childSessionId: SessionId(`outcome-child-${index}`),
      activationName: 'activity-outcome-review',
      admittedAt: `2026-11-18T12:00:${String(index).padStart(2, '0')}.000Z`,
      source: 'subagents.startActivation' as const,
    }
    await test.ctx.homeActivityDelegations.recordAdmitted(delegation.id, admission)
    await test.ctx.homeActivityDelegations.recordReported(delegation.id, admission, {
      stopReason,
      outputText: `Provider output for ${stopReason}.`,
      nonTextBlockTypes: [],
      outputTruncated: false,
      reportedAt: `2026-11-18T12:01:${String(index).padStart(2, '0')}.000Z`,
      source: 'subagent-activation-result',
    })
  }
  const startActivation = vi.spyOn(test.ctx.subagents, 'startActivation')

  const opened = await run(test, ` open ${activity.id}`, test.secondaryAgent)

  for (const [, expected] of cases) expect(opened.text).toContain(`Reported outcome: ${expected}.`)
  expect(opened.text).toContain('Provider report source: subagent-activation-result.')
  expect(opened.text).toContain('Provider report observed at: 2026-11-18T12:01:00.000Z.')
  expect(opened.text).toContain('Freshness: unknown; DSH has no freshness check for this saved report, so it may be stale.')
  expect(opened.text).toContain('Provider stop reason: provider-specific-stop')
  expect(opened.text).toContain('Provider report: received; DSH has not independently verified it.')
  expect(startActivation).not.toHaveBeenCalled()
})

it('distinguishes rejected startup from unknown recovery and records available source times', async () => {
  const test = await harness()
  const activity = await test.ctx.homeActivities.create({
    name: 'Recovered outcomes', objective: 'Inspect unresolved execution facts.',
    boundaries: { inScope: ['Inspect saved outcome facts.'], outOfScope: ['Do not restart them.'] },
  })
  const failed = await test.ctx.homeActivityDelegations.createRequest({
    activityId: activity.id, provider: 'spawn', task: 'Record a rejected start.', parentSessionId: test.session.id,
  })
  await test.ctx.homeActivityDelegations.markNotAdmitted(failed.id, 'The selected provider is unavailable.')
  const uncertain = await test.ctx.homeActivityDelegations.createRequest({
    activityId: activity.id, provider: 'spawn', task: 'Record an uncertain start.', parentSessionId: test.session.id,
  })
  await test.ctx.homeActivityDelegations.markUnconfirmed(uncertain.id, undefined, 'restart-before-admission-recorded')
  const startActivation = vi.spyOn(test.ctx.subagents, 'startActivation')

  const opened = await run(test, ` open ${activity.id}`, test.secondaryAgent)

  expect(opened.text).toContain('Outcome: startup failed before DSH admission; no activation was published.')
  expect(opened.text).toContain('Failure source: subagents.startActivation.')
  expect(opened.text).toContain('Failure observed at: unavailable (the failure time was not recorded).')
  expect(opened.text).toContain('Outcome: unknown; no provider result was recorded.')
  expect(opened.text).toContain('Uncertainty source: application restart recovery.')
  expect(opened.text).toMatch(/Uncertainty observed at: 2026-\d\d-\d\dT/u)
  expect(opened.text).toContain('Opening an Activity displays saved intent and reported facts; it does not start work or activate a Goal.')
  expect(startActivation).not.toHaveBeenCalled()
})

it('does not imply verification evidence exists when recording a disposition alone', async () => {
  const test = await harness()
  const activity = await test.ctx.homeActivities.create({
    name: 'Evidence-free review', objective: 'Review a reported provider result.',
    boundaries: { inScope: ['Inspect the provider report.'], outOfScope: ['Do not rerun the provider.'] },
  })
  const delegation = await test.ctx.homeActivityDelegations.createRequest({
    activityId: activity.id,
    provider: 'spawn',
    task: 'Summarize the requested change.',
    parentSessionId: test.session.id,
  })
  const admission = {
    childSessionId: SessionId('evidence-free-child'),
    activationName: 'activity-review',
    admittedAt: '2026-11-18T12:00:00.000Z',
    source: 'subagents.startActivation' as const,
  }
  await test.ctx.homeActivityDelegations.recordAdmitted(delegation.id, admission)
  await test.ctx.homeActivityDelegations.recordReported(delegation.id, admission, {
    stopReason: 'stop',
    outputText: 'The provider reported completion.',
    nonTextBlockTypes: [],
    outputTruncated: false,
    reportedAt: '2026-11-18T12:01:00.000Z',
    source: 'subagent-activation-result',
  })

  const recorded = await run(test, ` review set ${activity.id} ${delegation.id} {"disposition":"accepted"}`)

  expect(recorded.text).toContain('User disposition recorded: accepted.')
  expect(recorded.text).toContain('No verification evidence is currently recorded.')
  expect(recorded.text).not.toContain('previously recorded evidence was retained')
})

it('validates review commands and reports safe selection, read, and write failures', async () => {
  const test = await harness()
  const activity = await test.ctx.homeActivities.create({
    name: 'Release review', objective: 'Review a reported release change.',
    boundaries: { inScope: ['Inspect the report.'], outOfScope: ['Do not publish.'] },
  })
  const delegation = await test.ctx.homeActivityDelegations.createRequest({
    activityId: activity.id,
    provider: 'spawn',
    task: 'Review the release change.',
    parentSessionId: test.session.id,
  })
  const foreignActivity = await test.ctx.homeActivities.create({
    name: 'Other release', objective: 'Review a separate report.',
    boundaries: { inScope: ['Inspect the other report.'], outOfScope: ['Do not publish.'] },
  })
  const foreignDelegation = await test.ctx.homeActivityDelegations.createRequest({
    activityId: foreignActivity.id,
    provider: 'spawn',
    task: 'Review the other release.',
    parentSessionId: test.session.id,
  })
  const details = '{"disposition":"accepted"}'

  const prematureReview = await run(test, ` review set ${activity.id} ${delegation.id} ${details}`)
  expect(prematureReview.kind).toBe('error')
  expect(prematureReview.text).toContain('A provider report is required before recording a review.')
  expect(prematureReview.text).toContain(`Run /activity open ${activity.id} after its provider report is recorded, then retry the review.`)
  expect(test.ctx.homeActivityReviews.get(activity.id, delegation.id)).toBeUndefined()

  expect((await run(test, ' review')).text).toContain('Usage: /activity review set')
  expect((await run(test, ` review set invalid ${delegation.id} ${details}`)).text).toContain('Activity id must be a UUID.')
  expect((await run(test, ` review set ${activity.id} invalid ${details}`)).text).toContain('Delegation id must be a UUID.')
  expect((await run(test, ` review set ${activity.id} ${delegation.id} {`)).text).toContain('Review details must be valid JSON.')
  expect((await run(test, ` review set ${activity.id} ${delegation.id} {"disposition":"unknown"}`)).text)
    .toContain('Review details are invalid:')
  expect((await run(test, ` review set ${'x'.repeat(16_500)}`)).text).toContain('must not exceed 16384 bytes')
  expect((await run(test, ` create ${'x'.repeat(16_500)}`)).text).toContain('must not exceed 16384 bytes')

  expect((await run(test, ` review set 00000000-0000-4000-8000-000000000098 ${delegation.id} ${details}`)).text)
    .toContain('Run /activity list to choose a saved Activity id.')
  expect((await run(test, ` review set ${activity.id} 00000000-0000-4000-8000-000000000099 ${details}`)).text)
    .toContain(`Run /activity open ${activity.id} to choose a saved delegation id.`)
  expect((await run(test, ` review set ${activity.id} ${foreignDelegation.id} ${details}`)).text)
    .toContain('Choose a delegation recorded for this Activity.')

  const admission = {
    childSessionId: SessionId('review-validation-child'),
    activationName: 'activity-review',
    admittedAt: '2026-11-18T12:00:00.000Z',
    source: 'subagents.startActivation' as const,
  }
  await test.ctx.homeActivityDelegations.recordAdmitted(delegation.id, admission)
  await test.ctx.homeActivityDelegations.recordReported(delegation.id, admission, {
    stopReason: 'stop',
    outputText: 'The provider reported completion.',
    nonTextBlockTypes: [],
    outputTruncated: false,
    reportedAt: '2026-11-18T12:01:00.000Z',
    source: 'subagent-activation-result',
  })

  vi.spyOn(test.ctx.homeActivityReviews, 'record').mockRejectedValueOnce(
    new ActivityReviewError('evidence-limit', 'No further evidence can be added.'),
  )
  expect((await run(test, ` review set ${activity.id} ${delegation.id} ${details}`)).text)
    .toContain(`Inspect saved review evidence with /activity open ${activity.id}.`)
  vi.spyOn(test.ctx.homeActivityReviews, 'record').mockRejectedValueOnce(
    new ActivityReviewStorageError(new Error('private storage path')),
  )
  expect((await run(test, ` review set ${activity.id} ${delegation.id} ${details}`)).text)
    .toContain('Activity review storage failed; no updated review was confirmed.')
  vi.spyOn(test.ctx.homeActivityReviews, 'record').mockRejectedValueOnce(new Error('private service state'))
  expect((await run(test, ` review set ${activity.id} ${delegation.id} ${details}`)).text)
    .toContain('The selected Activity and delegation could not be confirmed; no updated review was recorded.')

  await test.ctx.homeActivityReviews.record({
    activityId: activity.id, delegationId: delegation.id, disposition: 'pending',
  })
  expect((await run(test, ` open ${activity.id}`)).text).toContain('Verification evidence: none recorded.')
  vi.spyOn(test.ctx.homeActivityReviews, 'get').mockImplementationOnce(() => {
    throw new ActivityReviewStorageError(new Error('private storage path'))
  })
  expect((await run(test, ` open ${activity.id}`)).text)
    .toContain('User review state could not be read; no current disposition or evidence was confirmed.')
})
