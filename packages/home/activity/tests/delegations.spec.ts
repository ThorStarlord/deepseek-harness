import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SubagentRunId } from '@deepseek-ai/dsh-subagent'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import HomeActivityService, { ActivityId } from '../src/index.ts'
import Delegations, {
  HomeActivityDelegationService,
  activityDelegationId,
} from '../src/delegations.ts'
import type { ActivityDelegation } from '../src/delegations.ts'
import { activityDelegationRecordSchema } from '../src/delegation-spec.ts'
import type { CreateActivityRequest } from '../src/index.ts'

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const request: CreateActivityRequest = {
  name: 'Release readiness',
  objective: 'Prepare the next release for review.',
  boundaries: {
    inScope: ['Inspect release notes and focused validation results.'],
    outOfScope: ['Do not publish or deploy.'],
  },
}

const legacySpawnRecordSchema = z.object({
  id: z.uuid(),
  activityId: z.uuid(),
  request: z.object({
    provider: z.literal('spawn'),
    task: z.string(),
    parentSessionId: z.string(),
    requestedChildSessionId: z.string(),
    requestedAt: z.iso.datetime(),
    source: z.literal('user-command'),
  }).strict(),
  status: z.literal('reported'),
  admission: z.object({
    childSessionId: z.string(),
    activationName: z.string(),
    runId: z.string().optional(),
    admittedAt: z.iso.datetime(),
    source: z.literal('subagents.startActivation'),
  }).strict(),
  report: z.object({
    stopReason: z.string(),
    outputText: z.string(),
    nonTextBlockTypes: z.array(z.string()),
    outputTruncated: z.boolean(),
    diagnostic: z.string().optional(),
    reportedAt: z.iso.datetime(),
    source: z.literal('subagent-activation-result'),
  }).strict(),
}).strict()
const legacyDelegationDomain = StorageDomain.defineDomain({
  name: 'home_activity_delegations',
  version: 1,
  tables: {
    delegations: StorageDomain.domainTable<string, z.infer<typeof legacySpawnRecordSchema>>(legacySpawnRecordSchema),
  },
})
const version2DelegationDomain = StorageDomain.defineDomain({
  name: 'home_activity_delegations',
  version: 2,
  compatibleVersions: [1],
  tables: {
    delegations: StorageDomain.domainTable<string, z.infer<typeof activityDelegationRecordSchema>>(
      activityDelegationRecordSchema,
    ),
  },
})

async function open(root: string) {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(HomeActivityService)
  await ctx.plugin(Delegations)
  return ctx
}

it('stores request, admission, and provider report as separately attributed facts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-delegations-')); roots.push(root)
  const ctx = await open(root)
  const activity = await ctx.homeActivities.create(request)
  const saved = await ctx.homeActivityDelegations.createRequest({
    activityId: activity.id,
    provider: 'spawn',
    task: 'Review the release notes for missing migration guidance.',
    parentSessionId: SessionId('parent-session'),
  })

  expect(saved.status).toBe('requested')
  expect(saved.request).toMatchObject({
    provider: 'spawn',
    parentSessionId: 'parent-session',
    source: 'user-command',
  })
  expect(saved.admission).toBeUndefined()
  expect(saved.report).toBeUndefined()

  const admission = {
    childSessionId: SessionId('child-session'),
    activationName: 'activity-4a8c2f10',
    runId: SubagentRunId('run-1'),
    admittedAt: '2026-11-15T12:00:00.000Z',
    source: 'subagents.startActivation' as const,
  }
  const admitted = await ctx.homeActivityDelegations.recordAdmitted(saved.id, admission)
  expect(admitted.status).toBe('admitted')
  expect(admitted.admission).toEqual(admission)
  expect(admitted.report).toBeUndefined()

  const report = {
    stopReason: 'max-tokens',
    outputText: 'The release notes omit upgrade steps for the storage change.',
    nonTextBlockTypes: [],
    outputTruncated: false,
    reportedAt: '2026-11-15T12:00:01.000Z',
    source: 'subagent-activation-result' as const,
  }
  const reported = await ctx.homeActivityDelegations.recordReported(saved.id, admission, report)
  expect(reported).toMatchObject({ status: 'reported', request: saved.request, admission, report })
  expect(ctx.homeActivityDelegations.get(saved.id)).toEqual(reported)
  expect(ctx.homeActivityDelegations.list(activity.id)).toEqual([reported])
  expect(reported.status).not.toBe('accepted')
  expect(reported.report?.source).toBe('subagent-activation-result')
})

