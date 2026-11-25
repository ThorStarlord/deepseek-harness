import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Peer } from '@deepseek-ai/dsh-client-connection'
import type { PeerScope, PrincipalMap } from '@deepseek-ai/dsh-typert-protocol'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import RemoteAccessService, { type RemoteAccessRole } from '@deepseek-ai/dsh-api-remote-access'
import type { SessionPromptRequest, SessionPromptValue, SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import { brandString } from '@deepseek-ai/dsh-brand'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { SESSION_FORMAT_VERSION, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SessionObservation } from '@deepseek-ai/dsh-session-query'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { Workspace } from '@deepseek-ai/dsh-workspace/types'
import type { SessionPersistenceSnapshot, SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence'
import HomeActivityService from '../src/index.ts'
import HomeActivityAssociationService from '../src/associations.ts'
import HomeActivityResponsibilityService, { activityResponsibilityRequestId } from '../src/responsibilities.ts'
import ActivityCoordinationService from '../src/coordination.ts'
import type { ActivityResponsibilityId, CreateActivityResponsibilityRequest } from '../src/responsibility-types.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface PrincipalMap {
    /** A hostile test Client with explicit resource grants. */
    'coord-test': { readonly kind: 'coord-test'; readonly id: string }
  }
}

const roots: Context[] = []
const coordinatorSessionId = SessionId('10000000-0000-4000-8000-000000000001')
const targetSessionId = SessionId('20000000-0000-4000-8000-000000000002')
const workspaceId = WorkspaceId('30000000-0000-4000-8000-000000000003')
const repositoryPath = 'C:\\coordination-fixture'
const proposalRequest: Omit<CreateActivityResponsibilityRequest, 'activityId' | 'requestId'> = {
  coordinatingSessionId: coordinatorSessionId,
  sourceEventSeq: 15,
  target: { workspaceId, sessionId: targetSessionId },
  task: 'Implement the bounded parser change and report the focused test result.',
  inScope: ['Change the parser.'],
  outOfScope: ['Do not merge or release.'],
  expectedOutcome: 'An attributed result from the target Session.',
  prerequisites: [],
  conflictingWork: ['Check for existing parser work.'],
}

const dispatchAction = 'homeActivityCoordination/dispatchConfirmed'
const promptAction = 'session/prompt'
const guest: PrincipalMap['coord-test'] = { kind: 'coord-test', id: 'limited-client' }

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

it('preserves the authenticated Peer, exact confirmation, and single native prompt admission through the Gateway', async () => {
  const ctx = await harness()
  const activity = await ctx.homeActivities.create({
    name: 'Coordinate parser work',
    objective: 'Complete one bounded parser responsibility.',
    boundaries: { inScope: ['Coordinate selected Sessions.'], outOfScope: ['Do not merge.'] },
  })
  await ctx.homeActivityAssociations.linkWorkspace(activity.id, workspaceId)
  await ctx.homeActivityAssociations.linkSession(activity.id, coordinatorSessionId)
  await ctx.homeActivityAssociations.linkSession(activity.id, targetSessionId)
  const proposal = await ctx.homeActivityResponsibilities.createProposal({
    ...proposalRequest,
    activityId: activity.id,
    requestId: activityResponsibilityRequestId('00000000-0000-4000-8000-000000000501'),
  })
  const request = {
    activityId: activity.id,
    responsibilityId: proposal.responsibilityId,
    proposalFactId: proposal.id,
    proposal: proposal.proposal,
    confirmationRequestId: activityResponsibilityRequestId('00000000-0000-4000-8000-000000000502'),
    promptRequestId: brandString<SessionRequestId>('00000000-0000-4000-8000-000000000503'),
  }
  const activityRole: RemoteAccessRole<'activity'> = {
    name: 'test:activity-coordinator',
    resource: 'activity',
    actions: [dispatchAction],
  }
  const workspaceRole: RemoteAccessRole<'workspace'> = {
    name: 'test:workspace-coordinator',
    resource: 'workspace',
    actions: [dispatchAction],
  }
  const sessionRole: RemoteAccessRole<'session'> = {
    name: 'test:session-coordinator',
    resource: 'session',
    actions: [dispatchAction, promptAction],
  }
  ctx.remoteAccess.registerPolicy('coord-test', {
    bindings: principal => principal.id !== guest.id ? [] : [
      { role: activityRole, resource: { kind: 'activity', id: activity.id } },
      { role: workspaceRole, resource: { kind: 'workspace', id: workspaceId } },
      { role: sessionRole, resource: { kind: 'session', id: targetSessionId } },
    ],
  })

  const peer = new Peer(ctx, { principal: { kind: 'owner' } })
  const accepted = await ctx.typertGateway.invoke({
    peer,
    namespace: 'homeActivityCoordination',
    method: 'dispatchConfirmed',
    args: { request },
  })
  expect(accepted).toMatchObject({
    outcome: 'accepted',
    promptRequestId: request.promptRequestId,
    recorded: true,
    history: {
      facts: [
        { kind: 'proposed' },
        { kind: 'confirmed', actor: { kind: 'authenticated-user', principal: { kind: 'owner' } } },
        { kind: 'dispatch-attempted', promptRequestId: request.promptRequestId },
        { kind: 'dispatch-settled', outcome: 'accepted' },
      ],
    },
  })
  const route = promptRoute(ctx)
  expect(route.prompts).toHaveLength(1)
  expect(route.prompts[0]).toMatchObject({
    requestId: request.promptRequestId,
    sessionId: targetSessionId,
    mode: 'queue',
    content: [{ type: 'text', text: expect.stringContaining(request.proposal.task) }],
  })
  expect(route.peers[0]).toBe(peer)
  expect(route.peers[0]?.principal).toEqual({ kind: 'owner' })

  await expect(ctx.typertGateway.invoke({
    peer,
    namespace: 'homeActivityCoordination',
    method: 'dispatchConfirmed',
    args: { request },
  })).resolves.toMatchObject({ outcome: 'accepted', recorded: true })
  expect(route.prompts).toHaveLength(1)
})

