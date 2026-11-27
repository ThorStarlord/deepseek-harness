import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import HomeActivityService, { ActivityId } from '../src/index.ts'
import HomeActivityResponsibilityService, {
  ActivityResponsibilityError,
  ActivityResponsibilityStorageError,
  activityResponsibilityRequestId,
} from '../src/responsibilities.ts'
import {
  activityResponsibilityFactSchema,
  confirmActivityResponsibilityRequestSchema,
  MAX_HOME_ACTIVITY_RESPONSIBILITY_FACTS_PER_ACTIVITY,
  recordActivityResponsibilityAcceptanceRequestSchema,
} from '../src/responsibility-spec.ts'
import {
  activityResponsibilityStatusReportSchema,
  MAX_ACTIVITY_RESPONSIBILITY_STATUS_REPORTS,
} from '../src/responsibility-status-spec.ts'
import type {
  ActivityResponsibilityFact,
  ActivityResponsibilityFactId,
  ActivityResponsibilityHistory,
  ActivityResponsibilityId,
  ActivityResponsibilityRequestId,
  ActivityResponsibilityStatusReport,
  ActivityResponsibilityStatusReportId,
  ConfirmActivityResponsibilityRequest,
  RecordActivityResponsibilityAcceptanceRequest,
  CreateActivityResponsibilityRequest,
} from '../src/responsibility-types.ts'
import type { ActivityId as ActivityIdType } from '../src/types.ts'