it('persists Codex one-shot admission without inventing a DSH Session and reopens it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-codex-')); roots.push(root)
  const first = await open(root)
  const activity = await first.homeActivities.create(request)
  const saved = await first.homeActivityDelegations.createRequest({
    activityId: activity.id,
    provider: 'codex',
    task: 'Review the release checklist once.',
    parentSessionId: SessionId('parent-session'),
  })

  expect(saved.request).toMatchObject({ provider: 'codex', task: 'Review the release checklist once.' })
  expect('requestedChildSessionId' in saved.request).toBe(false)
  const admission = {
    provider: 'codex' as const,
    providerRunId: 'codex-provider-run-1',
    admittedAt: '2026-11-15T12:00:00.000Z',
    source: 'subagents.startActivation' as const,
  }
  await first.homeActivityDelegations.recordAdmitted(saved.id, admission)
  await first.homeActivityDelegations.recordReported(saved.id, admission, {
    stopReason: 'completed',
    outputText: 'The checklist is missing a migration step.',
    nonTextBlockTypes: [],
    outputTruncated: false,
    reportedAt: '2026-11-15T12:00:01.000Z',
    source: 'subagent-activation-result',
  })
  await first.fiber.dispose()

  const reopened = await open(root)
  expect(reopened.homeActivityDelegations.get(activityDelegationId(saved.id))).toMatchObject({
    status: 'reported',
    request: { provider: 'codex' },
    admission: { provider: 'codex', providerRunId: 'codex-provider-run-1' },
    report: { source: 'subagent-activation-result' },
  })
})

it('marks interrupted Codex request and admission as unconfirmed without rearming either run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-codex-recovery-')); roots.push(root)
  const first = await open(root)
  const activity = await first.homeActivities.create(request)
  const notRecorded = await first.homeActivityDelegations.createRequest({
    activityId: activity.id,
    provider: 'codex',
    task: 'Review the checklist once.',
    parentSessionId: SessionId('parent-session'),
  })
  const admitted = await first.homeActivityDelegations.createRequest({
    activityId: activity.id,
    provider: 'codex',
    task: 'Review the upgrade notes once.',
    parentSessionId: SessionId('parent-session'),
  })
  const admission = {
    provider: 'codex' as const,
    providerRunId: 'codex-provider-run-2',
    admittedAt: '2026-11-15T12:00:00.000Z',
    source: 'subagents.startActivation' as const,
  }
  await first.homeActivityDelegations.recordAdmitted(admitted.id, admission)
  await first.fiber.dispose()

  const reopened = await open(root)
  expect(reopened.homeActivityDelegations.get(activityDelegationId(notRecorded.id))).toMatchObject({
    status: 'unconfirmed',
    request: { provider: 'codex' },
    uncertainty: { reason: 'restart-before-admission-recorded' },
  })
  expect(reopened.homeActivityDelegations.get(activityDelegationId(notRecorded.id))?.request)
    .not.toHaveProperty('requestedChildSessionId')
  expect(reopened.homeActivityDelegations.get(activityDelegationId(admitted.id))).toMatchObject({
    status: 'unconfirmed',
    request: { provider: 'codex' },
    admission: { provider: 'codex', providerRunId: 'codex-provider-run-2' },
    uncertainty: { reason: 'restart-before-report-recorded' },
  })
})

it('persists a possibly-started Codex rejection without an admission reference', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-codex-start-uncertain-')); roots.push(root)
  const first = await open(root)
  const activity = await first.homeActivities.create(request)
  const saved = await first.homeActivityDelegations.createRequest({
    activityId: activity.id,
    provider: 'codex',
    task: 'Review the checklist once.',
    parentSessionId: SessionId('parent-session'),
  })

  const uncertain = await first.homeActivityDelegations.markUnconfirmed(
    saved.id,
    undefined,
    'codex-start-outcome-unknown',
  )
  expect(uncertain).toMatchObject({
    status: 'unconfirmed',
    request: { provider: 'codex' },
    uncertainty: { reason: 'codex-start-outcome-unknown' },
  })
  expect(uncertain.admission).toBeUndefined()
  await first.fiber.dispose()

  const reopened = await open(root)
  expect(reopened.homeActivityDelegations.get(activityDelegationId(saved.id))).toMatchObject({
    status: 'unconfirmed',
    request: { provider: 'codex' },
    uncertainty: { reason: 'codex-start-outcome-unknown' },
  })
  expect(reopened.homeActivityDelegations.get(activityDelegationId(saved.id))?.admission).toBeUndefined()
})