it('denies unselected resources before Host inspection and rejects a non-owner even when its grants would permit dispatch', async () => {
  const ctx = await harness()
  const activity = await ctx.homeActivities.create({
    name: 'Protect target authorization',
    objective: 'Keep assignment scoped to the explicitly selected root Session.',
    boundaries: { inScope: ['Test the Client route.'], outOfScope: ['Do not start unrelated work.'] },
  })
  await ctx.homeActivityAssociations.linkWorkspace(activity.id, workspaceId)
  await ctx.homeActivityAssociations.linkSession(activity.id, coordinatorSessionId)
  await ctx.homeActivityAssociations.linkSession(activity.id, targetSessionId)
  const proposal = await ctx.homeActivityResponsibilities.createProposal({
    ...proposalRequest,
    activityId: activity.id,
    requestId: activityResponsibilityRequestId('00000000-0000-4000-8000-000000000601'),
  })
  const request = {
    activityId: activity.id,
    responsibilityId: proposal.responsibilityId,
    proposalFactId: proposal.id,
    proposal: proposal.proposal,
    confirmationRequestId: activityResponsibilityRequestId('00000000-0000-4000-8000-000000000602'),
    promptRequestId: brandString<SessionRequestId>('00000000-0000-4000-8000-000000000603'),
  }
  const activityRole: RemoteAccessRole<'activity'> = { name: 'test:activity', resource: 'activity', actions: [dispatchAction] }
  const workspaceRole: RemoteAccessRole<'workspace'> = { name: 'test:workspace', resource: 'workspace', actions: [dispatchAction] }
  const sessionRole: RemoteAccessRole<'session'> = { name: 'test:session', resource: 'session', actions: [dispatchAction, promptAction] }
  ctx.remoteAccess.registerPolicy('coord-test', {
    bindings: principal => principal.id === guest.id ? [
      { role: activityRole, resource: { kind: 'activity', id: activity.id } },
      { role: workspaceRole, resource: { kind: 'workspace', id: workspaceId } },
      { role: sessionRole, resource: { kind: 'session', id: targetSessionId } },
    ] : [],
  })

  const deniedTarget = {
    ...request,
    proposal: { ...request.proposal, target: { ...request.proposal.target, sessionId: SessionId('40000000-0000-4000-8000-000000000004') } },
  }
  const guestPeer = new Peer(ctx, { principal: guest })
  await expect(ctx.typertGateway.invoke({
    peer: guestPeer,
    namespace: 'homeActivityCoordination',
    method: 'dispatchConfirmed',
    args: { request: deniedTarget },
  })).rejects.toMatchObject({ code: 'remote-access/denied' })
  expect(ctx.homeActivityResponsibilities.get(activity.id, proposal.responsibilityId)?.facts).toEqual([proposal])
  expect(ctx.sessionQuery.observeSession).not.toHaveBeenCalled()

  await expect(ctx.typertGateway.invoke({
    peer: guestPeer,
    namespace: 'homeActivityCoordination',
    method: 'dispatchConfirmed',
    args: { request },
  })).rejects.toMatchObject({ code: 'gateway/invocation-unavailable' })
  expect(ctx.homeActivityResponsibilities.get(activity.id, proposal.responsibilityId)?.facts).toEqual([proposal])
  expect(promptRoute(ctx).prompts).toHaveLength(0)
})