const contexts: Context[] = []
const roots: string[] = []
const activityRequest = {
  name: 'Coordinate the release work',
  objective: 'Deliver the reviewed release changes.',
  boundaries: { inScope: ['Coordinate existing Sessions.'], outOfScope: ['Do not publish a release.'] },
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function harness(root: string): Promise<Context> {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(HomeActivityService)
  await ctx.plugin(HomeActivityResponsibilityService)
  return ctx
}

async function memoryHarness(pool: MemoryMediaPool): Promise<Context> {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(HomeActivityService)
  await ctx.plugin(HomeActivityResponsibilityService)
  return ctx
}

function request(activityId: ActivityIdType, requestId = '00000000-0000-4000-8000-000000000101'): CreateActivityResponsibilityRequest {
  return {
    activityId,
    requestId: activityResponsibilityRequestId(requestId),
    coordinatingSessionId: SessionId('coordinator-session'),
    sourceEventSeq: 44,
    target: { workspaceId: WorkspaceId('00000000-0000-4000-8000-000000000011'), sessionId: SessionId('target-session') },
    task: 'Implement the approved parser change and report the focused validation result.',
    inScope: ['Update the parser implementation.', 'Run parser tests.'],
    outOfScope: ['Do not merge or release.'],
    expectedOutcome: 'A source-attributed report linked to the target Session log.',
    prerequisites: ['The target Session is authorized and available.'],
    conflictingWork: ['The target is already handling parser implementation.'],
  }
}

function confirmation(history: ActivityResponsibilityHistory, requestId = '00000000-0000-4000-8000-000000000102'): ConfirmActivityResponsibilityRequest {
  return {
    activityId: history.activityId,
    responsibilityId: history.id,
    requestId: activityResponsibilityRequestId(requestId),
    proposalFactId: history.proposal.id,
    proposal: history.proposal.proposal,
    principal: { kind: 'owner' },
  }
}

async function dispatchedStatusFixture(
  ctx: Context,
  activityId: ActivityIdType,
  suffix: number,
  outcome?: 'accepted' | 'not-admitted' | 'uncertain',
): Promise<{
  readonly responsibilityId: ActivityResponsibilityId
  readonly promptRequestId: ActivityResponsibilityRequestId
  readonly request: ReturnType<typeof statusRequest>
}> {
  const proposal = await ctx.homeActivityResponsibilities.createProposal(request(activityId, uuid(suffix)))
  const history: ActivityResponsibilityHistory = {
    id: proposal.responsibilityId,
    activityId,
    proposal,
    facts: [proposal],
  }
  await ctx.homeActivityResponsibilities.confirm(confirmation(history, uuid(suffix + 1_000)))
  const promptRequestId = activityResponsibilityRequestId(uuid(suffix + 2_000))
  const dispatch = { activityId, responsibilityId: proposal.responsibilityId, promptRequestId }
  await ctx.homeActivityResponsibilities.beginDispatch(dispatch)
  if (outcome !== undefined) await ctx.homeActivityResponsibilities.settleDispatch({ ...dispatch, outcome })
  return {
    responsibilityId: proposal.responsibilityId,
    promptRequestId,
    request: statusRequest(activityId, proposal.responsibilityId, suffix + 3_000),
  }
}

function statusRequest(activityId: ActivityIdType, responsibilityId: ActivityResponsibilityId, sourceEventSeq: number) {
  return {
    activityId,
    responsibilityId,
    callerSessionId: SessionId('target-session'),
    sourceEventSeq,
    status: 'progress' as const,
    summary: `The target reports bounded progress at event ${sourceEventSeq}.`,
  }
}

function statusReportRow(
  activityId: ActivityIdType,
  responsibilityId: ActivityResponsibilityId,
  targetSessionId: ReturnType<typeof SessionId>,
  promptRequestId: ActivityResponsibilityRequestId,
  sourceEventSeq: number,
): ActivityResponsibilityStatusReport {
  return {
    id: brandString<ActivityResponsibilityStatusReportId>(uuid(10_000 + sourceEventSeq)),
    activityId,
    responsibilityId,
    targetSessionId,
    promptRequestId,
    status: 'progress',
    summary: `Target report at event ${sourceEventSeq}.`,
    sourceEventSeq,
    recordedAt: '2026-11-25T12:00:00.000Z',
    source: 'target-session-status-tool',
  }
}

function sourceKey(sessionId: string, sourceEventSeq: number): string {
  return `${sessionId.length}:${sessionId}:${sourceEventSeq}`
}

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`
}

it('persists append-only responsibility evidence across a fresh storage context', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-responsibility-')); roots.push(root)
  const first = await harness(root)
  const activity = await first.homeActivities.create(activityRequest)
  const proposalRequest = request(activity.id)
  const proposal = await first.homeActivityResponsibilities.createProposal(proposalRequest)
  expect(await first.homeActivityResponsibilities.createProposal(proposalRequest)).toEqual(proposal)
  expect(proposal).toMatchObject({ kind: 'proposed', revision: 1, source: { sessionId: 'coordinator-session', eventSeq: 44 } })

  const confirmationRequest = confirmation({ id: proposal.responsibilityId, activityId: activity.id, proposal, facts: [proposal] })
  const confirmed = await first.homeActivityResponsibilities.confirm(confirmationRequest)
  expect(confirmed.actor).toEqual({ kind: 'authenticated-user', principal: { kind: 'owner' } })
  expect(await first.homeActivityResponsibilities.confirm(confirmationRequest)).toEqual(confirmed)
  const promptRequestId = activityResponsibilityRequestId('00000000-0000-4000-8000-000000000103')
  const dispatch = { activityId: activity.id, responsibilityId: proposal.responsibilityId, promptRequestId }
  const attempted = await first.homeActivityResponsibilities.beginDispatch(dispatch)
  expect(await first.homeActivityResponsibilities.beginDispatch(dispatch)).toEqual(attempted)
  expect(activityResponsibilityFactSchema.safeParse({ ...confirmed, revision: 1 }).success).toBe(false)
  expect(activityResponsibilityFactSchema.safeParse({ ...proposal, revision: 2, previousFactId: confirmed.id }).success).toBe(false)
  expect(activityResponsibilityFactSchema.safeParse({
    ...attempted,
    requestId: activityResponsibilityRequestId('00000000-0000-4000-8000-000000000114'),
  }).success).toBe(false)
  const settled = await first.homeActivityResponsibilities.settleDispatch({ ...dispatch, outcome: 'accepted' })
  expect(await first.homeActivityResponsibilities.settleDispatch({ ...dispatch, outcome: 'accepted' })).toEqual(settled)

  const observed = await first.homeActivityResponsibilities.recordObservation({
    activityId: activity.id,
    responsibilityId: proposal.responsibilityId,
    requestId: activityResponsibilityRequestId('00000000-0000-4000-8000-000000000104'),
    observedAt: '2026-11-24T12:00:00.000Z',
    observation: { status: 'available', cursor: 81, agentAvailable: true, active: false, running: false, queueAvailable: true, pendingInput: [] },
  })
  expect(observed.kind).toBe('observed')
  expect(await first.homeActivityResponsibilities.recordObservation({
    activityId: activity.id,
    responsibilityId: proposal.responsibilityId,
    requestId: activityResponsibilityRequestId('00000000-0000-4000-8000-000000000104'),
    observedAt: '2026-11-24T12:00:00.000Z',
    observation: { status: 'available', cursor: 81, agentAvailable: true, active: false, running: false, queueAvailable: true, pendingInput: [] },
  })).toEqual(observed)
  const unavailable = await first.homeActivityResponsibilities.recordObservation({
    activityId: activity.id,
    responsibilityId: proposal.responsibilityId,
    requestId: activityResponsibilityRequestId('00000000-0000-4000-8000-000000000109'),
    observedAt: '2026-11-24T12:02:00.000Z',
    observation: { status: 'unavailable', reason: 'disconnected' },
  })
  expect(unavailable.observation).toEqual({ status: 'unavailable', reason: 'disconnected' })

  const report = await first.homeActivityResponsibilities.recordReport({
    activityId: activity.id,
    responsibilityId: proposal.responsibilityId,
    requestId: activityResponsibilityRequestId('00000000-0000-4000-8000-000000000105'),
    promptRequestId,
    sourceEventSeqs: [78, 80],
    summary: 'The target reports the parser change and focused test result.',
    reportedAt: '2026-11-24T12:01:00.000Z',
  })
  expect(await first.homeActivityResponsibilities.recordReport({
    activityId: activity.id,
    responsibilityId: proposal.responsibilityId,
    requestId: activityResponsibilityRequestId('00000000-0000-4000-8000-000000000105'),
    promptRequestId,
    sourceEventSeqs: [78, 80],
    summary: 'The target reports the parser change and focused test result.',
    reportedAt: '2026-11-24T12:01:00.000Z',
  })).toEqual(report)
  const verification = await first.homeActivityResponsibilities.recordVerification({
    activityId: activity.id,
    responsibilityId: proposal.responsibilityId,
    requestId: activityResponsibilityRequestId('00000000-0000-4000-8000-000000000106'),
    reportFactId: report.id,
    actor: { kind: 'dsh-session', sessionId: SessionId('review-session') },
    evidence: { source: 'focused test runner', reference: 'run:123', result: 'passed', summary: 'The parser tests passed.' },
  })
  expect(await first.homeActivityResponsibilities.recordVerification({
    activityId: activity.id,
    responsibilityId: proposal.responsibilityId,
    requestId: activityResponsibilityRequestId('00000000-0000-4000-8000-000000000106'),
    reportFactId: report.id,
    actor: { kind: 'dsh-session', sessionId: SessionId('review-session') },
    evidence: { source: 'focused test runner', reference: 'run:123', result: 'passed', summary: 'The parser tests passed.' },
  })).toEqual(verification)
  const acceptanceRequest: RecordActivityResponsibilityAcceptanceRequest = {
    activityId: activity.id,
    responsibilityId: proposal.responsibilityId,
    requestId: activityResponsibilityRequestId('00000000-0000-4000-8000-000000000107'),
    reportFactId: report.id,
    disposition: 'requires-follow-up' as const,
    principal: { kind: 'owner' },
  }
  const firstDisposition = await first.homeActivityResponsibilities.recordAcceptance(acceptanceRequest)
  expect(await first.homeActivityResponsibilities.recordAcceptance(acceptanceRequest)).toEqual(firstDisposition)
  const laterDisposition = await first.homeActivityResponsibilities.recordAcceptance({
    ...acceptanceRequest,
    requestId: activityResponsibilityRequestId('00000000-0000-4000-8000-000000000108'),
    disposition: 'accepted',
    principal: { kind: 'owner' },
  })
  expect(laterDisposition.supersedes).toBe(firstDisposition.id)
  expect(await first.homeActivityResponsibilities.recordAcceptance({
    ...acceptanceRequest,
    requestId: activityResponsibilityRequestId('00000000-0000-4000-8000-000000000108'),
    disposition: 'accepted',
    principal: { kind: 'owner' },
  })).toEqual(laterDisposition)
  await expect(first.homeActivityResponsibilities.recordAcceptance({
    ...acceptanceRequest,
    disposition: 'accepted',
  })).rejects.toMatchObject({ code: 'request-id-reused' })
  const userVerification = await first.homeActivityResponsibilities.recordVerification({
    activityId: activity.id,
    responsibilityId: proposal.responsibilityId,
    requestId: activityResponsibilityRequestId('00000000-0000-4000-8000-000000000110'),
    reportFactId: report.id,
    actor: { kind: 'authenticated-user', principal: { kind: 'owner' } },
    evidence: { source: 'reviewed diff', result: 'inconclusive', summary: 'The reviewer did not inspect the full integration test.' },
  })
  expect(userVerification.actor).toEqual({ kind: 'authenticated-user', principal: { kind: 'owner' } })

  const beforeRestart = first.homeActivityResponsibilities.get(activity.id, proposal.responsibilityId)
  expect(beforeRestart?.facts.map(fact => fact.kind)).toEqual([
    'proposed', 'confirmed', 'dispatch-attempted', 'dispatch-settled', 'observed', 'observed', 'reported',
    'verification-recorded', 'acceptance-recorded', 'acceptance-recorded', 'verification-recorded',
  ])
  expect(verification).toMatchObject({ kind: 'verification-recorded', evidence: { result: 'passed' } })
  expect(report).toMatchObject({ sourceEventSeqs: [78, 80], targetSessionId: 'target-session' })
  expect(first.homeActivityResponsibilities.list(activity.id)).toHaveLength(1)
  await first.fiber.dispose()

  const reopened = await harness(root)
  expect(reopened.homeActivities.get(activity.id)?.objective).toBe(activityRequest.objective)
  expect(reopened.homeActivityResponsibilities.get(activity.id, proposal.responsibilityId)).toEqual(beforeRestart)
  expect(reopened.homeActivityResponsibilities.list(activity.id)).toEqual([beforeRestart])
  expect(reopened.homeActivityResponsibilities.get(activity.id, proposal.responsibilityId)?.facts.at(-2)).toEqual(laterDisposition)
  expect(reopened.homeActivityResponsibilities.get(activity.id, proposal.responsibilityId)?.facts.at(-1)).toEqual(userVerification)
})

it('stores idempotent target status reports separately from final responsibility facts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-status-report-')); roots.push(root)
  const first = await harness(root)
  const activity = await first.homeActivities.create(activityRequest)
  const proposal = await first.homeActivityResponsibilities.createProposal(request(activity.id))
  const history = { id: proposal.responsibilityId, activityId: activity.id, proposal, facts: [proposal] }
  await first.homeActivityResponsibilities.confirm(confirmation(history))
  const promptRequestId = activityResponsibilityRequestId('00000000-0000-4000-8000-000000000701')
  const dispatch = { activityId: activity.id, responsibilityId: proposal.responsibilityId, promptRequestId }
  await first.homeActivityResponsibilities.beginDispatch(dispatch)
  await first.homeActivityResponsibilities.settleDispatch({ ...dispatch, outcome: 'accepted' })
  const statusRequest = {
    activityId: activity.id,
    responsibilityId: proposal.responsibilityId,
    callerSessionId: SessionId('target-session'),
    sourceEventSeq: 91,
    status: 'blocked' as const,
    summary: 'Waiting for the approved dependency update before continuing.',
  }

  await expect(first.homeActivityResponsibilities.recordTargetStatusReport({ ...statusRequest, callerSessionId: SessionId('other-session') }))
    .rejects.toMatchObject({ code: 'status-report-unavailable' })
  const report = await first.homeActivityResponsibilities.recordTargetStatusReport(statusRequest)
  expect(await first.homeActivityResponsibilities.recordTargetStatusReport(statusRequest)).toEqual(report)
  await expect(first.homeActivityResponsibilities.recordTargetStatusReport({ ...statusRequest, summary: 'Conflicting report for the same logged event.' }))
    .rejects.toMatchObject({ code: 'request-id-reused' })
  expect(first.homeActivityResponsibilities.hasReportableTargetSession(SessionId('target-session'))).toBe(true)
  expect(first.homeActivityResponsibilities.listTargetStatusReports(activity.id, proposal.responsibilityId)).toEqual([report])
  expect(first.homeActivityResponsibilities.get(activity.id, proposal.responsibilityId)?.facts.map(fact => fact.kind))
    .toEqual(['proposed', 'confirmed', 'dispatch-attempted', 'dispatch-settled'])

  await first.homeActivityResponsibilities.recordReport({
    activityId: activity.id,
    responsibilityId: proposal.responsibilityId,
    requestId: promptRequestId,
    promptRequestId,
    sourceEventSeqs: [88, 92],
    summary: 'The target reports a final response after the assignment turn ended.',
    reportedAt: '2026-11-25T12:00:00.000Z',
  })
  expect(first.homeActivityResponsibilities.hasReportableTargetSession(SessionId('target-session'))).toBe(false)
  await expect(first.homeActivityResponsibilities.recordTargetStatusReport({ ...statusRequest, sourceEventSeq: 92 }))
    .rejects.toMatchObject({ code: 'status-report-unavailable' })
  await first.fiber.dispose()

  const reopened = await harness(root)
  expect(reopened.homeActivityResponsibilities.listTargetStatusReports(activity.id, proposal.responsibilityId)).toEqual([report])
})

it('rejects invalid, undispatched, and denied status reports while retaining unresolved dispatch eligibility', async () => {
  const ctx = await memoryHarness(new MemoryMediaPool())
  const activity = await ctx.homeActivities.create(activityRequest)
  const undispatched = await ctx.homeActivityResponsibilities.createProposal(request(activity.id, uuid(801)))
  const undispatchedRequest = statusRequest(activity.id, undispatched.responsibilityId, 801)
  expect(ctx.homeActivityResponsibilities.hasReportableTargetSession(SessionId('target-session'))).toBe(false)
  await expect(ctx.homeActivityResponsibilities.recordTargetStatusReport({ ...undispatchedRequest, sourceEventSeq: -1 }))
    .rejects.toMatchObject({ code: 'invalid-request' })
  await expect(ctx.homeActivityResponsibilities.recordTargetStatusReport(undispatchedRequest))
    .rejects.toMatchObject({ code: 'status-report-unavailable' })

  const denied = await dispatchedStatusFixture(ctx, activity.id, 802, 'not-admitted')
  expect(ctx.homeActivityResponsibilities.hasReportableTargetSession(SessionId('target-session'))).toBe(false)
  await expect(ctx.homeActivityResponsibilities.recordTargetStatusReport(denied.request))
    .rejects.toMatchObject({ code: 'status-report-unavailable' })

  const unresolved = await dispatchedStatusFixture(ctx, activity.id, 803)
  expect(ctx.homeActivityResponsibilities.hasReportableTargetSession(SessionId('target-session'))).toBe(true)
  await expect(ctx.homeActivityResponsibilities.recordTargetStatusReport(unresolved.request)).resolves.toMatchObject({
    promptRequestId: unresolved.promptRequestId,
    sourceEventSeq: unresolved.request.sourceEventSeq,
  })
})

it('fails closed when target status storage, generated records, or history reads fail', async () => {
  const ctx = await memoryHarness(new MemoryMediaPool())
  const activity = await ctx.homeActivities.create(activityRequest)
  const target = await dispatchedStatusFixture(ctx, activity.id, 811, 'accepted')
  const service = ctx.homeActivityResponsibilities
  const table = Reflect.get(service, 'statusReportsTable') as KvTable<string, ActivityResponsibilityStatusReport>

  const reportEntries = vi.spyOn(table, 'entries').mockImplementationOnce(() => { throw new Error('injected status read failure') })
  await expect(service.recordTargetStatusReport(target.request)).rejects.toBeInstanceOf(ActivityResponsibilityStorageError)
  reportEntries.mockRestore()

  const reportPut = vi.spyOn(table, 'put').mockRejectedValueOnce(new Error('injected status write failure'))
  await expect(service.recordTargetStatusReport(target.request)).rejects.toBeInstanceOf(ActivityResponsibilityStorageError)
  reportPut.mockRestore()

  const rejection = activityResponsibilityStatusReportSchema.safeParse({ kind: 'invalid-status-report' })
  if (rejection.success) throw new Error('Expected the invalid status row to be rejected.')
  const parse = vi.spyOn(activityResponsibilityStatusReportSchema, 'safeParse').mockReturnValue(rejection)
  try {
    await expect(service.recordTargetStatusReport(target.request)).rejects.toMatchObject({ code: 'invalid-request' })
  } finally {
    parse.mockRestore()
  }

  const domainError = new ActivityResponsibilityError('status-report-unavailable', 'Injected domain rejection.')
  const domainEntries = vi.spyOn(table, 'entries').mockImplementationOnce(() => { throw domainError })
  expect(() => service.listTargetStatusReports(activity.id, target.responsibilityId)).toThrow(domainError)
  domainEntries.mockRestore()

  const storageError = new ActivityResponsibilityStorageError(new Error('injected typed storage error'))
  const storageEntries = vi.spyOn(table, 'entries').mockImplementationOnce(() => { throw storageError })
  expect(() => service.listTargetStatusReports(activity.id, target.responsibilityId)).toThrow(storageError)
  storageEntries.mockRestore()

  const listEntries = vi.spyOn(table, 'entries').mockImplementationOnce(() => { throw new Error('injected list read failure') })
  expect(() => service.listTargetStatusReports(activity.id, target.responsibilityId))
    .toThrow(ActivityResponsibilityStorageError)
  listEntries.mockRestore()

  Reflect.set(service, 'statusReportsTable', undefined)
  expect(() => service.listTargetStatusReports(activity.id, target.responsibilityId))
    .toThrow(ActivityResponsibilityStorageError)
})

it('enforces per-responsibility and per-Activity target report limits', async () => {
  const ctx = await memoryHarness(new MemoryMediaPool())
  const activity = await ctx.homeActivities.create(activityRequest)
  const target = await dispatchedStatusFixture(ctx, activity.id, 821, 'accepted')
  const table = Reflect.get(ctx.homeActivityResponsibilities, 'statusReportsTable') as KvTable<string, ActivityResponsibilityStatusReport>
  const entries = vi.spyOn(table, 'entries')
  const perResponsibility = Array.from({ length: MAX_ACTIVITY_RESPONSIBILITY_STATUS_REPORTS }, (_, index) => [
    `seed-responsibility-${index}`,
    statusReportRow(activity.id, target.responsibilityId, SessionId('target-session'), target.promptRequestId, index),
  ] as const)
  entries.mockImplementationOnce(() => new Map(perResponsibility).entries())
  await expect(ctx.homeActivityResponsibilities.recordTargetStatusReport(target.request))
    .rejects.toMatchObject({ code: 'status-report-limit' })

  const atActivityLimit = [
    ['unrelated-activity', statusReportRow(ActivityId(uuid(822)), target.responsibilityId, SessionId('target-session'), target.promptRequestId, 1)],
    ...Array.from({ length: MAX_HOME_ACTIVITY_RESPONSIBILITY_FACTS_PER_ACTIVITY }, (_, index) => [
      `seed-activity-${index}`,
      statusReportRow(activity.id, brandString<ActivityResponsibilityId>(`other-responsibility-${index}`), SessionId('target-session'), target.promptRequestId, index + 1),
    ] as const),
  ] as const
  entries.mockImplementationOnce(() => new Map(atActivityLimit).entries())
  await expect(ctx.homeActivityResponsibilities.recordTargetStatusReport(target.request))
    .rejects.toMatchObject({ code: 'status-report-limit' })
  entries.mockRestore()
})

it('lists only reports bound to the stored target, dispatch, Activity, responsibility, and source key', async () => {
  const ctx = await memoryHarness(new MemoryMediaPool())
  const activity = await ctx.homeActivities.create(activityRequest)
  const target = await dispatchedStatusFixture(ctx, activity.id, 831, 'accepted')
  const service = ctx.homeActivityResponsibilities
  const table = Reflect.get(service, 'statusReportsTable') as KvTable<string, ActivityResponsibilityStatusReport>
  await service.recordTargetStatusReport({ ...target.request, sourceEventSeq: 9 })
  await service.recordTargetStatusReport({ ...target.request, sourceEventSeq: 2 })

  await table.put(sourceKey('target-session', 1), statusReportRow(
    activity.id, target.responsibilityId, SessionId('other-target-session'), target.promptRequestId, 1,
  ))
  await table.put(sourceKey('target-session', 3), statusReportRow(
    activity.id, target.responsibilityId, SessionId('target-session'), activityResponsibilityRequestId(uuid(832)), 3,
  ))
  await table.put(sourceKey('target-session', 4), statusReportRow(
    ActivityId(uuid(834)), target.responsibilityId, SessionId('target-session'), target.promptRequestId, 4,
  ))
  await table.put(sourceKey('target-session', 5), statusReportRow(
    activity.id, brandString<ActivityResponsibilityId>(uuid(835)), SessionId('target-session'), target.promptRequestId, 5,
  ))
  await table.put('mismatched-storage-key', statusReportRow(
    activity.id, target.responsibilityId, SessionId('target-session'), target.promptRequestId, 6,
  ))

  const historyRows = service.listTargetStatusReports(activity.id, target.responsibilityId)
  expect(historyRows.map(report => report.sourceEventSeq)).toEqual([2, 9])
  const undispatched = await service.createProposal(request(activity.id, uuid(836)))
  expect(service.listTargetStatusReports(activity.id, undispatched.responsibilityId)).toEqual([])
})

it('rejects mismatched confirmation, illegal dispatch, and reports without an admitted prompt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-responsibility-invalid-')); roots.push(root)
  const ctx = await harness(root)
  const activity = await ctx.homeActivities.create(activityRequest)
  const proposed = await ctx.homeActivityResponsibilities.createProposal(request(activity.id))
  const history: ActivityResponsibilityHistory = {
    id: proposed.responsibilityId,
    activityId: activity.id,
    proposal: proposed,
    facts: [proposed],
  }
  const dispatch = {
    activityId: activity.id,
    responsibilityId: proposed.responsibilityId,
    promptRequestId: activityResponsibilityRequestId('00000000-0000-4000-8000-000000000203'),
  }

  await expect(ctx.homeActivityResponsibilities.createProposal({ ...request(activity.id), task: 'Different task.' }))
    .rejects.toMatchObject({ code: 'request-id-reused' })
  await expect(ctx.homeActivityResponsibilities.createProposal({ ...request(activity.id), sourceEventSeq: 45 }))
    .rejects.toMatchObject({ code: 'request-id-reused' })
  await expect(ctx.homeActivityResponsibilities.createProposal({ ...request(activity.id), coordinatingSessionId: SessionId('other-coordinator') }))
    .rejects.toMatchObject({ code: 'request-id-reused' })
  await expect(ctx.homeActivityResponsibilities.createProposal({ ...request(activity.id), task: 'Not a one-line\ntask.' }))
    .rejects.toMatchObject({ code: 'invalid-request' })
  await expect(ctx.homeActivityResponsibilities.createProposal({ ...request(ActivityId('00000000-0000-4000-8000-000000000099')), requestId: activityResponsibilityRequestId('00000000-0000-4000-8000-000000000204') }))
    .rejects.toMatchObject({ code: 'unknown-activity' })
  await expect(ctx.homeActivityResponsibilities.beginDispatch(dispatch)).rejects.toMatchObject({ code: 'invalid-history' })
  await expect(ctx.homeActivityResponsibilities.beginDispatch(JSON.parse(JSON.stringify({
    ...dispatch,
    promptRequestId: 'not-a-uuid',
  })))).rejects.toMatchObject({ code: 'invalid-request' })
  await expect(ctx.homeActivityResponsibilities.settleDispatch(JSON.parse(JSON.stringify({
    ...dispatch,
    promptRequestId: 'not-a-uuid',
    outcome: 'accepted',
  })))).rejects.toMatchObject({ code: 'invalid-request' })
  expect(() => activityResponsibilityRequestId('not-a-uuid')).toThrow()
  await expect(ctx.homeActivityResponsibilities.beginDispatch({
    activityId: activity.id,
    responsibilityId: brandString<ActivityResponsibilityId>('00000000-0000-4000-8000-000000000299'),
    promptRequestId: activityResponsibilityRequestId('00000000-0000-4000-8000-000000000298'),
  })).rejects.toMatchObject({ code: 'unknown-responsibility' })
  await expect(ctx.homeActivityResponsibilities.confirm({
    ...confirmation(history),
    proposal: { ...proposed.proposal, task: 'A changed task is not the approved task.' },
  })).rejects.toMatchObject({ code: 'proposal-mismatch' })
  await expect(ctx.homeActivityResponsibilities.confirm({
    ...confirmation(history),
    proposal: { ...proposed.proposal, task: 'A task with an invalid\nline break.' },
  })).rejects.toMatchObject({ code: 'invalid-request' })
  expect(confirmActivityResponsibilityRequestSchema.safeParse({
    ...confirmation(history),
    principal: { kind: '' },
  }).success).toBe(false)

  const emptyRequest = request(activity.id, '00000000-0000-4000-8000-000000000210')
  const withoutSourceSequence = { ...emptyRequest, sourceEventSeq: undefined }
  const proposalWithoutCursor = await ctx.homeActivityResponsibilities.createProposal(withoutSourceSequence)
  expect(proposalWithoutCursor.source).toEqual({ kind: 'coordinating-session', sessionId: 'coordinator-session' })
  const historyWithoutCursor: ActivityResponsibilityHistory = {
    id: proposalWithoutCursor.responsibilityId,
    activityId: activity.id,
    proposal: proposalWithoutCursor,
    facts: [proposalWithoutCursor],
  }
  const confirmedWithoutPrincipalId = await ctx.homeActivityResponsibilities.confirm({
    ...confirmation(historyWithoutCursor, '00000000-0000-4000-8000-000000000211'),
    principal: { kind: 'owner' },
  })
  expect(confirmedWithoutPrincipalId.actor).toEqual({ kind: 'authenticated-user', principal: { kind: 'owner' } })

  const confirmed = await ctx.homeActivityResponsibilities.confirm(confirmation(history))
  expect(confirmActivityResponsibilityRequestSchema.safeParse({
    ...confirmation(history),
    principal: { kind: 'owner', metadata: 'not-persisted' },
  }).success).toBe(false)
  await expect(ctx.homeActivityResponsibilities.confirm({
    ...confirmation(history, '00000000-0000-4000-8000-000000000205'),
    principal: { kind: 'owner' },
  })).rejects.toMatchObject({ code: 'already-confirmed' })
  await expect(ctx.homeActivityResponsibilities.beginDispatch({ ...dispatch, promptRequestId: activityResponsibilityRequestId('00000000-0000-4000-8000-000000000206') }))
    .resolves.toMatchObject({ kind: 'dispatch-attempted', targetSessionId: proposed.proposal.target.sessionId })
  await expect(ctx.homeActivityResponsibilities.beginDispatch({ ...dispatch, promptRequestId: activityResponsibilityRequestId('00000000-0000-4000-8000-000000000207') }))
    .rejects.toMatchObject({ code: 'dispatch-already-attempted' })
  await expect(ctx.homeActivityResponsibilities.settleDispatch({ ...dispatch, outcome: 'accepted' }))
    .rejects.toMatchObject({ code: 'dispatch-not-attempted' })

  const actualPrompt = activityResponsibilityRequestId('00000000-0000-4000-8000-000000000206')
  await ctx.homeActivityResponsibilities.settleDispatch({ ...dispatch, promptRequestId: actualPrompt, outcome: 'not-admitted' })
  await expect(ctx.homeActivityResponsibilities.recordReport({
    activityId: activity.id,
    responsibilityId: proposed.responsibilityId,
    requestId: activityResponsibilityRequestId('00000000-0000-4000-8000-000000000208'),
    promptRequestId: actualPrompt,
    sourceEventSeqs: [2],
    summary: 'No target report exists after a rejected prompt.',
    reportedAt: '2026-11-24T13:00:00.000Z',
  })).rejects.toMatchObject({ code: 'report-unavailable' })
  await expect(ctx.homeActivityResponsibilities.recordObservation({
    activityId: activity.id,
    responsibilityId: proposed.responsibilityId,
    requestId: activityResponsibilityRequestId('00000000-0000-4000-8000-000000000212'),
    observedAt: 'not-a-timestamp',
    observation: { status: 'unavailable', reason: 'unknown' },
  })).rejects.toMatchObject({ code: 'invalid-request' })
  await expect(ctx.homeActivityResponsibilities.recordVerification({
    activityId: activity.id,
    responsibilityId: proposed.responsibilityId,
    requestId: activityResponsibilityRequestId('00000000-0000-4000-8000-000000000213'),
    reportFactId: proposed.id,
    actor: { kind: 'dsh-session', sessionId: SessionId('reviewer') },
    evidence: { source: 'test', result: 'passed', summary: 'No report is linked.' },
  })).rejects.toMatchObject({ code: 'report-unavailable' })
  await expect(ctx.homeActivityResponsibilities.recordVerification({
    activityId: activity.id,
    responsibilityId: proposed.responsibilityId,
    requestId: activityResponsibilityRequestId('00000000-0000-4000-8000-000000000214'),
    reportFactId: proposed.id,
    actor: { kind: 'dsh-session', sessionId: SessionId('reviewer') },
    evidence: { source: 'test', result: 'passed', summary: 'Bad\nline break.' },
  })).rejects.toMatchObject({ code: 'invalid-request' })
  expect(recordActivityResponsibilityAcceptanceRequestSchema.safeParse({
    activityId: activity.id,
    responsibilityId: proposed.responsibilityId,
    requestId: activityResponsibilityRequestId('00000000-0000-4000-8000-000000000215'),
    reportFactId: proposed.id,
    disposition: 'accepted',
    principal: { kind: '' },
  }).success).toBe(false)
  await expect(ctx.homeActivityResponsibilities.recordAcceptance({
    activityId: activity.id,
    responsibilityId: proposed.responsibilityId,
    requestId: activityResponsibilityRequestId('00000000-0000-4000-8000-000000000209'),
    reportFactId: proposed.id,
    disposition: 'accepted',
    principal: { kind: 'owner' },
  })).rejects.toMatchObject({ code: 'report-unavailable' })
  await expect(ctx.homeActivityResponsibilities.recordAcceptance(JSON.parse(JSON.stringify({
    activityId: activity.id,
    responsibilityId: proposed.responsibilityId,
    requestId: '00000000-0000-4000-8000-000000000216',
    reportFactId: proposed.id,
    disposition: 'not-a-disposition',
    principal: { kind: 'owner' },
  })))).rejects.toMatchObject({ code: 'invalid-request' })
  expect(ctx.homeActivityResponsibilities.get(activity.id, proposed.responsibilityId)?.facts[1]).toEqual(confirmed)
})

it('keeps uncertain delivery distinct and records bounded source-attributed reports', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-responsibility-uncertain-')); roots.push(root)
  const ctx = await harness(root)
  const activity = await ctx.homeActivities.create(activityRequest)
  const proposed = await ctx.homeActivityResponsibilities.createProposal(request(activity.id, '00000000-0000-4000-8000-000000000301'))
  const history: ActivityResponsibilityHistory = {
    id: proposed.responsibilityId,
    activityId: activity.id,
    proposal: proposed,
    facts: [proposed],
  }
  await ctx.homeActivityResponsibilities.confirm(confirmation(history, '00000000-0000-4000-8000-000000000302'))
  const promptRequestId = activityResponsibilityRequestId('00000000-0000-4000-8000-000000000303')
  await ctx.homeActivityResponsibilities.beginDispatch({
    activityId: activity.id,
    responsibilityId: proposed.responsibilityId,
    promptRequestId,
  })
  const uncertain = await ctx.homeActivityResponsibilities.settleDispatch({
    activityId: activity.id,
    responsibilityId: proposed.responsibilityId,
    promptRequestId,
    outcome: 'uncertain',
    diagnostic: 'The connection ended before the route result was confirmed.',
  })
  expect(uncertain.outcome).toBe('uncertain')
  await expect(ctx.homeActivityResponsibilities.settleDispatch({
    activityId: activity.id,
    responsibilityId: proposed.responsibilityId,
    promptRequestId,
    outcome: 'accepted',
  })).rejects.toMatchObject({ code: 'request-id-reused' })
  await expect(ctx.homeActivityResponsibilities.recordReport({
    activityId: activity.id,
    responsibilityId: proposed.responsibilityId,
    requestId: activityResponsibilityRequestId('00000000-0000-4000-8000-000000000304'),
    promptRequestId,
    sourceEventSeqs: [7, 7],
    summary: 'Duplicate source references are not useful.',
    reportedAt: '2026-11-24T14:00:00.000Z',
  })).rejects.toMatchObject({ code: 'invalid-request' })
  const report = await ctx.homeActivityResponsibilities.recordReport({
    activityId: activity.id,
    responsibilityId: proposed.responsibilityId,
    requestId: activityResponsibilityRequestId('00000000-0000-4000-8000-000000000305'),
    promptRequestId,
    sourceEventSeqs: [7, 8],
    summary: 'The authorized target Session reports a bounded result.',
    reportedAt: '2026-11-24T14:00:00.000Z',
  })
  expect(report).toMatchObject({ kind: 'reported', promptRequestId, sourceEventSeqs: [7, 8] })
})

it('filters recovery by Activity and reports an unconfirmed persistence failure', async () => {
  const pool = new MemoryMediaPool()
  const ctx = await memoryHarness(pool)
  const activity = await ctx.homeActivities.create(activityRequest)
  const otherActivity = await ctx.homeActivities.create({ ...activityRequest, name: 'Unrelated work' })
  const proposal = await ctx.homeActivityResponsibilities.createProposal(request(activity.id))
  const secondProposal = await ctx.homeActivityResponsibilities.createProposal(
    request(activity.id, '00000000-0000-4000-8000-000000000902'),
  )

  expect(ctx.homeActivityResponsibilities.get(
    activity.id,
    brandString<ActivityResponsibilityId>('00000000-0000-4000-8000-000000000999'),
  )).toBeUndefined()
  expect(ctx.homeActivityResponsibilities.get(activity.id, proposal.responsibilityId)?.proposal).toEqual(proposal)
  expect(() => ctx.homeActivityResponsibilities.get(otherActivity.id, proposal.responsibilityId))
    .toThrowError(expect.objectContaining({ code: 'activity-mismatch' }))
  await expect(ctx.homeActivityResponsibilities.recordObservation({
    activityId: otherActivity.id,
    responsibilityId: proposal.responsibilityId,
    requestId: activityResponsibilityRequestId('00000000-0000-4000-8000-000000000903'),
    observedAt: '2026-11-24T13:00:00.000Z',
    observation: { status: 'unavailable', reason: 'not-found' },
  })).rejects.toMatchObject({ code: 'activity-mismatch' })
  expect(ctx.homeActivityResponsibilities.list(otherActivity.id)).toEqual([])
  expect(ctx.homeActivityResponsibilities.list(activity.id)).toHaveLength(2)
  expect(ctx.homeActivityResponsibilities.list(activity.id)).toContainEqual({
    id: secondProposal.responsibilityId,
    activityId: activity.id,
    proposal: secondProposal,
    facts: [secondProposal],
  })

  pool.failNextWrites = 1
  await expect(ctx.homeActivityResponsibilities.createProposal(request(activity.id, '00000000-0000-4000-8000-000000000901')))
    .rejects.toMatchObject({ name: 'ActivityResponsibilityStorageError' })
  expect(ctx.homeActivityResponsibilities.list(activity.id)).toHaveLength(2)
})

it('rejects an inconsistent persisted predecessor chain during Activity recovery', async () => {
  const pool = new MemoryMediaPool()
  const ctx = await memoryHarness(pool)
  const activity = await ctx.homeActivities.create(activityRequest)
  const proposal = await ctx.homeActivityResponsibilities.createProposal(request(activity.id))
  const gapProposal = await ctx.homeActivityResponsibilities.createProposal(
    request(activity.id, '00000000-0000-4000-8000-000000000951'),
  )
  const medium = pool.media.get('home_activity_responsibilities')
  const rows = medium?.tables.get('facts')
  if (rows === undefined) throw new Error('Responsibility facts were not stored in the memory medium.')
  const invalidFact = {
    id: '00000000-0000-4000-8000-000000000998',
    responsibilityId: proposal.responsibilityId,
    activityId: activity.id,
    revision: 2,
    previousFactId: '00000000-0000-4000-8000-000000000997',
    requestId: '00000000-0000-4000-8000-000000000996',
    recordedAt: '2026-11-24T15:00:00.000Z',
    kind: 'observed',
    targetSessionId: proposal.proposal.target.sessionId,
    observedAt: '2026-11-24T15:00:00.000Z',
    observation: { status: 'unavailable', reason: 'unknown' },
    source: 'session-controller.state',
  }
  const orphanResponsibilityId = '00000000-0000-4000-8000-000000000995'
  const orphanFact = {
    ...invalidFact,
    id: '00000000-0000-4000-8000-000000000994',
    responsibilityId: orphanResponsibilityId,
    revision: 2,
    requestId: '00000000-0000-4000-8000-000000000993',
  }
  const gapFact = {
    ...invalidFact,
    id: '00000000-0000-4000-8000-000000000992',
    responsibilityId: gapProposal.responsibilityId,
    revision: 3,
    previousFactId: gapProposal.id,
    requestId: '00000000-0000-4000-8000-000000000991',
  }
  rows.set(invalidFact.id, invalidFact)
  rows.set(orphanFact.id, orphanFact)
  rows.set(gapFact.id, gapFact)
  await ctx.fiber.dispose()

  const reopened = await memoryHarness(pool)
  expect(() => reopened.homeActivityResponsibilities.get(activity.id, proposal.responsibilityId))
    .toThrowError(/predecessor references are inconsistent/u)
  expect(() => reopened.homeActivityResponsibilities.list(activity.id))
    .toThrowError(/predecessor references are inconsistent/u)
  expect(() => reopened.homeActivityResponsibilities.get(
    activity.id,
    brandString<ActivityResponsibilityId>(orphanResponsibilityId),
  ))
    .toThrowError(/must start with a proposal/u)
  expect(() => reopened.homeActivityResponsibilities.get(activity.id, gapProposal.responsibilityId))
    .toThrowError(/identities or revisions do not form/u)
})

it('rejects an unknown persisted responsibility tag at the StorageDomain load boundary', async () => {
  const pool = new MemoryMediaPool()
  const ctx = await memoryHarness(pool)
  const activity = await ctx.homeActivities.create(activityRequest)
  const proposal = await ctx.homeActivityResponsibilities.createProposal(request(activity.id))
  const medium = pool.media.get('home_activity_responsibilities')
  const rows = medium?.tables.get('facts')
  if (rows === undefined) throw new Error('Responsibility facts were not stored in the memory medium.')
  rows.set('00000000-0000-4000-8000-000000000990', {
    id: '00000000-0000-4000-8000-000000000990',
    responsibilityId: proposal.responsibilityId,
    activityId: activity.id,
    revision: 2,
    previousFactId: proposal.id,
    requestId: '00000000-0000-4000-8000-000000000989',
    recordedAt: '2026-11-24T15:00:00.000Z',
    kind: 'future-fact-kind',
  })
  await ctx.fiber.dispose()

  await expect(memoryHarness(pool)).rejects.toThrow(/does not match its schema/u)
})

it('wraps unavailable responsibility storage and fails closed at the per-Activity fact limit', async () => {
  const pool = new MemoryMediaPool()
  const ctx = await memoryHarness(pool)
  const activity = await ctx.homeActivities.create(activityRequest)
  const proposal = await ctx.homeActivityResponsibilities.createProposal(request(activity.id))
  const table = Reflect.get(ctx.homeActivityResponsibilities, 'table') as KvTable<ActivityResponsibilityFactId, ActivityResponsibilityFact>
  const entries = vi.spyOn(table, 'entries')
  const readFailure = () => { throw new Error('injected history read failure') }

  entries.mockImplementationOnce(readFailure)
  expect(() => ctx.homeActivityResponsibilities.get(activity.id, proposal.responsibilityId))
    .toThrow(ActivityResponsibilityStorageError)
  entries.mockImplementationOnce(readFailure)
  expect(() => ctx.homeActivityResponsibilities.list(activity.id)).toThrow(ActivityResponsibilityStorageError)
  entries.mockImplementationOnce(readFailure)
  await expect(ctx.homeActivityResponsibilities.createProposal(request(activity.id, '00000000-0000-4000-8000-000000000971')))
    .rejects.toBeInstanceOf(ActivityResponsibilityStorageError)
  entries.mockImplementationOnce(() => [][Symbol.iterator]())
  entries.mockImplementationOnce(readFailure)
  await expect(ctx.homeActivityResponsibilities.createProposal(request(activity.id, '00000000-0000-4000-8000-000000000972')))
    .rejects.toBeInstanceOf(ActivityResponsibilityStorageError)
  const storedReadFailure = new ActivityResponsibilityStorageError(new Error('injected typed storage failure'))
  entries.mockImplementationOnce(() => { throw storedReadFailure })
  await expect(ctx.homeActivityResponsibilities.recordObservation({
    activityId: activity.id,
    responsibilityId: proposal.responsibilityId,
    requestId: activityResponsibilityRequestId('00000000-0000-4000-8000-000000000974'),
    observedAt: '2026-11-24T16:00:00.000Z',
    observation: { status: 'unavailable', reason: 'unknown' },
  })).rejects.toBe(storedReadFailure)
  entries.mockImplementationOnce(readFailure)
  await expect(ctx.homeActivityResponsibilities.recordObservation({
    activityId: activity.id,
    responsibilityId: proposal.responsibilityId,
    requestId: activityResponsibilityRequestId('00000000-0000-4000-8000-000000000975'),
    observedAt: '2026-11-24T16:00:01.000Z',
    observation: { status: 'unavailable', reason: 'unknown' },
  })).rejects.toBeInstanceOf(ActivityResponsibilityStorageError)

  entries.mockImplementation(() => Array.from(
    { length: MAX_HOME_ACTIVITY_RESPONSIBILITY_FACTS_PER_ACTIVITY },
    (_, index): [ActivityResponsibilityFactId, ActivityResponsibilityFact] => [
      brandString<ActivityResponsibilityFactId>(String(index)),
      proposal,
    ],
  )[Symbol.iterator]())
  await expect(ctx.homeActivityResponsibilities.createProposal(request(activity.id, '00000000-0000-4000-8000-000000000973')))
    .rejects.toMatchObject({ code: 'fact-limit' })
  entries.mockRestore()
})

it('reports an uninitialized responsibility domain instead of treating it as empty history', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  const activityId = ActivityId('70000000-0000-4000-8000-000000000007')
  ctx.provide('homeActivities', { get: () => ({ id: activityId }) } as never)
  const service = new HomeActivityResponsibilityService(ctx)

  expect(() => service.list(activityId)).toThrow(ActivityResponsibilityStorageError)
})

it('does not persist a generated fact when its schema unexpectedly rejects the assembled record', async () => {
  const ctx = await memoryHarness(new MemoryMediaPool())
  const activity = await ctx.homeActivities.create(activityRequest)
  const rejection = activityResponsibilityFactSchema.safeParse({ kind: 'unknown' })
  if (rejection.success) throw new Error('Expected the unknown fact kind to be rejected')
  const parse = vi.spyOn(activityResponsibilityFactSchema, 'safeParse')
    .mockReturnValue(rejection)

  try {
    await expect(ctx.homeActivityResponsibilities.createProposal(request(activity.id)))
      .rejects.toMatchObject({ code: 'invalid-request' })
    expect(ctx.homeActivityResponsibilities.list(activity.id)).toEqual([])
  } finally {
    parse.mockRestore()
  }
})

it('orders proposals by stable responsibility identity when recorded timestamps tie', async () => {
  const ctx = await memoryHarness(new MemoryMediaPool())
  const activity = await ctx.homeActivities.create(activityRequest)
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-24T17:00:00.000Z'))
  try {
    const first = await ctx.homeActivityResponsibilities.createProposal(request(activity.id, '00000000-0000-4000-8000-000000000981'))
    const second = await ctx.homeActivityResponsibilities.createProposal(request(activity.id, '00000000-0000-4000-8000-000000000982'))
    const expected = [first.responsibilityId, second.responsibilityId].sort((left, right) => String(left).localeCompare(String(right)))
    expect(ctx.homeActivityResponsibilities.list(activity.id).map(item => item.id)).toEqual(expected)
  } finally {
    vi.useRealTimers()
  }
})