it('preserves an existing Codex admission when marking it unconfirmed without a replacement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-codex-admission-preserved-')); roots.push(root)
  const first = await open(root)
  const activity = await first.homeActivities.create(request)
  const saved = await first.homeActivityDelegations.createRequest({
    activityId: activity.id,
    provider: 'codex',
    task: 'Review the checklist once.',
    parentSessionId: SessionId('parent-session'),
  })
  const admission = {
    provider: 'codex' as const,
    providerRunId: 'codex-provider-run-preserved',
    admittedAt: '2026-11-15T12:00:00.000Z',
    source: 'subagents.startActivation' as const,
  }
  await first.homeActivityDelegations.recordAdmitted(saved.id, admission)

  expect(await first.homeActivityDelegations.markUnconfirmed(saved.id, undefined, 'restart-before-report-recorded'))
    .toMatchObject({ status: 'unconfirmed', admission })
})

it('reads v1 spawn data in v3 and refuses v3 data with a v2 reader', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-delegation-v2-')); roots.push(root)
  const legacy = new Context(); contexts.push(legacy)
  await legacy.plugin(Storage)
  await legacy.plugin(StorageJson, { root })
  await legacy.plugin(StorageDomain, { backend: 'json' })
  await legacy.plugin(HomeActivityService)
  const activity = await legacy.homeActivities.create(request)
  const legacyId = '00000000-0000-4000-8000-000000000099'
  const oldDomain = await legacy.storageDomain.open(legacyDelegationDomain)
  await oldDomain.table('delegations').put(legacyId, {
    id: legacyId,
    activityId: activity.id,
    request: {
      provider: 'spawn',
      task: 'Review the release checklist.',
      parentSessionId: 'parent-session',
      requestedChildSessionId: 'legacy-child-session',
      requestedAt: '2026-11-15T12:00:00.000Z',
      source: 'user-command',
    },
    status: 'reported',
    admission: {
      childSessionId: 'legacy-child-session',
      activationName: 'activity-legacy-1234',
      runId: 'legacy-run-1',
      admittedAt: '2026-11-15T12:00:01.000Z',
      source: 'subagents.startActivation',
    },
    report: {
      stopReason: 'completed',
      outputText: 'The checklist is complete.',
      nonTextBlockTypes: [],
      outputTruncated: false,
      reportedAt: '2026-11-15T12:00:02.000Z',
      source: 'subagent-activation-result',
    },
  })
  await oldDomain.close()
  await legacy.fiber.dispose()

  const current = await open(root)
  expect(current.homeActivityDelegations.get(activityDelegationId(legacyId))).toMatchObject({
    status: 'reported',
    request: { provider: 'spawn', requestedChildSessionId: 'legacy-child-session' },
    admission: { childSessionId: 'legacy-child-session' },
    report: { outputText: 'The checklist is complete.' },
  })
  const uncertain = await current.homeActivityDelegations.createRequest({
    activityId: activity.id,
    provider: 'codex',
    task: 'Check the checklist once.',
    parentSessionId: SessionId('parent-session'),
  })
  await current.homeActivityDelegations.markUnconfirmed(uncertain.id, undefined, 'codex-start-outcome-unknown')
  await current.fiber.dispose()

  const oldReader = new Context(); contexts.push(oldReader)
  await oldReader.plugin(Storage)
  await oldReader.plugin(StorageJson, { root })
  await oldReader.plugin(StorageDomain, { backend: 'json' })
  await expect(oldReader.storageDomain.open(version2DelegationDomain))
    .rejects.toMatchObject({ code: 'version-mismatch' })
})