it('resolves every selected Session resource before a non-owner discovery request is denied', async () => {
  const ctx = await harness()
  const activity = await ctx.homeActivities.create({
    name: 'Check discovery grants',
    objective: 'Keep discovery scoped to each explicitly selected resource.',
    boundaries: { inScope: ['Resolve each selected resource.'], outOfScope: ['Do not inspect a denied Session.'] },
  })
  await ctx.homeActivityAssociations.linkWorkspace(activity.id, workspaceId)
  await ctx.homeActivityAssociations.linkSession(activity.id, coordinatorSessionId)
  await ctx.homeActivityAssociations.linkSession(activity.id, targetSessionId)

  const action = 'homeActivityCoordination/discover'
  const activityRole: RemoteAccessRole<'activity'> = { name: 'test:discovery-activity', resource: 'activity', actions: [action] }
  const workspaceRole: RemoteAccessRole<'workspace'> = { name: 'test:discovery-workspace', resource: 'workspace', actions: [action] }
  ctx.remoteAccess.registerPolicy('coord-test', {
    bindings: principal => principal.id !== guest.id ? [] : [
      { role: activityRole, resource: { kind: 'activity', id: activity.id } },
      { role: workspaceRole, resource: { kind: 'workspace', id: workspaceId } },
    ],
  })

  await expect(ctx.typertGateway.invoke({
    peer: new Peer(ctx, { principal: guest }),
    namespace: 'homeActivityCoordination',
    method: 'discover',
    args: { request: {
      activityId: activity.id,
      targets: [{ workspaceId, sessionId: targetSessionId }],
    } },
  })).rejects.toMatchObject({ code: 'remote-access/denied' })
  expect(ctx.sessionQuery.observeSession).not.toHaveBeenCalled()

  const peer = new Peer(ctx, { principal: guest })
  const responsibilityId = brandString<ActivityResponsibilityId>('50000000-0000-4000-8000-000000000005')
  const requests: readonly { readonly method: string; readonly args: Record<string, unknown> }[] = [
    { method: 'propose', args: { request: {
      ...proposalRequest,
      activityId: activity.id,
      requestId: '00000000-0000-4000-8000-000000000504',
    } } },
    { method: 'responsibilities', args: { request: { activityId: activity.id } } },
    { method: 'responsibility', args: { request: { activityId: activity.id, responsibilityId } } },
    { method: 'observeResponsibility', args: { request: {
      activityId: activity.id,
      responsibilityId,
      workspaceId,
      sessionId: targetSessionId,
    } } },
    { method: 'reconcileResponsibility', args: { request: {
      activityId: activity.id,
      responsibilityId,
      workspaceId,
      sessionId: targetSessionId,
    } } },
  ]
  for (const request of requests) {
    await expect(ctx.typertGateway.invoke({
      peer,
      namespace: 'homeActivityCoordination',
      method: request.method,
      args: request.args,
    })).rejects.toMatchObject({ code: 'remote-access/denied' })
  }
})

async function harness() {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(RemoteAccessService)
  await ctx.plugin(TypertGatewayService)
  ctx.typert.resources.register('activity', { field: 'activityId' })
  ctx.typert.resources.register('workspace', { field: 'workspaceId' })
  ctx.typert.resources.register('session', { field: 'sessionId' })

  const workspace: Workspace = {
    id: workspaceId,
    title: 'Coordination fixture',
    path: repositoryPath,
    createdAt: '2026-11-24T00:00:00.000Z',
    updatedAt: '2026-11-24T00:00:00.000Z',
    sessionIds: [coordinatorSessionId, targetSessionId],
    setTitle: async () => {},
    attachSession: async () => {},
    insertSessionBefore: async () => {},
    detachSession: async () => {},
    status: async () => 'ok',
  }
  ctx.provide('workspaceRegistry', {
    get: (id: WorkspaceId) => id === workspaceId ? workspace : undefined,
    list: () => [workspace],
  } as never)
  ctx.provide('sessionPersistence', {
    stat: async (id: SessionId) => id === coordinatorSessionId || id === targetSessionId
      ? ({ header: { id }, revision: brandString<SessionPersistenceRevision>('revision') } as SessionPersistenceSnapshot)
      : undefined,
  } as never)
  const observeSession = vi.fn(async (id: SessionId) => makeObservation(id))
  ctx.provide('sessionQuery', { observeSession } as never)
  ctx.provide('agents', { get: () => undefined } as never)
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
  return ctx
}

function makeObservation(id: SessionId): SessionObservation {
  return {
    source: 'prepared',
    header: { version: SESSION_FORMAT_VERSION, id, createdAt: 1, cwd: repositoryPath, isSeeded: false },
    inheritedEventCount: SessionLogOffset(0),
    events: [],
    cursor: -1,
    retain: () => makeObservation(id),
    [Symbol.dispose]: () => {},
  }
}

function promptRoute(ctx: Context): SessionPromptRoute {
  const route = ctx.get('session')
  if (!(route instanceof SessionPromptRoute)) throw new Error('Session prompt route fixture is missing.')
  return route
}
