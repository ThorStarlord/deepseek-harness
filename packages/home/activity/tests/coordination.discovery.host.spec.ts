import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Peer } from '@deepseek-ai/dsh-client-connection'
import type { PeerScope } from '@deepseek-ai/dsh-typert-protocol'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import RemoteAccessService from '@deepseek-ai/dsh-api-remote-access'
import type { SessionPromptRequest, SessionPromptValue } from '@deepseek-ai/dsh-api-session-controller/types'
import { brandString } from '@deepseek-ai/dsh-brand'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { SESSION_FORMAT_VERSION, SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionObservation } from '@deepseek-ai/dsh-session-query'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { Workspace } from '@deepseek-ai/dsh-workspace/types'
import type { SessionPersistenceSnapshot, SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence'
import HomeActivityService from '../src/index.ts'
import HomeActivityAssociationService from '../src/associations.ts'
import HomeActivityResponsibilityService from '../src/responsibilities.ts'
import ActivityCoordinationService from '../src/coordination.ts'
import type { ActivityCoordinationTarget } from '../src/coordination-types.ts'

interface TargetFixture {
  readonly workspaceId: ReturnType<typeof WorkspaceId>
  readonly sessionId: ReturnType<typeof SessionId>
  readonly path: string
  readonly cwd?: string
  readonly origin?: 'subagent'
  readonly source: 'live' | 'prepared'
  readonly cursor: number
}

const roots: Context[] = []
const validTargets: readonly TargetFixture[] = [
  { workspaceId: WorkspaceId('30000000-0000-4000-8000-000000000001'), sessionId: SessionId('10000000-0000-4000-8000-000000000001'), path: 'C:\\repos\\alpha', source: 'prepared', cursor: 17 },
  { workspaceId: WorkspaceId('30000000-0000-4000-8000-000000000002'), sessionId: SessionId('20000000-0000-4000-8000-000000000002'), path: 'C:\\repos\\beta', source: 'live', cursor: 28 },
  { workspaceId: WorkspaceId('30000000-0000-4000-8000-000000000003'), sessionId: SessionId('30000000-0000-4000-8000-000000000003'), path: 'C:\\repos\\gamma', source: 'prepared', cursor: 39 },
]
const mismatchTarget: TargetFixture = {
  workspaceId: WorkspaceId('30000000-0000-4000-8000-000000000004'),
  sessionId: SessionId('40000000-0000-4000-8000-000000000004'),
  path: 'C:\\repos\\expected',
  cwd: 'C:\\repos\\different',
  source: 'prepared',
  cursor: 40,
}
const subagentTarget: TargetFixture = {
  workspaceId: WorkspaceId('30000000-0000-4000-8000-000000000005'),
  sessionId: SessionId('50000000-0000-4000-8000-000000000005'),
  path: 'C:\\repos\\subagent',
  origin: 'subagent',
  source: 'prepared',
  cursor: 50,
}

class SessionPromptRoute extends TypertRemoteService {
  readonly prompts: SessionPromptRequest[] = []
  readonly peers: (PeerScope | undefined)[] = []

  constructor(ctx: Context) {
    super(ctx, 'session')
  }

  @Remote({ resources: { session: request => request.sessionId } })
  prompt(request: SessionPromptRequest): SessionPromptValue {
    this.prompts.push(request)
    this.peers.push(this.ctx.invocation?.peer)
    return { accepted: true }
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

it('discovers more than two selected root Sessions in caller order without starting or prompting them', async () => {
  const { ctx, activity, observeSession, agentLookup } = await harness(validTargets)
  const targets = [validTargets[2]!, validTargets[0]!, validTargets[1]!]
  const selected: ActivityCoordinationTarget[] = targets.map(({ workspaceId, sessionId }) => ({ workspaceId, sessionId }))
  const result = await ctx.typertGateway.invoke({
    peer: new Peer(ctx, { principal: { kind: 'owner' } }),
    namespace: 'homeActivityCoordination',
    method: 'discover',
    args: { request: { activityId: activity.id, targets: selected } },
  })

  expect(result).toMatchObject(targets.map(target => ({
    activityId: activity.id,
    workspaceId: target.workspaceId,
    workspacePath: target.path,
    sessionId: target.sessionId,
    sessionCwd: target.path,
    source: target.source,
    cursor: target.cursor,
    runtime: 'not-loaded',
  })))
  expect(observeSession.mock.calls.map(([id]) => id)).toEqual(targets.map(target => target.sessionId))
  expect(observeSession.mock.calls.every(([, options]) => options.projectionMode === 'none')).toBe(true)
  expect(agentLookup.mock.calls.map(([id]) => id)).toEqual(targets.map(target => target.sessionId))
  expect(promptRoute(ctx).prompts).toEqual([])
  expect(ctx.homeActivityAssociations.get(activity.id).sessionIds).toHaveLength(3)
})

it('rejects mismatched, subagent, unlinked, and malformed discovery targets without returning partial results', async () => {
  const linked = [...validTargets, mismatchTarget, subagentTarget]
  const { ctx, activity, observeSession } = await harness(linked)
  const owner = new Peer(ctx, { principal: { kind: 'owner' } })
  const discover = (targets: readonly ActivityCoordinationTarget[]) => ctx.typertGateway.invoke({
    peer: owner,
    namespace: 'homeActivityCoordination',
    method: 'discover',
    args: { request: { activityId: activity.id, targets } },
  })

  await expect(discover([{ workspaceId: mismatchTarget.workspaceId, sessionId: mismatchTarget.sessionId }]))
    .rejects.toMatchObject({ code: 'activity-coordination/context-invalid', details: { reason: 'repository-mismatch' } })
  await expect(discover([{ workspaceId: subagentTarget.workspaceId, sessionId: subagentTarget.sessionId }]))
    .rejects.toMatchObject({ code: 'activity-coordination/context-invalid', details: { reason: 'subagent-target' } })
  const unlinkedSessionId = SessionId('60000000-0000-4000-8000-000000000006')
  await expect(discover([{ workspaceId: validTargets[0]!.workspaceId, sessionId: unlinkedSessionId }]))
    .rejects.toMatchObject({ code: 'activity-coordination/context-invalid', details: { reason: 'not-associated' } })
  const callsBeforeMalformed = observeSession.mock.calls.length
  await expect(discover([
    { workspaceId: validTargets[0]!.workspaceId, sessionId: validTargets[0]!.sessionId },
    { workspaceId: validTargets[0]!.workspaceId, sessionId: validTargets[0]!.sessionId },
  ])).rejects.toMatchObject({ code: 'activity-coordination/selection-invalid' })
  await expect(discover([])).rejects.toMatchObject({ code: 'activity-coordination/selection-invalid' })
  expect(observeSession.mock.calls.length).toBe(callsBeforeMalformed)
  expect(promptRoute(ctx).prompts).toEqual([])
})

async function harness(targets: readonly TargetFixture[]) {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(RemoteAccessService)
  await ctx.plugin(TypertGatewayService)
  ctx.typert.resources.register('activity', { field: 'activityId' })
  ctx.typert.resources.register('workspace', { field: 'workspaceId' })
  ctx.typert.resources.register('session', { field: 'sessionId' })

  const workspaces = new Map(targets.map((target, index) => [target.workspaceId, {
    id: target.workspaceId,
    title: ['Alpha', 'Beta', 'Gamma', 'Mismatch', 'Subagent'][index] ?? 'Fixture',
    path: target.path,
    createdAt: '2026-11-24T00:00:00.000Z',
    updatedAt: '2026-11-24T00:00:00.000Z',
    sessionIds: [target.sessionId],
    setTitle: async () => {},
    attachSession: async () => {},
    insertSessionBefore: async () => {},
    detachSession: async () => {},
    status: async () => 'ok',
  } satisfies Workspace]))
  ctx.provide('workspaceRegistry', {
    get: (id: WorkspaceId) => workspaces.get(id),
    list: () => [...workspaces.values()],
  } as never)
  ctx.provide('sessionPersistence', {
    stat: async (id: SessionId) => targets.some(target => target.sessionId === id)
      ? ({ header: { id }, revision: brandString<SessionPersistenceRevision>(`revision-${id}`) } as SessionPersistenceSnapshot)
      : undefined,
  } as never)
  const observeSession = vi.fn(async (id: SessionId, options: { readonly signal?: AbortSignal; readonly projectionMode?: 'all' | 'none' }) => {
    options.signal?.throwIfAborted()
    const target = targets.find(candidate => candidate.sessionId === id)
    if (target === undefined) throw new Error('Unexpected Session observation')
    return makeObservation(target)
  })
  const agentLookup = vi.fn((_id: SessionId) => undefined)
  ctx.provide('sessionQuery', { observeSession } as never)
  ctx.provide('agents', { get: agentLookup } as never)
  ctx.provide('sessionController', { state: vi.fn() } as never)

  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(HomeActivityService)
  await ctx.plugin(HomeActivityAssociationService)
  await ctx.plugin(HomeActivityResponsibilityService)
  await ctx.plugin(ActivityCoordinationService)
  await ctx.plugin(SessionPromptRoute)

  const activity = await ctx.homeActivities.create({
    name: 'Cross-repository review',
    objective: 'Coordinate selected independent coding Sessions.',
    boundaries: { inScope: ['Read selected Session evidence.'], outOfScope: ['Do not start target work.'] },
  })
  for (const target of targets) {
    await ctx.homeActivityAssociations.linkWorkspace(activity.id, target.workspaceId)
    await ctx.homeActivityAssociations.linkSession(activity.id, target.sessionId)
  }
  return { ctx, activity, observeSession, agentLookup }
}

function makeObservation(target: TargetFixture): SessionObservation {
  return {
    source: target.source,
    header: {
      version: SESSION_FORMAT_VERSION,
      id: target.sessionId,
      createdAt: 1,
      cwd: target.cwd ?? target.path,
      isSeeded: false,
      ...(target.origin === undefined ? {} : { origin: target.origin }),
    },
    inheritedEventCount: SessionLogOffset(0),
    events: [],
    cursor: SessionSeq(target.cursor),
    retain: () => makeObservation(target),
    [Symbol.dispose]: () => {},
  }
}

function promptRoute(ctx: Context): SessionPromptRoute {
  const route = ctx.get('session')
  if (!(route instanceof SessionPromptRoute)) throw new Error('Session prompt route fixture is missing.')
  return route
}