it('reads a strict v2 Codex record in v3 without requiring a write', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-delegation-v2-read-')); roots.push(root)
  const writer = new Context(); contexts.push(writer)
  await writer.plugin(Storage)
  await writer.plugin(StorageJson, { root })
  await writer.plugin(StorageDomain, { backend: 'json' })
  await writer.plugin(HomeActivityService)
  const activity = await writer.homeActivities.create(request)
  const previous = await writer.storageDomain.open(version2DelegationDomain)
  const id = activityDelegationId('00000000-0000-4000-8000-000000000098')
  const requestAt = '2026-11-15T12:00:00.000Z'
  await previous.table('delegations').put(id, {
    id,
    activityId: activity.id,
    request: {
      provider: 'codex',
      task: 'Review the release checklist.',
      parentSessionId: SessionId('parent-session'),
      requestedAt: requestAt,
      source: 'user-command',
    },
    status: 'reported',
    admission: {
      provider: 'codex',
      providerRunId: 'codex-provider-run-v2',
      admittedAt: requestAt,
      source: 'subagents.startActivation',
    },
    report: {
      stopReason: 'completed',
      outputText: 'The release checklist is ready.',
      nonTextBlockTypes: [],
      outputTruncated: false,
      reportedAt: requestAt,
      source: 'subagent-activation-result',
    },
  })
  await previous.close()
  await writer.fiber.dispose()

  const current = await open(root)
  expect(current.homeActivityDelegations.get(id)).toMatchObject({
    status: 'reported',
    request: { provider: 'codex' },
    admission: { provider: 'codex', providerRunId: 'codex-provider-run-v2' },
    report: { outputText: 'The release checklist is ready.' },
  })
})

it('recovers unfinished requests and admissions as unconfirmed without rearming work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-recovery-')); roots.push(root)
  const first = await open(root)
  const activity = await first.homeActivities.create(request)
  const notStarted = await first.homeActivityDelegations.createRequest({
    activityId: activity.id,
    provider: 'spawn',
    task: 'Inspect the release checklist.',
    parentSessionId: SessionId('parent-session'),
  })
  const accepted = await first.homeActivityDelegations.createRequest({
    activityId: activity.id,
    provider: 'spawn',
    task: 'Check the changelog for breaking changes.',
    parentSessionId: SessionId('parent-session'),
  })
  const rejected = await first.homeActivityDelegations.createRequest({
    activityId: activity.id,
    provider: 'spawn',
    task: 'Record a rejected startup.',
    parentSessionId: SessionId('parent-session'),
  })
  await first.homeActivityDelegations.markNotAdmitted(rejected.id, 'The provider rejected startup.')
  const reported = await first.homeActivityDelegations.createRequest({
    activityId: activity.id,
    provider: 'spawn',
    task: 'Record a provider report.',
    parentSessionId: SessionId('parent-session'),
  })
  const admission = {
    childSessionId: SessionId('accepted-child'),
    activationName: 'activity-6f18de32',
    admittedAt: '2026-11-15T12:00:00.000Z',
    source: 'subagents.startActivation' as const,
  }
  await first.homeActivityDelegations.recordAdmitted(accepted.id, admission)
  await first.homeActivityDelegations.recordReported(reported.id, admission, {
    stopReason: 'stop', outputText: 'Completed.', nonTextBlockTypes: [], outputTruncated: false,
    reportedAt: '2026-11-15T12:00:01.000Z', source: 'subagent-activation-result',
  })
  await first.fiber.dispose()

  const recovered = await open(root)
  const recoveredRequest = recovered.homeActivityDelegations.get(activityDelegationId(notStarted.id))
  if (notStarted.request.provider !== 'spawn') throw new Error('This recovery case must use a DSH spawn request.')
  if (recoveredRequest?.request.provider !== 'spawn') throw new Error('The reopened record must preserve its DSH spawn request.')
  expect(recoveredRequest).toMatchObject({
    status: 'unconfirmed',
    uncertainty: { reason: 'restart-before-admission-recorded' },
  })
  expect(recoveredRequest.request.requestedChildSessionId)
    .toBe(notStarted.request.requestedChildSessionId)
  expect(recoveredRequest?.admission).toBeUndefined()
  expect(recovered.homeActivityDelegations.get(accepted.id)).toMatchObject({
    status: 'unconfirmed',
    admission,
    uncertainty: { reason: 'restart-before-report-recorded' },
  })
  expect(recovered.homeActivityDelegations.get(rejected.id)?.status).toBe('not-admitted')
  expect(recovered.homeActivityDelegations.get(reported.id)?.status).toBe('reported')
  expect(recovered.homeActivityDelegations.get(activityDelegationId('00000000-0000-4000-8000-000000000099'))).toBeUndefined()
  expect(recovered.homeActivityDelegations.list(activity.id)).toHaveLength(4)
})

