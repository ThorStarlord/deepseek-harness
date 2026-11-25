import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Peer } from '@deepseek-ai/dsh-client-connection'
import type { PrincipalMap, PeerScope } from '@deepseek-ai/dsh-typert-protocol'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import RemoteAccessService, { type RemoteAccessRole } from '@deepseek-ai/dsh-api-remote-access'
import type {
  SessionPromptRequest,
  SessionRequestId,
  SessionState,
} from '@deepseek-ai/dsh-api-session-controller/types'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { SESSION_FORMAT_VERSION, SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { SessionQueryError, type SessionObservation } from '@deepseek-ai/dsh-session-query'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { Workspace } from '@deepseek-ai/dsh-workspace/types'
import type { SessionPersistenceRevision, SessionPersistenceSnapshot } from '@deepseek-ai/dsh-session-persistence'
import HomeActivityService, { ActivityId } from '../src/index.ts'
import HomeActivityAssociationService from '../src/associations.ts'
import HomeActivityResponsibilityService, { activityResponsibilityRequestId } from '../src/responsibilities.ts'
import type { ActivityResponsibilityId, CreateActivityResponsibilityRequest } from '../src/responsibility-types.ts'
import ActivityCoordinationService from '../src/coordination.ts'
import type { ActivityCoordinationProposalRequest } from '../src/coordination-types.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface PrincipalMap {
    /** Non-owner principal used to verify per-resource Activity filtering. */
    'coord-test': { readonly kind: 'coord-test'; readonly id: string }
  }
}

interface SessionFixture {
  readonly workspaceId: ReturnType<typeof WorkspaceId>
  readonly sessionId: ReturnType<typeof SessionId>
  readonly path: string
  cwd?: string
  observedId?: ReturnType<typeof SessionId>
  missingCwd?: boolean
  origin?: 'subagent'
  source: 'live' | 'prepared'
  cursor: number
  events: readonly SessionEvent[]
  agentStatus?: 'running' | 'idle'
  observationError?: unknown
  observeHook?: (signal: AbortSignal) => Promise<void>
}

interface Harness {
  readonly ctx: Context
  readonly pool: MemoryMediaPool
  readonly fixtures: Map<string, SessionFixture>
  readonly workspaces: Map<ReturnType<typeof WorkspaceId>, Workspace>
  readonly workspaceSessionIds: Map<ReturnType<typeof WorkspaceId>, ReturnType<typeof SessionId>[]>
  readonly observeSession: ReturnType<typeof vi.fn>
  readonly agentLookup: ReturnType<typeof vi.fn>
  readonly sessionState: ReturnType<typeof vi.fn>
  readonly activity: Awaited<ReturnType<typeof makeActivity>>
  readonly route: SessionPromptRoute
  readonly owner: PeerScope
  readonly dispose: () => Promise<void>
}

const roots: Context[] = []
const FIXTURE_WORKSPACE = WorkspaceId('30000000-0000-4000-8000-000000000001')
const TARGET_SESSION = SessionId('20000000-0000-4000-8000-000000000002')
const COORDINATOR_SESSION = SessionId('10000000-0000-4000-8000-000000000001')
const targetFixture: SessionFixture = {
  workspaceId: FIXTURE_WORKSPACE,
  sessionId: TARGET_SESSION,
  path: 'C:\\repos\\target',
  source: 'prepared',
  cursor: 20,
  events: [],
}
const coordinatorFixture: SessionFixture = {
  workspaceId: FIXTURE_WORKSPACE,
  sessionId: COORDINATOR_SESSION,
  path: 'C:\\repos\\target',
  source: 'prepared',
  cursor: 12,
  events: [],
}
let serial = 100

class SessionPromptRoute extends TypertRemoteService {
  readonly prompts: SessionPromptRequest[] = []
  readonly peers: (PeerScope | undefined)[] = []
  result: unknown = { accepted: true }
  error: unknown
  beforeReply: ((signal: AbortSignal) => Promise<void>) | undefined
  onEntered: (() => void) | undefined

  constructor(ctx: Context) {
    super(ctx, 'session')
  }