it('does not label a rejected startup as an admitted or reported outcome', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-not-admitted-')); roots.push(root)
  const ctx = await open(root)
  const activity = await ctx.homeActivities.create(request)
  const saved = await ctx.homeActivityDelegations.createRequest({
    activityId: activity.id,
    provider: 'spawn',
    task: 'Check the release checklist.',
    parentSessionId: SessionId('parent-session'),
  })

  const rejected = await ctx.homeActivityDelegations.markNotAdmitted(saved.id, 'The selected provider is unavailable.')
  expect(rejected.status).toBe('not-admitted')
  expect(rejected.admission).toBeUndefined()
  expect(rejected.report).toBeUndefined()
  await expect(ctx.homeActivityDelegations.recordAdmitted(saved.id, {
    childSessionId: SessionId('child-session'),
    activationName: 'activity-4a8c2f10',
    admittedAt: '2026-11-15T12:00:00.000Z',
    source: 'subagents.startActivation',
  })).rejects.toMatchObject({ code: 'invalid-transition' })
})

it('requires a saved Activity and bounds task persistence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-delegation-validation-')); roots.push(root)
  const ctx = await open(root)
  await expect(ctx.homeActivityDelegations.createRequest({
    activityId: ActivityId('00000000-0000-4000-8000-000000000000'),
    provider: 'spawn',
    task: 'Check the release checklist.',
    parentSessionId: SessionId('parent-session'),
  })).rejects.toMatchObject({ code: 'activity-not-found' })
  const activity = await ctx.homeActivities.create(request)
  await expect(ctx.homeActivityDelegations.createRequest({
    activityId: activity.id,
    provider: 'spawn',
    task: 'x'.repeat(4_097),
    parentSessionId: SessionId('parent-session'),
  })).rejects.toMatchObject({ code: 'invalid-request' })
})

it('validates each persisted lifecycle state and rejects mismatched facts', () => {
  const id = '00000000-0000-4000-8000-000000000001'
  const activityId = '00000000-0000-4000-8000-000000000002'
  const requestFact = {
    provider: 'spawn',
    task: 'Inspect the release checklist.',
    parentSessionId: 'parent-session',
    requestedChildSessionId: 'requested-child-session',
    requestedAt: '2026-11-15T12:00:00.000Z',
    source: 'user-command',
  }
  const admission = {
    childSessionId: 'child-session',
    activationName: 'activity-12345678',
    runId: 'run-1',
    admittedAt: '2026-11-15T12:00:01.000Z',
    source: 'subagents.startActivation',
  }
  const report = {
    stopReason: 'error',
    outputText: 'Partial provider output.',
    nonTextBlockTypes: ['reasoning'],
    outputTruncated: false,
    diagnostic: 'Provider-authored diagnostic.',
    reportedAt: '2026-11-15T12:00:02.000Z',
    source: 'subagent-activation-result',
  }
  const failure = { message: 'The provider rejected startup.', source: 'subagents.startActivation' }
  const uncertainty = { reason: 'report-write-failed', observedAt: '2026-11-15T12:00:03.000Z' }
  const facts = { id, activityId, request: requestFact }
  const codexRequest = {
    provider: 'codex',
    task: 'Inspect the release checklist.',
    parentSessionId: 'parent-session',
    requestedAt: '2026-11-15T12:00:00.000Z',
    source: 'user-command',
  }
  const codexAdmission = {
    provider: 'codex',
    providerRunId: 'codex-provider-run-3',
    admittedAt: '2026-11-15T12:00:01.000Z',
    source: 'subagents.startActivation',
  }
  const codexStartUncertainty = {
    reason: 'codex-start-outcome-unknown',
    observedAt: '2026-11-15T12:00:02.000Z',
  }
  const valid = [
    { ...facts, status: 'requested' },
    { ...facts, status: 'not-admitted', failure },
    { ...facts, status: 'admitted', admission },
    { ...facts, status: 'reported', admission, report },
    { ...facts, status: 'unconfirmed', admission, uncertainty },
  ] as const
  for (const record of valid) expect(activityDelegationRecordSchema.safeParse(record).success).toBe(true)

  for (const record of [
    { ...facts, request: codexRequest, status: 'requested' },
    { ...facts, request: codexRequest, status: 'not-admitted', failure },
    { ...facts, request: codexRequest, status: 'admitted', admission: codexAdmission },
    { ...facts, request: codexRequest, status: 'reported', admission: codexAdmission, report },
    { ...facts, request: codexRequest, status: 'unconfirmed', admission: codexAdmission, uncertainty },
    { ...facts, request: codexRequest, status: 'unconfirmed', uncertainty: codexStartUncertainty },
  ]) expect(activityDelegationRecordSchema.safeParse(record).success).toBe(true)

  const invalid = [
    { ...facts, status: 'requested', admission },
    { ...facts, status: 'not-admitted' },
    { ...facts, status: 'admitted' },
    { ...facts, status: 'reported', admission },
    { ...facts, status: 'reported', admission, report, failure },
    { ...facts, status: 'unconfirmed', admission },
    { ...facts, status: 'unconfirmed', admission, report, uncertainty },
  ] as const
  for (const record of invalid) expect(activityDelegationRecordSchema.safeParse(record).success).toBe(false)

  expect(activityDelegationRecordSchema.safeParse({
    ...facts,
    request: codexRequest,
    status: 'reported',
    admission,
    report,
  }).success).toBe(false)

  expect(activityDelegationRecordSchema.safeParse({
    ...facts,
    request: { ...requestFact, task: '€'.repeat(1_400) },
    status: 'requested',
  }).success).toBe(false)
  expect(activityDelegationRecordSchema.safeParse({
    ...facts,
    request: { ...requestFact, task: '€'.repeat(1_400) },
    status: 'reported',
    admission,
    report: { ...report, outputText: '€'.repeat(6_000) },
  }).success).toBe(false)
  expect(activityDelegationRecordSchema.safeParse({
    ...facts,
    status: 'reported',
    admission,
    report: { ...report, diagnostic: '€'.repeat(1_400) },
  }).success).toBe(false)
})