  @Remote({ resources: { session: request => request.sessionId } })
  async prompt(request: SessionPromptRequest, signal: AbortSignal): Promise<unknown> {
    this.prompts.push(request)
    this.peers.push(this.ctx.invocation?.peer)
    this.onEntered?.()
    if (this.error !== undefined) throw this.error
    await this.beforeReply?.(signal)
    return this.result
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

it('filters Activity catalogs and recovered responsibilities by authenticated resource access', async () => {
  const secondFixture: SessionFixture = {
    workspaceId: WorkspaceId('30000000-0000-4000-8000-000000000003'),
    sessionId: SessionId('20000000-0000-4000-8000-000000000004'),
    path: 'C:\\repos\\second',
    source: 'prepared',
    cursor: 4,
    events: [],
  }
  const { ctx, fixtures, owner } = await harness([coordinatorFixture, targetFixture, secondFixture])
  const visible = await makeActivity(ctx, 'Visible coordination')
  const hidden = await makeActivity(ctx, 'Hidden coordination')
  await link(ctx, visible.id, [coordinatorFixture, targetFixture])
  await link(ctx, hidden.id, [secondFixture])
  const visibleHistory = await createProposal(ctx, visible.id, targetFixture)
  await createProposal(ctx, visible.id, secondFixture)
  const secondWorkspace = fixtures.get(secondFixture.sessionId)?.workspaceId
  if (secondWorkspace === undefined) throw new Error('Second Workspace fixture is missing.')

  const principal: PrincipalMap['coord-test'] = { kind: 'coord-test', id: 'limited' }
  const activityRole: RemoteAccessRole<'activity'> = {
    name: 'test:visible-activity', resource: 'activity',
    actions: ['homeActivityCoordination/activities', 'homeActivityCoordination/responsibilities', 'homeActivityCoordination/responsibility'],
  }
  const workspaceRole: RemoteAccessRole<'workspace'> = {
    name: 'test:visible-workspace', resource: 'workspace',
    actions: ['homeActivityCoordination/activities', 'homeActivityCoordination/responsibilities', 'homeActivityCoordination/responsibility'],
  }
  const sessionRole: RemoteAccessRole<'session'> = {
    name: 'test:visible-session', resource: 'session',
    actions: ['homeActivityCoordination/activities', 'homeActivityCoordination/responsibilities', 'homeActivityCoordination/responsibility'],
  }
  const globalRole: RemoteAccessRole<'global'> = {
    name: 'test:coordination-list', resource: 'global', actions: ['homeActivityCoordination/activities'],
  }
  ctx.remoteAccess.registerPolicy('coord-test', {
    bindings: () => [
      { role: globalRole, resource: { kind: 'global' } },
      { role: activityRole, resource: { kind: 'activity', id: visible.id } },
      { role: workspaceRole, resource: { kind: 'workspace', id: FIXTURE_WORKSPACE } },
      { role: sessionRole, resource: { kind: 'session', id: TARGET_SESSION } },
    ],
  })
  const guest = new Peer(ctx, { principal })
  const catalog = await ctx.typertGateway.invoke({ peer: guest, namespace: 'homeActivityCoordination', method: 'activities', args: {} })
  expect(catalog).toMatchObject([{
    activity: { id: visible.id },
    associations: { workspaceIds: [FIXTURE_WORKSPACE], sessionIds: [TARGET_SESSION] },
  }])
  const histories = await ctx.typertGateway.invoke({
    peer: guest, namespace: 'homeActivityCoordination', method: 'responsibilities', args: { request: { activityId: visible.id } },
  })
  expect(histories).toMatchObject({ items: [{ id: visibleHistory.responsibilityId }] })
  await expect(ctx.typertGateway.invoke({
    peer: guest, namespace: 'homeActivityCoordination', method: 'responsibility',
    args: { request: { activityId: visible.id, responsibilityId: visibleHistory.responsibilityId } },
  })).resolves.toMatchObject({ id: visibleHistory.responsibilityId })
  expect(secondWorkspace).not.toBe(FIXTURE_WORKSPACE)
  const hiddenHistory = await createProposal(ctx, hidden.id, secondFixture)
  await expect(ctx.typertGateway.invoke({
    peer: guest, namespace: 'homeActivityCoordination', method: 'responsibility',
    args: { request: { activityId: hidden.id, responsibilityId: hiddenHistory.responsibilityId } },
  })).rejects.toMatchObject({ code: 'remote-access/denied' })
  await expect(ctx.typertGateway.invoke({
    peer: owner, namespace: 'homeActivityCoordination', method: 'responsibilities', args: { request: { activityId: hidden.id } },
  })).resolves.toMatchObject({ items: [{ id: hiddenHistory.responsibilityId }] })
})

it('accepts only a model-authored source event and rejects invalid coordinating and target identities', async () => {
  const { ctx, fixtures, workspaceSessionIds, route } = await harness([coordinatorFixture, targetFixture])
  const activity = await makeActivity(ctx)
  await link(ctx, activity.id, [coordinatorFixture, targetFixture])
  const source = fixtures.get(COORDINATOR_SESSION)
  if (source === undefined) throw new Error('Coordinator fixture is missing.')
  source.events = [assistantEvent(12, 'Recommend the selected parser task.')]
  const valid = proposalRequest(activity.id)
  const saved = await invoke(ctx, 'propose', valid)
  expect(saved).toMatchObject({ kind: 'proposed', source: { sessionId: COORDINATOR_SESSION, eventSeq: 12 }, proposal: { task: valid.task } })
  expect(route.prompts).toHaveLength(0)

  await expect(invoke(ctx, 'propose', { ...valid, requestId: requestId(), sourceEventSeq: 13 }))
    .rejects.toMatchObject({ code: 'activity-coordination/proposal-invalid' })
  const userEvent = userMessageEvent(14, 'Human text is not a model recommendation.')
  source.events = [userEvent]
  await expect(invoke(ctx, 'propose', { ...valid, requestId: requestId(), sourceEventSeq: 14 }))
    .rejects.toMatchObject({ code: 'activity-coordination/proposal-invalid' })
  source.events = [assistantEvent(12, 'Model output.'), turnEndEvent(13, 1, { kind: 'completed' })]
  await expect(invoke(ctx, 'propose', { ...valid, requestId: requestId(), sourceEventSeq: 13 }))
    .rejects.toMatchObject({ code: 'activity-coordination/proposal-invalid' })

  const rootless = SessionId('10000000-0000-4000-8000-000000000009')
  await expect(invoke(ctx, 'propose', { ...valid, coordinatingSessionId: rootless, requestId: requestId() }))
    .rejects.toMatchObject({ code: 'activity-coordination/context-invalid', details: { reason: 'coordinator-session-unavailable' } })
  source.origin = 'subagent'
  await expect(invoke(ctx, 'propose', { ...valid, requestId: requestId() }))
    .rejects.toMatchObject({ code: 'activity-coordination/context-invalid', details: { reason: 'coordinator-session-unavailable' } })
  delete source.origin
  source.cwd = 'C:\\repos\\other'
  await expect(invoke(ctx, 'propose', { ...valid, requestId: requestId() }))
    .rejects.toMatchObject({ code: 'activity-coordination/context-invalid', details: { reason: 'coordinator-session-unavailable' } })
  delete source.cwd
  const coordinatorMembers = workspaceSessionIds.get(FIXTURE_WORKSPACE)
  if (coordinatorMembers === undefined) throw new Error('Workspace membership fixture is missing.')
  coordinatorMembers.splice(coordinatorMembers.indexOf(COORDINATOR_SESSION), 1)
  await expect(invoke(ctx, 'propose', { ...valid, requestId: requestId() }))
    .rejects.toMatchObject({ code: 'activity-coordination/context-invalid', details: { reason: 'coordinator-session-unavailable' } })
  coordinatorMembers.push(COORDINATOR_SESSION)
  await expect(invoke(ctx, 'propose', { ...valid, coordinatingSessionId: TARGET_SESSION, requestId: requestId() }))
    .rejects.toMatchObject({ code: 'activity-coordination/selection-invalid' })
  await expect(invoke(ctx, 'propose', { ...valid, requestId: requestId(), target: { workspaceId: FIXTURE_WORKSPACE, sessionId: rootless } }))
    .rejects.toMatchObject({ code: 'activity-coordination/context-invalid', details: { reason: 'not-associated' } })
})

it('rechecks Activity, Workspace, Session, source availability, and cancellation before proposal reads', async () => {
  const { ctx, activity, fixtures, workspaces, workspaceSessionIds } = await harness([coordinatorFixture, targetFixture])
  await link(ctx, activity.id, [coordinatorFixture, targetFixture])
  const valid = proposalRequest(activity.id)
  await expect(invoke(ctx, 'propose', { ...valid, activityId: ActivityId('90000000-0000-4000-8000-000000000009') }))
    .rejects.toMatchObject({ code: 'activity-coordination/context-invalid', details: { reason: 'activity-unavailable' } })

  const workspace = workspaces.get(FIXTURE_WORKSPACE)
  if (workspace === undefined) throw new Error('Workspace fixture is missing.')
  workspaces.delete(FIXTURE_WORKSPACE)
  await expect(invoke(ctx, 'propose', valid))
    .rejects.toMatchObject({ code: 'activity-coordination/context-invalid', details: { reason: 'workspace-unavailable' } })
  workspaces.set(FIXTURE_WORKSPACE, workspace)

  const memberIds = workspaceSessionIds.get(FIXTURE_WORKSPACE)
  if (memberIds === undefined) throw new Error('Workspace membership fixture is missing.')
  memberIds.splice(memberIds.indexOf(TARGET_SESSION), 1)
  await expect(invoke(ctx, 'propose', valid))
    .rejects.toMatchObject({ code: 'activity-coordination/context-invalid', details: { reason: 'session-not-in-workspace' } })
  memberIds.push(TARGET_SESSION)

  const target = fixtures.get(TARGET_SESSION)
  if (target === undefined) throw new Error('Target fixture is missing.')
  target.observationError = new SessionQueryError('Session missing.', 'SESSION_QUERY_SESSION_NOT_FOUND')
  await expect(invoke(ctx, 'propose', valid))
    .rejects.toMatchObject({ code: 'activity-coordination/context-invalid', details: { reason: 'session-unavailable' } })
  target.observationError = new Error('Session query failed.')
  await expect(invoke(ctx, 'propose', valid)).rejects.toThrow('Session query failed.')
  target.observationError = undefined

  target.observedId = SessionId('80000000-0000-4000-8000-000000000008')
  await expect(invoke(ctx, 'propose', valid))
    .rejects.toMatchObject({ code: 'activity-coordination/context-invalid', details: { reason: 'repository-mismatch' } })
  delete target.observedId
  target.origin = 'subagent'
  await expect(invoke(ctx, 'propose', valid))
    .rejects.toMatchObject({ code: 'activity-coordination/context-invalid', details: { reason: 'subagent-target' } })
  delete target.origin
  target.missingCwd = true
  await expect(invoke(ctx, 'propose', valid))
    .rejects.toMatchObject({ code: 'activity-coordination/context-invalid', details: { reason: 'repository-mismatch' } })

  const cancel = new AbortController()
  target.observeHook = async () => { cancel.abort(); throw new Error('observation aborted') }
  await expect(invoke(ctx, 'propose', valid, cancel.signal)).rejects.toMatchObject({ code: 'gateway/cancelled' })
})

it('keeps unavailable responsibility identities generic and reconciles without redispatch', async () => {
  const { ctx, activity, fixtures, route } = await harness([coordinatorFixture, targetFixture])
  await link(ctx, activity.id, [coordinatorFixture, targetFixture])
  const proposal = await createProposal(ctx, activity.id, targetFixture)
  const missing = brandString<ActivityResponsibilityId>(requestId())
  await expect(invoke(ctx, 'responsibility', { activityId: activity.id, responsibilityId: missing }))
    .rejects.toMatchObject({ code: 'activity-coordination/responsibility-unavailable' })
  const target = {
    activityId: activity.id,
    responsibilityId: proposal.responsibilityId,
    workspaceId: targetFixture.workspaceId,
    sessionId: TARGET_SESSION,
  }
  await expect(invoke(ctx, 'observeResponsibility', { ...target, workspaceId: WorkspaceId('70000000-0000-4000-8000-000000000007') }))
    .rejects.toMatchObject({ code: 'activity-coordination/responsibility-unavailable' })

  const refused = await createProposal(ctx, activity.id, targetFixture)
  route.error = new RemoteError('session/agent-busy', 'Busy.', { reason: 'busy' })
  const refusedDispatch = await invoke(ctx, 'dispatchConfirmed', dispatchRequest(refused))
  expect(refusedDispatch).toMatchObject({ outcome: 'not-admitted' })
  const noDispatch = await invoke(ctx, 'reconcileResponsibility', {
    ...target,
    responsibilityId: refused.responsibilityId,
  })
  expect(noDispatch).toMatchObject({ reportState: 'no-dispatch' })

  route.error = undefined
  const dispatchable = await createProposal(ctx, activity.id, targetFixture)
  const promptId = brandString<SessionRequestId>(requestId())
  await recordAttempt(ctx, activity.id, dispatchable, promptId, 'accepted')
  const targetState = fixtures.get(TARGET_SESSION)
  if (targetState === undefined) throw new Error('Target fixture is missing.')
  targetState.events = [
    turnStartEvent(60, 8),
    userMessageEvent(61, 'The assignment was admitted.', promptId),
    assistantEvent(62, 'Completed report. ' + 'detail '.repeat(700), 8),
    turnEndEvent(63, 8, { kind: 'completed' }),
  ]
  const first = await invoke(ctx, 'reconcileResponsibility', { ...target, responsibilityId: dispatchable.responsibilityId })
  expect(first).toMatchObject({ reportState: 'reported', report: { summary: expect.stringContaining('Completed report.') } })
  const second = await invoke(ctx, 'reconcileResponsibility', { ...target, responsibilityId: dispatchable.responsibilityId })
  expect(second).toMatchObject({ reportState: 'reported', report: { summary: expect.stringContaining('Completed report.') } })
  expect(route.prompts).toHaveLength(1)
})
it('rejects unavailable discovery resources and preserves cancellation and query failures', async () => {
  const { ctx, activity, fixtures, workspaces, workspaceSessionIds } = await harness([targetFixture])
  await link(ctx, activity.id, [targetFixture])
  const selection = [{ workspaceId: targetFixture.workspaceId, sessionId: TARGET_SESSION }]
  const discover = (activityId = activity.id, targets = selection, signal?: AbortSignal) => invoke(ctx, 'discover', { activityId, targets }, signal)
  await expect(discover(ActivityId('90000000-0000-4000-8000-000000000009')))
    .rejects.toMatchObject({ code: 'activity-coordination/context-invalid', details: { reason: 'activity-unavailable' } })
  const workspace = workspaces.get(FIXTURE_WORKSPACE)
  if (workspace === undefined) throw new Error('Workspace fixture is missing.')
  workspaces.delete(FIXTURE_WORKSPACE)
  await expect(discover()).rejects.toMatchObject({ details: { reason: 'workspace-unavailable' } })
  workspaces.set(FIXTURE_WORKSPACE, workspace)
  const members = workspaceSessionIds.get(FIXTURE_WORKSPACE)
  if (members === undefined) throw new Error('Workspace membership fixture is missing.')
  members.splice(0, 1)
  await expect(discover()).rejects.toMatchObject({ details: { reason: 'session-not-in-workspace' } })
  members.push(TARGET_SESSION)

  const target = fixtures.get(TARGET_SESSION)
  if (target === undefined) throw new Error('Target fixture is missing.')
  target.observationError = new SessionQueryError('Session missing.', 'SESSION_QUERY_SESSION_NOT_FOUND')
  await expect(discover()).rejects.toMatchObject({ details: { reason: 'session-unavailable' } })
  target.observationError = new Error('Query implementation failed.')
  await expect(discover()).rejects.toThrow('Query implementation failed.')

  const alreadyCancelled = new AbortController()
  alreadyCancelled.abort()
  await expect(discover(activity.id, selection, alreadyCancelled.signal)).rejects.toMatchObject({ code: 'gateway/cancelled' })
})
it('presents bounded recent source-attributed text, current cursor, and passive runtime state', async () => {
  const activeTargetFixture = { ...targetFixture, agentStatus: 'running' as const }
  const idleTargetFixture: SessionFixture = {
    ...targetFixture,
    workspaceId: WorkspaceId('30000000-0000-4000-8000-000000000008'),
    sessionId: SessionId('20000000-0000-4000-8000-000000000008'),
    path: 'C:\\repos\\idle-target',
    agentStatus: 'idle',
    events: [reasoningOnlyAssistantEvent(2)],
  }
  const { ctx, fixtures, agentLookup, route } = await harness([activeTargetFixture, idleTargetFixture])
  const activity = await makeActivity(ctx)
  await link(ctx, activity.id, [activeTargetFixture, idleTargetFixture])
  const target = fixtures.get(TARGET_SESSION)
  if (target === undefined) throw new Error('Target fixture is missing.')
  const request = '00000000-0000-4000-8000-000000000440'
  const longText = '🙂'.repeat(1001)
  target.events = [
    turnStartEvent(1, 1),
    assistantEvent(2, longText),
    userMessageEvent(3, 'Recent user context.', request),
    assistantEvent(4, 'A current model report.'),
    assistantEvent(5, '   '),
    reasoningOnlyAssistantEvent(6),
  ]
  target.cursor = 48
  target.agentStatus = 'running'
  const snapshots = await invoke(ctx, 'discover', {
    activityId: activity.id,
    targets: [
      { workspaceId: activeTargetFixture.workspaceId, sessionId: TARGET_SESSION },
      { workspaceId: idleTargetFixture.workspaceId, sessionId: idleTargetFixture.sessionId },
    ],
  })
  expect(snapshots).toMatchObject([{
    cursor: 48,
    runtime: 'running',
    source: 'prepared',
    recentMessages: [
      { role: 'assistant', provider: 'deepseek', model: 'DeepSeek-V4.1-Flash', text: '🙂'.repeat(1000), truncated: true },
      { role: 'user', requestId: request, text: 'Recent user context.', truncated: false },
      { role: 'assistant', text: 'A current model report.', truncated: false },
    ],
  }, { runtime: 'loaded', recentMessages: [] }])
  expect(agentLookup).toHaveBeenCalledWith(TARGET_SESSION)
  expect(agentLookup).toHaveBeenCalledWith(idleTargetFixture.sessionId)
  expect(route.prompts).toEqual([])
})

function reasoningOnlyAssistantEvent(seq: number, turn = 1): SessionEvent<'assistant/message'> {
  return {
    ...assistantEvent(seq, 'discard this visible text', turn),
    data: {
      ...assistantEvent(seq, '', turn).data,
      message: createAssistantMessage({
        content: [{ type: 'reasoning', text: 'This is not visible Session work evidence.' }],
        source: { provider: 'deepseek', model: 'DeepSeek-V4.1-Flash' },
      }),
    },
  }
}

function mixedContentAssistantEvent(seq: number, text: string, turn = 1): SessionEvent<'assistant/message'> {
  return {
    ...assistantEvent(seq, text, turn),
    data: {
      ...assistantEvent(seq, '', turn).data,
      message: createAssistantMessage({
        content: [{ type: 'reasoning', text: 'Private reasoning is not copied into the report.' }, { type: 'text', text }],
        source: { provider: 'deepseek', model: 'DeepSeek-V4.1-Flash' },
      }),
    },
  }
}

it('classifies known admission failures and leaves other provider outcomes uncertain', async () => {
  const { ctx, route, activity } = await harness([coordinatorFixture, targetFixture])
  await link(ctx, activity.id, [coordinatorFixture, targetFixture])
  const cases = [
    { error: new RemoteError('remote-access/denied', 'Denied.', { action: 'session/prompt', reason: 'no-allow' }), outcome: 'not-admitted', diagnostic: 'access-denied' },
    { error: new RemoteError('session/agent-busy', 'Busy.', { reason: 'busy' }), outcome: 'not-admitted', diagnostic: 'target-busy' },
    { error: new RemoteError('session/not-found', 'Missing.', { sessionId: TARGET_SESSION }), outcome: 'not-admitted', diagnostic: 'target-unavailable' },
    { error: new RemoteError('session/attachment-invalid', 'Rejected before admission.', { reason: 'invalid' }), outcome: 'not-admitted', diagnostic: 'delivery-uncertain' },
    { error: new Error('transport ended after request transmission'), outcome: 'uncertain', diagnostic: 'delivery-uncertain' },
  ] as const
  for (const item of cases) {
    route.error = item.error
    const proposal = await createProposal(ctx, activity.id, targetFixture)
    const dispatch = dispatchRequest(proposal)
    const result = await invoke(ctx, 'dispatchConfirmed', dispatch)
    expect(result).toMatchObject({ outcome: item.outcome, diagnostic: item.diagnostic, recorded: true })
    expect(route.prompts.at(-1)).toMatchObject({ sessionId: TARGET_SESSION, requestId: dispatch.promptRequestId })
  }
  route.error = undefined
  route.result = { accepted: false }
  const malformed = await invoke(ctx, 'dispatchConfirmed', dispatchRequest(await createProposal(ctx, activity.id, targetFixture)))
  expect(malformed).toMatchObject({ outcome: 'uncertain', diagnostic: 'delivery-uncertain' })
})

it('does not retry an uncertain delivery or duplicate a send when settlement persistence fails', async () => {
  const { ctx, route, pool, activity } = await harness([coordinatorFixture, targetFixture])
  await link(ctx, activity.id, [coordinatorFixture, targetFixture])
  route.beforeReply = async () => { pool.failNextWrites = 1 }
  const proposal = await createProposal(ctx, activity.id, targetFixture)
  const request = dispatchRequest(proposal)
  const accepted = await invoke(ctx, 'dispatchConfirmed', request)
  expect(accepted).toMatchObject({ outcome: 'accepted', recorded: false, diagnostic: 'history-unconfirmed' })
  expect(route.prompts).toHaveLength(1)
  route.beforeReply = undefined
  const retry = await invoke(ctx, 'dispatchConfirmed', request)
  expect(retry).toMatchObject({ outcome: 'uncertain', recorded: true, diagnostic: 'delivery-uncertain' })
  const differentRequest = { ...request, promptRequestId: brandString<SessionRequestId>(requestId()) }
  await expect(invoke(ctx, 'dispatchConfirmed', differentRequest)).resolves.toMatchObject({ outcome: 'uncertain', recorded: true })
  expect(route.prompts).toHaveLength(1)
})

it('does not send a confirmed responsibility if its Activity disappears before dispatch construction', async () => {
  const { ctx, route, activity } = await harness([coordinatorFixture, targetFixture])
  await link(ctx, activity.id, [coordinatorFixture, targetFixture])
  const proposal = await createProposal(ctx, activity.id, targetFixture)
  const originalGet = ctx.homeActivities.get.bind(ctx.homeActivities)
  let dispatchStarted = false
  const get = vi.spyOn(ctx.homeActivities, 'get').mockImplementation((id) => {
    return dispatchStarted ? undefined : originalGet(id)
  })
  const originalBegin = ctx.homeActivityResponsibilities.beginDispatch.bind(ctx.homeActivityResponsibilities)
  const begin = vi.spyOn(ctx.homeActivityResponsibilities, 'beginDispatch').mockImplementation(async (request) => {
    const fact = await originalBegin(request)
    dispatchStarted = true
    return fact
  })

  try {
    await expect(invoke(ctx, 'dispatchConfirmed', dispatchRequest(proposal)))
      .rejects.toMatchObject({ code: 'activity-coordination/context-invalid', details: { reason: 'activity-unavailable' } })
    expect(route.prompts).toEqual([])
  } finally {
    get.mockRestore()
    begin.mockRestore()
  }
})

it('fails closed when a previously attempted responsibility disappears during duplicate-confirmation inspection', async () => {
  const { ctx, route, activity } = await harness([coordinatorFixture, targetFixture])
  await link(ctx, activity.id, [coordinatorFixture, targetFixture])
  const proposal = await createProposal(ctx, activity.id, targetFixture)
  const promptRequestId = brandString<SessionRequestId>(requestId())
  await recordAttempt(ctx, activity.id, proposal, promptRequestId, 'accepted')
  const originalGet = ctx.homeActivityResponsibilities.get.bind(ctx.homeActivityResponsibilities)
  const get = vi.spyOn(ctx.homeActivityResponsibilities, 'get')
    .mockImplementationOnce(originalGet)
    .mockImplementationOnce(() => undefined)

  try {
    await expect(invoke(ctx, 'dispatchConfirmed', {
      ...dispatchRequest(proposal),
      promptRequestId,
    })).rejects.toMatchObject({ code: 'activity-coordination/responsibility-unavailable' })
    expect(route.prompts).toEqual([])
  } finally {
    get.mockRestore()
  }
})

it('reports missing post-dispatch history after one admitted prompt without attempting another send', async () => {
  const { ctx, route, activity } = await harness([coordinatorFixture, targetFixture])
  await link(ctx, activity.id, [coordinatorFixture, targetFixture])
  const proposal = await createProposal(ctx, activity.id, targetFixture)
  const originalGet = ctx.homeActivityResponsibilities.get.bind(ctx.homeActivityResponsibilities)
  const get = vi.spyOn(ctx.homeActivityResponsibilities, 'get')
    .mockImplementationOnce(originalGet)
    .mockImplementationOnce(() => undefined)

  try {
    await expect(invoke(ctx, 'dispatchConfirmed', dispatchRequest(proposal)))
      .rejects.toMatchObject({ code: 'activity-coordination/responsibility-unavailable' })
    expect(route.prompts).toHaveLength(1)
  } finally {
    get.mockRestore()
  }
})

it('uses an explicit no-conflict statement when dispatching a proposal without known conflicting work', async () => {
  const { ctx, route, activity } = await harness([coordinatorFixture, targetFixture])
  await link(ctx, activity.id, [coordinatorFixture, targetFixture])
  const proposal = await createProposal(ctx, activity.id, targetFixture, [])

  await expect(invoke(ctx, 'dispatchConfirmed', dispatchRequest(proposal))).resolves.toMatchObject({ outcome: 'accepted' })
  expect(route.prompts[0]?.content).toEqual([{
    type: 'text',
    text: expect.stringContaining('Conflicting work to account for: None recorded.'),
  }])
})

it('binds dispatch to the exact saved task and records cancellation as uncertain without retrying', async () => {
  const { ctx, route, activity } = await harness([coordinatorFixture, targetFixture])
  await link(ctx, activity.id, [coordinatorFixture, targetFixture])
  const proposal = await createProposal(ctx, activity.id, targetFixture)
  const request = dispatchRequest(proposal)
  await expect(invoke(ctx, 'dispatchConfirmed', {
    ...request,
    proposal: { ...request.proposal, task: 'A changed task must not be authorized.' },
  })).rejects.toMatchObject({ code: 'activity-coordination/responsibility-unavailable' })
  expect(route.prompts).toHaveLength(0)

  const cancellation = new AbortController()
  route.beforeReply = async (signal) => {
    cancellation.abort()
    signal.throwIfAborted()
  }
  await expect(invoke(ctx, 'dispatchConfirmed', request, cancellation.signal))
    .resolves.toMatchObject({ outcome: 'uncertain', diagnostic: 'delivery-uncertain', recorded: true })
  expect(route.prompts).toHaveLength(1)
  route.beforeReply = undefined
  await expect(invoke(ctx, 'dispatchConfirmed', request)).resolves.toMatchObject({ outcome: 'uncertain' })
  expect(route.prompts).toHaveLength(1)
})
it('propagates an unexpected settlement error without retrying an admitted prompt', async () => {
  const { ctx, route, activity } = await harness([coordinatorFixture, targetFixture])
  await link(ctx, activity.id, [coordinatorFixture, targetFixture])
  const proposal = await createProposal(ctx, activity.id, targetFixture)
  const request = dispatchRequest(proposal)
  const settle = vi.spyOn(ctx.homeActivityResponsibilities, 'settleDispatch')
    .mockRejectedValue(new Error('unexpected settlement failure'))
  await expect(invoke(ctx, 'dispatchConfirmed', request)).rejects.toThrow('unexpected settlement failure')
  expect(route.prompts).toHaveLength(1)
  settle.mockRestore()
  await expect(invoke(ctx, 'dispatchConfirmed', request)).resolves.toMatchObject({ outcome: 'uncertain' })
  expect(route.prompts).toHaveLength(1)
})
it('serializes concurrent confirmations of one responsibility without duplicating the prompt', async () => {
  const { ctx, route, activity } = await harness([coordinatorFixture, targetFixture])
  await link(ctx, activity.id, [coordinatorFixture, targetFixture])
  const proposal = await createProposal(ctx, activity.id, targetFixture)
  const request = dispatchRequest(proposal)
  let release!: () => void
  let entered!: () => void
  const enteredPromise = new Promise<void>((resolve) => { entered = resolve })
  const responseGate = new Promise<void>((resolve) => { release = resolve })
  route.onEntered = entered
  route.beforeReply = async () => await responseGate
  const first = invoke(ctx, 'dispatchConfirmed', request)
  const second = invoke(ctx, 'dispatchConfirmed', request)
  await enteredPromise
  expect(route.prompts).toHaveLength(1)
  release()
  const [firstResult, secondResult] = await Promise.all([first, second])
  expect(firstResult).toMatchObject({ outcome: 'accepted' })
  expect(secondResult).toMatchObject({ outcome: 'accepted' })
  expect(route.prompts).toHaveLength(1)
  expect(route.peers[0]?.principal).toEqual({ kind: 'owner' })
})

it('observes and reconciles target state without activating, retrying, or conflating reports with verification', async () => {
  const { ctx, activity, fixtures, sessionState, route } = await harness([coordinatorFixture, targetFixture])
  await link(ctx, activity.id, [coordinatorFixture, targetFixture])
  const proposal = await createProposal(ctx, activity.id, targetFixture)
  const target = {
    activityId: activity.id,
    responsibilityId: proposal.responsibilityId,
    workspaceId: targetFixture.workspaceId,
    sessionId: TARGET_SESSION,
  }
  const observed = await invoke(ctx, 'observeResponsibility', target)
  expect(observed).toMatchObject({ facts: [{ kind: 'proposed' }, { kind: 'observed', observation: { status: 'available', active: true, running: false } }] })
  expect(sessionState).toHaveBeenCalledWith({ sessionId: TARGET_SESSION }, expect.any(AbortSignal))
  expect(route.prompts).toEqual([])

  const noDispatch = await invoke(ctx, 'reconcileResponsibility', target)
  expect(noDispatch).toMatchObject({ reportState: 'no-dispatch' })
  const dispatchedProposal = await createProposal(ctx, activity.id, targetFixture)
  const promptId = brandString<SessionRequestId>(requestId())
  await recordAttempt(ctx, activity.id, dispatchedProposal, promptId, 'accepted')
  const matchingUser = userMessageEvent(60, 'Confirmed task from the coordinating Session.', promptId)
  const targetFixtureState = fixtures.get(TARGET_SESSION)
  if (targetFixtureState === undefined) throw new Error('Target fixture is missing.')
  targetFixtureState.events = [turnStartEvent(59, 7), matchingUser]
  const pending = await invoke(ctx, 'reconcileResponsibility', {
    ...target,
    responsibilityId: dispatchedProposal.responsibilityId,
  })
  expect(pending).toMatchObject({ reportState: 'awaiting-turn-end' })

  targetFixtureState.events = [turnStartEvent(59, 7), matchingUser, assistantEvent(62, 'Parser work is complete.', 7), turnEndEvent(63, 7, { kind: 'completed' })]
  const reported = await invoke(ctx, 'reconcileResponsibility', { ...target, responsibilityId: dispatchedProposal.responsibilityId })
  expect(reported).toMatchObject({
    reportState: 'reported',
    report: {
      kind: 'reported',
      targetSessionId: TARGET_SESSION,
      sourceEventSeqs: [60, 62, 63],
      summary: 'Parser work is complete.',
    },
  })
  expect(reported).not.toHaveProperty('verification')
  expect(route.prompts).toEqual([])
})

it('retains the last known history when a post-observation history read is temporarily unavailable', async () => {
  const { ctx, activity } = await harness([coordinatorFixture, targetFixture])
  await link(ctx, activity.id, [coordinatorFixture, targetFixture])
  const proposal = await createProposal(ctx, activity.id, targetFixture)
  const request = {
    activityId: activity.id,
    responsibilityId: proposal.responsibilityId,
    workspaceId: targetFixture.workspaceId,
    sessionId: TARGET_SESSION,
  }
  const originalGet = ctx.homeActivityResponsibilities.get.bind(ctx.homeActivityResponsibilities)
  const get = vi.spyOn(ctx.homeActivityResponsibilities, 'get')
    .mockImplementationOnce(originalGet)
    .mockImplementationOnce(() => undefined)

  try {
    await expect(invoke(ctx, 'observeResponsibility', request)).resolves.toMatchObject({ facts: [proposal] })
  } finally {
    get.mockRestore()
  }

  const reconcileGet = vi.spyOn(ctx.homeActivityResponsibilities, 'get')
    .mockImplementationOnce(originalGet)
    .mockImplementationOnce(() => undefined)
  try {
    await expect(invoke(ctx, 'reconcileResponsibility', request)).resolves.toMatchObject({
      history: { facts: [proposal, { kind: 'observed' }] },
      reportState: 'no-dispatch',
    })
  } finally {
    reconcileGet.mockRestore()
  }
})

it('does not report a target outcome when the post-save history read cannot confirm the appended report', async () => {
  const { ctx, activity, fixtures } = await harness([coordinatorFixture, targetFixture])
  await link(ctx, activity.id, [coordinatorFixture, targetFixture])
  const proposal = await createProposal(ctx, activity.id, targetFixture)
  const promptRequestId = brandString<SessionRequestId>(requestId())
  await recordAttempt(ctx, activity.id, proposal, promptRequestId, 'accepted')
  const target = fixtures.get(TARGET_SESSION)
  if (target === undefined) throw new Error('Target fixture is missing.')
  target.events = [
    turnStartEvent(60, 8),
    userMessageEvent(61, 'The assignment was admitted.', promptRequestId),
    mixedContentAssistantEvent(62, 'The target reported a result.', 8),
    turnEndEvent(63, 8, { kind: 'completed' }),
  ]
  const originalGet = ctx.homeActivityResponsibilities.get.bind(ctx.homeActivityResponsibilities)
  let reads = 0
  const get = vi.spyOn(ctx.homeActivityResponsibilities, 'get').mockImplementation((activityId, responsibilityId) => {
    reads += 1
    return reads === 3 ? undefined : originalGet(activityId, responsibilityId)
  })

  try {
    await expect(invoke(ctx, 'reconcileResponsibility', {
      activityId: activity.id,
      responsibilityId: proposal.responsibilityId,
      workspaceId: targetFixture.workspaceId,
      sessionId: TARGET_SESSION,
    })).resolves.toMatchObject({ reportState: 'no-completed-response' })
    expect(get).toHaveBeenCalledTimes(3)
  } finally {
    get.mockRestore()
  }
})

it('uses the last observed history when a pending reconciliation return cannot reread it', async () => {
  const { ctx, activity, fixtures } = await harness([coordinatorFixture, targetFixture])
  await link(ctx, activity.id, [coordinatorFixture, targetFixture])
  const targetState = fixtures.get(TARGET_SESSION)
  if (targetState === undefined) throw new Error('Target fixture is missing.')
  const originalGet = ctx.homeActivityResponsibilities.get.bind(ctx.homeActivityResponsibilities)
  const scenarios: readonly {
    readonly events: (promptId: SessionRequestId) => readonly SessionEvent[]
    readonly reportState: 'awaiting-turn-end' | 'no-completed-response'
  }[] = [
    { events: promptId => [userMessageEvent(60, 'Input only.', promptId)], reportState: 'awaiting-turn-end' },
    { events: promptId => [turnStartEvent(60, 8), userMessageEvent(61, 'Turn started.', promptId)], reportState: 'awaiting-turn-end' },
    { events: promptId => [turnStartEvent(60, 8), userMessageEvent(61, 'Interrupted.', promptId), turnEndEvent(62, 8, { kind: 'interrupted' })], reportState: 'no-completed-response' },
    { events: promptId => [turnStartEvent(60, 8), userMessageEvent(61, 'Completed without text.', promptId), turnEndEvent(62, 8, { kind: 'completed' })], reportState: 'no-completed-response' },
  ]

  for (const scenario of scenarios) {
    const proposal = await createProposal(ctx, activity.id, targetFixture)
    const promptRequestId = brandString<SessionRequestId>(requestId())
    await recordAttempt(ctx, activity.id, proposal, promptRequestId, 'accepted')
    targetState.events = scenario.events(promptRequestId)
    let reads = 0
    const get = vi.spyOn(ctx.homeActivityResponsibilities, 'get').mockImplementation((activityId, responsibilityId) => {
      reads += 1
      return reads === 3 ? undefined : originalGet(activityId, responsibilityId)
    })
    try {
      await expect(invoke(ctx, 'reconcileResponsibility', {
        activityId: activity.id,
        responsibilityId: proposal.responsibilityId,
        workspaceId: targetFixture.workspaceId,
        sessionId: TARGET_SESSION,
      })).resolves.toMatchObject({ reportState: scenario.reportState })
      expect(get).toHaveBeenCalledTimes(3)
    } finally {
      get.mockRestore()
    }
  }
})

it('handles incomplete, interrupted, empty, stale, and cancelled passive reads without fabricating outcomes', async () => {
  const { ctx, activity, fixtures, route, observeSession } = await harness([coordinatorFixture, targetFixture])
  await link(ctx, activity.id, [coordinatorFixture, targetFixture])
  const proposal = await createProposal(ctx, activity.id, targetFixture)
  const promptId = brandString<SessionRequestId>(requestId())
  await recordAttempt(ctx, activity.id, proposal, promptId, undefined)
  const target = {
    activityId: activity.id,
    responsibilityId: proposal.responsibilityId,
    workspaceId: targetFixture.workspaceId,
    sessionId: TARGET_SESSION,
  }
  const state = fixtures.get(TARGET_SESSION)
  if (state === undefined) throw new Error('Target fixture is missing.')
  state.events = []
  await expect(invoke(ctx, 'reconcileResponsibility', target)).resolves.toMatchObject({ reportState: 'awaiting-target-input' })
  state.events = [turnStartEvent(1, 3), userMessageEvent(2, 'The prompt was admitted.', promptId)]
  await expect(invoke(ctx, 'reconcileResponsibility', target)).resolves.toMatchObject({ reportState: 'awaiting-turn-end' })
  state.events = [turnStartEvent(1, 3), userMessageEvent(2, 'The prompt was admitted.', promptId), turnEndEvent(3, 3, { kind: 'interrupted' })]
  await expect(invoke(ctx, 'reconcileResponsibility', target)).resolves.toMatchObject({ reportState: 'no-completed-response' })
  state.events = [turnStartEvent(1, 3), userMessageEvent(2, 'The prompt was admitted.', promptId), turnEndEvent(3, 4, { kind: 'completed' })]
  await expect(invoke(ctx, 'reconcileResponsibility', target)).resolves.toMatchObject({ reportState: 'awaiting-turn-end' })
  state.events = [turnStartEvent(1, 3), userMessageEvent(2, 'The prompt was admitted.', promptId), turnEndEvent(1, 3, { kind: 'completed' })]
  await expect(invoke(ctx, 'reconcileResponsibility', target)).resolves.toMatchObject({ reportState: 'awaiting-turn-end' })
  state.events = [turnStartEvent(1, 3), assistantEvent(2, 'Too early.', 3), userMessageEvent(3, 'The prompt was admitted.', promptId), turnEndEvent(4, 3, { kind: 'completed' })]
  await expect(invoke(ctx, 'reconcileResponsibility', target)).resolves.toMatchObject({ reportState: 'no-completed-response' })
  state.events = [turnStartEvent(1, 3), userMessageEvent(2, 'The prompt was admitted.', promptId), reasoningOnlyAssistantEvent(3, 3), turnEndEvent(4, 3, { kind: 'completed' })]
  await expect(invoke(ctx, 'reconcileResponsibility', target)).resolves.toMatchObject({ reportState: 'no-completed-response' })
  state.events = [turnStartEvent(1, 3), userMessageEvent(2, 'The prompt was admitted.', promptId), turnEndEvent(3, 3, { kind: 'completed' })]
  await expect(invoke(ctx, 'reconcileResponsibility', target)).resolves.toMatchObject({ reportState: 'no-completed-response' })
  state.events = [turnStartEvent(1, 3), userMessageEvent(2, 'The prompt was admitted.', promptId), assistantEvent(3, '   ', 3), turnEndEvent(4, 3, { kind: 'completed' })]
  await expect(invoke(ctx, 'reconcileResponsibility', target)).resolves.toMatchObject({ reportState: 'no-completed-response' })
  state.events = [turnStartEvent(1, 3), userMessageEvent(2, 'The prompt was admitted.', promptId), mixedContentAssistantEvent(3, 'A response with hidden reasoning.', 3), turnEndEvent(4, 3, { kind: 'completed' })]
  await expect(invoke(ctx, 'reconcileResponsibility', target)).resolves.toMatchObject({
    reportState: 'reported',
    report: { summary: 'A response with hidden reasoning.' },
  })
  const unrelatedProposal = await createProposal(ctx, activity.id, targetFixture)
  const unrelatedPromptId = brandString<SessionRequestId>(requestId())
  await recordAttempt(ctx, activity.id, unrelatedProposal, unrelatedPromptId, 'accepted')
  const unrelatedTarget = { ...target, responsibilityId: unrelatedProposal.responsibilityId }
  state.events = [
    turnStartEvent(1, 2), turnEndEvent(2, 2, { kind: 'completed' }),
    userMessageEvent(3, 'The prompt was admitted.', unrelatedPromptId),
    turnStartEvent(4, 3), assistantEvent(5, 'An unrelated later response.', 3),
    turnEndEvent(6, 3, { kind: 'completed' }),
  ]
  await expect(invoke(ctx, 'reconcileResponsibility', unrelatedTarget)).resolves.toMatchObject({ reportState: 'awaiting-turn-end' })
  expect(route.prompts).toEqual([])
  expect(observeSession).toHaveBeenCalled()

  const missingError = new SessionQueryError('Session missing.', 'SESSION_QUERY_SESSION_NOT_FOUND')
  state.observationError = missingError
  await expect(invoke(ctx, 'observeResponsibility', target))
    .rejects.toMatchObject({ code: 'activity-coordination/context-invalid', details: { reason: 'session-unavailable' } })
  state.observationError = undefined
  const cancel = new AbortController()
  state.observeHook = async () => { cancel.abort(); throw new Error('observation aborted') }
  await expect(invoke(ctx, 'discover', {
    activityId: activity.id,
    targets: [{ workspaceId: targetFixture.workspaceId, sessionId: TARGET_SESSION }],
  }, cancel.signal)).rejects.toMatchObject({ code: 'gateway/cancelled' })
  expect(route.prompts).toEqual([])
})

async function harness(sessionFixtures: readonly SessionFixture[]): Promise<Harness> {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(RemoteAccessService)
  await ctx.plugin(TypertGatewayService)
  ctx.typert.resources.register('activity', { field: 'activityId' })
  ctx.typert.resources.register('workspace', { field: 'workspaceId' })
  ctx.typert.resources.register('session', { field: 'sessionId' })
  const fixtures = new Map(sessionFixtures.map(fixture => [fixture.sessionId, { ...fixture }]))
  const workspaces = new Map<ReturnType<typeof WorkspaceId>, Workspace>()
  const workspaceSessionIds = new Map<ReturnType<typeof WorkspaceId>, ReturnType<typeof SessionId>[]>()
  for (const fixture of fixtures.values()) {
    const existing = workspaces.get(fixture.workspaceId)
    const sessionIds = workspaceSessionIds.get(fixture.workspaceId) ?? []
    sessionIds.push(fixture.sessionId)
    workspaceSessionIds.set(fixture.workspaceId, sessionIds)
    workspaces.set(fixture.workspaceId, {
      id: fixture.workspaceId,
      title: existing?.title ?? `Workspace ${workspaces.size + 1}`,
      path: fixture.path,
      createdAt: '2026-11-24T00:00:00.000Z',
      updatedAt: '2026-11-24T00:00:00.000Z',
      sessionIds,
      setTitle: async () => {},
      attachSession: async () => {},
      insertSessionBefore: async () => {},
      detachSession: async () => {},
      status: async () => 'ok',
    })
  }
  ctx.provide('workspaceRegistry', {
    get: (id: ReturnType<typeof WorkspaceId>) => workspaces.get(id),
    list: () => [...workspaces.values()],
  } as never)
  ctx.provide('sessionPersistence', {
    stat: async (id: ReturnType<typeof SessionId>) => fixtures.has(id)
      ? ({ header: { version: SESSION_FORMAT_VERSION, id, createdAt: 1, isSeeded: false }, revision: brandString<SessionPersistenceRevision>(`revision-${id}`) } as SessionPersistenceSnapshot)
      : undefined,
  } as never)
  const observeSession = vi.fn(async (id: ReturnType<typeof SessionId>, options: { readonly signal?: AbortSignal; readonly projectionMode?: 'all' | 'none' }) => {
    options.signal?.throwIfAborted()
    const fixture = fixtures.get(id)
    if (fixture === undefined) throw new SessionQueryError('Session missing.', 'SESSION_QUERY_SESSION_NOT_FOUND')
    if (fixture.observeHook !== undefined) await fixture.observeHook(options.signal ?? new AbortController().signal)
    if (fixture.observationError !== undefined) throw fixture.observationError
    return makeObservation(fixture)
  })
  const agents = new Map<string, { readonly status: string }>()
  for (const fixture of fixtures.values()) {
    if (fixture.agentStatus !== undefined) agents.set(fixture.sessionId, { status: fixture.agentStatus })
  }
  const agentLookup = vi.fn((id: ReturnType<typeof SessionId>) => agents.get(id))
  const sessionState = vi.fn(async (_request: { readonly sessionId: ReturnType<typeof SessionId> }) => ({
    cursor: 80,
    active: true,
    running: false,
    queue: [],
    pendingInput: [],
  } as SessionState))
  ctx.provide('sessionQuery', { observeSession } as never)
  ctx.provide('agents', { get: agentLookup } as never)
  ctx.provide('sessionController', { state: sessionState } as never)
  const pool = new MemoryMediaPool()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(HomeActivityService)
  await ctx.plugin(HomeActivityAssociationService)
  await ctx.plugin(HomeActivityResponsibilityService)
  await ctx.plugin(ActivityCoordinationService)
  await ctx.plugin(SessionPromptRoute)
  const activity = await makeActivity(ctx)
  return {
    ctx, pool, fixtures, workspaces, workspaceSessionIds, observeSession, agentLookup, sessionState, activity,
    route: promptRoute(ctx),
    owner: new Peer(ctx, { principal: { kind: 'owner' } }),
    dispose: async () => await ctx.fiber.dispose(),
  }
}

function makeObservation(fixture: SessionFixture): SessionObservation {
  return {
    source: fixture.source,
    header: {
      version: SESSION_FORMAT_VERSION,
      id: fixture.observedId ?? fixture.sessionId,
      createdAt: 1,
      isSeeded: false,
      ...(!fixture.missingCwd ? { cwd: fixture.cwd ?? fixture.path } : {}),
      ...(fixture.origin === undefined ? {} : { origin: fixture.origin }),
    },
    inheritedEventCount: SessionLogOffset(0),
    events: fixture.events,
    cursor: SessionSeq(fixture.cursor),
    retain: () => makeObservation(fixture),
    [Symbol.dispose]: () => {},
  }
}

async function makeActivity(ctx: Context, name = 'Coordinate independent work') {
  return await ctx.homeActivities.create({
    name,
    objective: 'Coordinate bounded responsibilities across Sessions.',
    boundaries: { inScope: ['Inspect selected Session evidence.'], outOfScope: ['Do not start unrelated work.'] },
  })
}

async function link(ctx: Context, activityId: ReturnType<typeof ActivityId>, fixtures: readonly SessionFixture[]): Promise<void> {
  for (const fixture of fixtures) {
    await ctx.homeActivityAssociations.linkWorkspace(activityId, fixture.workspaceId)
    await ctx.homeActivityAssociations.linkSession(activityId, fixture.sessionId)
  }
}

async function createProposal(
  ctx: Context,
  activityId: ReturnType<typeof ActivityId>,
  target: SessionFixture,
  conflictingWork: readonly string[] = ['Existing parser work must be considered.'],
): Promise<Awaited<ReturnType<typeof ctx.homeActivityResponsibilities.createProposal>>> {
  const request: CreateActivityResponsibilityRequest = {
    activityId,
    requestId: activityResponsibilityRequestId(requestId()),
    coordinatingSessionId: COORDINATOR_SESSION,
    sourceEventSeq: 12,
    target: { workspaceId: target.workspaceId, sessionId: target.sessionId },
    task: 'Implement the bounded parser change and report focused validation.',
    inScope: ['Change the parser.'],
    outOfScope: ['Do not merge or release.'],
    expectedOutcome: 'An attributed report from the target Session.',
    prerequisites: ['Confirm there is no conflicting parser task.'],
    conflictingWork,
  }
  return await ctx.homeActivityResponsibilities.createProposal(request)
}

function proposalRequest(activityId: ReturnType<typeof ActivityId>): ActivityCoordinationProposalRequest {
  return {
    activityId,
    requestId: activityResponsibilityRequestId(requestId()),
    coordinatingSessionId: COORDINATOR_SESSION,
    sourceEventSeq: 12,
    target: { workspaceId: FIXTURE_WORKSPACE, sessionId: TARGET_SESSION },
    task: 'Perform the selected parser task.',
    inScope: ['Change the parser.'],
    outOfScope: ['Do not merge.'],
    expectedOutcome: 'A source-attributed target report.',
    prerequisites: [],
    conflictingWork: [],
  }
}

function dispatchRequest(proposal: Awaited<ReturnType<typeof createProposal>>) {
  return {
    activityId: proposal.activityId,
    responsibilityId: proposal.responsibilityId,
    proposalFactId: proposal.id,
    proposal: proposal.proposal,
    confirmationRequestId: activityResponsibilityRequestId(requestId()),
    promptRequestId: brandString<SessionRequestId>(requestId()),
  }
}

async function recordAttempt(
  ctx: Context,
  activityId: ReturnType<typeof ActivityId>,
  proposal: Awaited<ReturnType<typeof createProposal>>,
  promptRequestId: SessionRequestId,
  outcome: 'accepted' | 'not-admitted' | 'uncertain' | undefined,
): Promise<void> {
  const historyRequestId = activityResponsibilityRequestId(promptRequestId)
  await ctx.homeActivityResponsibilities.confirm({
    activityId,
    responsibilityId: proposal.responsibilityId,
    requestId: activityResponsibilityRequestId(requestId()),
    proposalFactId: proposal.id,
    proposal: proposal.proposal,
    principal: { kind: 'owner' },
  })
  await ctx.homeActivityResponsibilities.beginDispatch({
    activityId,
    responsibilityId: proposal.responsibilityId,
    promptRequestId: historyRequestId,
  })
  if (outcome !== undefined) {
    await ctx.homeActivityResponsibilities.settleDispatch({
      activityId,
      responsibilityId: proposal.responsibilityId,
      promptRequestId: historyRequestId,
      outcome,
    })
  }
}

function promptRoute(ctx: Context): SessionPromptRoute {
  const route = ctx.get('session')
  if (!(route instanceof SessionPromptRoute)) throw new Error('Session prompt route fixture is missing.')
  return route
}

function invoke(ctx: Context, method: string, request?: unknown, signal?: AbortSignal): Promise<unknown> {
  return ctx.typertGateway.invoke({
    peer: new Peer(ctx, { principal: { kind: 'owner' } }),
    namespace: 'homeActivityCoordination',
    method,
    args: request === undefined ? {} : { request },
    ...(signal === undefined ? {} : { signal }),
  })
}

function requestId(): string {
  serial++
  return `00000000-0000-4000-8000-${serial.toString().padStart(12, '0')}`
}

function assistantEvent(seq: number, text: string, turn = 1): SessionEvent<'assistant/message'> {
  return {
    type: 'assistant/message',
    seq: SessionSeq(seq),
    time: 1000 + seq,
    surfaceOp: 'append',
    data: {
      turn,
      step: seq,
      stream: [],
      message: createAssistantMessage({
        content: [{ type: 'text', text }],
        source: { provider: 'deepseek', model: 'DeepSeek-V4.1-Flash' },
      }),
    },
  }
}

function userMessageEvent(seq: number, text: string, rpcId?: string): SessionEvent<'user/message'> {
  return {
    type: 'user/message',
    seq: SessionSeq(seq),
    time: 1000 + seq,
    surfaceOp: 'append',
    data: createUserMessage({
      content: [{ type: 'text', text }],
      source: rpcId === undefined
        ? { kind: 'user' }
        : { kind: 'user', rpcId: brandString<SessionRequestId>(rpcId) },
    }),
  }
}

function turnStartEvent(seq: number, turn: number): SessionEvent<'turn/start'> {
  return { type: 'turn/start', seq: SessionSeq(seq), time: 1000 + seq, data: { turn } }
}

function turnEndEvent(
  seq: number,
  turn: number,
  reason: Extract<SessionEvent<'turn/end'>['data']['reason'], { kind: 'completed' }> | { kind: 'interrupted' },
): SessionEvent<'turn/end'> {
  return { type: 'turn/end', seq: SessionSeq(seq), time: 1000 + seq, data: { turn, reason } }
}