it('keeps persistence-write uncertainty visible until a later durable fact succeeds', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-delegation-write-failure-')); roots.push(root)
  const ctx = await open(root)
  const activity = await ctx.homeActivities.create(request)
  const otherActivity = await ctx.homeActivities.create({
    ...request,
    name: 'Other activity',
    objective: 'Keep unrelated delegation listings separate.',
  })
  const saved = await ctx.homeActivityDelegations.createRequest({
    activityId: activity.id,
    provider: 'spawn',
    task: 'Inspect a persistence failure.',
    parentSessionId: SessionId('parent-session'),
  })
  const admission = {
    childSessionId: SessionId('child-session'),
    activationName: 'activity-writefail',
    admittedAt: '2026-11-15T12:00:00.000Z',
    source: 'subagents.startActivation' as const,
  }
  const table = Reflect.get(ctx.homeActivityDelegations, 'table') as KvTable<string, ActivityDelegation>
  const prototype = Object.getPrototypeOf(table) as Pick<KvTable<string, ActivityDelegation>, 'update'>
  const update = vi.spyOn(prototype, 'update')
  try {
    update.mockRejectedValueOnce(new Error('admission write failed'))
    await expect(ctx.homeActivityDelegations.recordAdmitted(saved.id, admission)).rejects.toThrow('admission write failed')
    expect(ctx.homeActivityDelegations.get(saved.id)).toMatchObject({
      status: 'unconfirmed',
      admission,
      uncertainty: { reason: 'admission-write-failed' },
    })
    expect(ctx.homeActivityDelegations.list(activity.id)).toHaveLength(1)
    expect(ctx.homeActivityDelegations.list(otherActivity.id)).toEqual([])

    update.mockRejectedValueOnce(new Error('report write failed'))
    await expect(ctx.homeActivityDelegations.recordReported(saved.id, admission, {
      stopReason: 'stop',
      outputText: '',
      nonTextBlockTypes: [],
      outputTruncated: false,
      reportedAt: '2026-11-15T12:00:01.000Z',
      source: 'subagent-activation-result',
    })).rejects.toThrow('report write failed')
    expect(ctx.homeActivityDelegations.get(saved.id)).toMatchObject({
      status: 'unconfirmed',
      uncertainty: { reason: 'report-write-failed' },
    })

    update.mockRejectedValueOnce(new Error('uncertainty write failed'))
    await expect(ctx.homeActivityDelegations.markUnconfirmed(saved.id, admission, 'startup-result-rejected'))
      .rejects.toThrow('uncertainty write failed')
    expect(ctx.homeActivityDelegations.get(saved.id)).toMatchObject({
      status: 'unconfirmed',
      uncertainty: { reason: 'startup-result-rejected' },
    })

    update.mockRestore()
    const reported = await ctx.homeActivityDelegations.recordReported(saved.id, admission, {
      stopReason: 'stop',
      outputText: '',
      nonTextBlockTypes: [],
      outputTruncated: false,
      reportedAt: '2026-11-15T12:00:02.000Z',
      source: 'subagent-activation-result',
    })
    expect(reported.status).toBe('reported')
    expect(ctx.homeActivityDelegations.get(saved.id)?.status).toBe('reported')
  } finally {
    update.mockRestore()
  }
})

it('rejects illegal transitions and reports an unready service clearly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-delegation-transitions-')); roots.push(root)
  const ctx = await open(root)
  const activity = await ctx.homeActivities.create(request)
  const saved = await ctx.homeActivityDelegations.createRequest({
    activityId: activity.id,
    provider: 'spawn',
    task: 'Exercise lifecycle transitions.',
    parentSessionId: SessionId('parent-session'),
  })
  const admission = {
    childSessionId: SessionId('child-session'),
    activationName: 'activity-transitions',
    admittedAt: '2026-11-15T12:00:00.000Z',
    source: 'subagents.startActivation' as const,
  }
  await expect(ctx.homeActivityDelegations.recordReported(activityDelegationId('00000000-0000-4000-8000-000000000099'), admission, {
    stopReason: 'stop', outputText: '', nonTextBlockTypes: [], outputTruncated: false,
    reportedAt: '2026-11-15T12:00:01.000Z', source: 'subagent-activation-result',
  })).rejects.toMatchObject({ code: 'invalid-transition' })

  await ctx.homeActivityDelegations.markNotAdmitted(saved.id, 'Provider did not publish an activation.')
  await expect(ctx.homeActivityDelegations.markNotAdmitted(saved.id, 'duplicate')).rejects.toMatchObject({ code: 'invalid-transition' })
  await expect(ctx.homeActivityDelegations.markUnconfirmed(saved.id, admission, 'startup-result-rejected'))
    .rejects.toMatchObject({ code: 'invalid-transition' })

  const reportedRequest = await ctx.homeActivityDelegations.createRequest({
    activityId: activity.id,
    provider: 'spawn',
    task: 'Exercise reported-state transitions.',
    parentSessionId: SessionId('parent-session'),
  })
  await ctx.homeActivityDelegations.recordAdmitted(reportedRequest.id, admission)
  await ctx.homeActivityDelegations.recordReported(reportedRequest.id, admission, {
    stopReason: 'stop', outputText: '', nonTextBlockTypes: [], outputTruncated: false,
    reportedAt: '2026-11-15T12:00:02.000Z', source: 'subagent-activation-result',
  })
  await expect(ctx.homeActivityDelegations.recordReported(reportedRequest.id, admission, {
    stopReason: 'stop', outputText: '', nonTextBlockTypes: [], outputTruncated: false,
    reportedAt: '2026-11-15T12:00:03.000Z', source: 'subagent-activation-result',
  })).rejects.toMatchObject({ code: 'invalid-transition' })
  await expect(ctx.homeActivityDelegations.markUnconfirmed(reportedRequest.id, admission, 'startup-result-rejected'))
    .rejects.toMatchObject({ code: 'invalid-transition' })

  const unready = new HomeActivityDelegationService(new Context())
  expect(() => unready.get(reportedRequest.id)).toThrow('storage is not ready')
})

it('sorts equal request timestamps by stable identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-delegation-order-')); roots.push(root)
  const ctx = await open(root)
  const activity = await ctx.homeActivities.create(request)
  const first = await ctx.homeActivityDelegations.createRequest({
    activityId: activity.id, provider: 'spawn', task: 'First request.', parentSessionId: SessionId('parent-session'),
  })
  const second = await ctx.homeActivityDelegations.createRequest({
    activityId: activity.id, provider: 'spawn', task: 'Second request.', parentSessionId: SessionId('parent-session'),
  })
  const table = Reflect.get(ctx.homeActivityDelegations, 'table') as KvTable<string, ActivityDelegation>
  const timestamp = '2026-11-15T12:00:00.000Z'
  await table.put(first.id, { ...first, request: { ...first.request, requestedAt: timestamp } })
  await table.put(second.id, { ...second, request: { ...second.request, requestedAt: timestamp } })
  const ordered = ctx.homeActivityDelegations.list(activity.id)
    .map(record => String(record.id))
    .sort()
  expect(ctx.homeActivityDelegations.list(activity.id).map(record => String(record.id))).toEqual(ordered)
})
