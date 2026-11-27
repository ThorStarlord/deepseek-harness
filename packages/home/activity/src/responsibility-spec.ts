/**
 * Versioned StorageDomain layout for immutable Activity responsibility facts.
 * @module @deepseek-ai/dsh-home-activity/responsibility-spec
 */

import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type {
  ActivityResponsibilityFact,
  ActivityResponsibilityFactId,
  ActivityResponsibilityId,
} from './responsibility-types.ts'
import type { ActivityId } from './types.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

const activityIdSchema = z.uuid().transform(value => brandString<ActivityId>(value))
const responsibilityIdSchema = z.uuid().transform(value => brandString<ActivityResponsibilityId>(value))
const factIdSchema = z.uuid().transform(value => brandString<ActivityResponsibilityFactId>(value))
const requestIdSchema = z.uuid()
const sessionIdSchema = z.string().trim().min(1).max(256).regex(/^\S+$/u).transform(value => brandString<SessionId>(value))
const workspaceIdSchema = z.uuid().transform(value => brandString<WorkspaceId>(value))
const safeLine = z.string().trim().min(1).regex(/^[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+$/u)

/** Maximum append-only facts retained for one Activity. */
export const MAX_HOME_ACTIVITY_RESPONSIBILITY_FACTS_PER_ACTIVITY = 4_096
/** Maximum source Session event references retained for one report. */
export const MAX_HOME_ACTIVITY_RESPONSIBILITY_SOURCE_EVENTS = 128

/** Validate and brand an idempotency key at a durable or wire input. */
export const activityResponsibilityRequestIdSchema = requestIdSchema
  .transform(value => brandString<ActivityResponsibilityFact['requestId']>(value))
const requestId = activityResponsibilityRequestIdSchema
const targetSchema = z.object({
  workspaceId: workspaceIdSchema,
  sessionId: sessionIdSchema,
}).strict()

const proposalSchema = z.object({
  target: targetSchema,
  task: safeLine.max(4_000),
  inScope: z.array(safeLine.max(1_000)).max(32),
  outOfScope: z.array(safeLine.max(1_000)).max(32),
  expectedOutcome: safeLine.max(2_000),
  prerequisites: z.array(safeLine.max(1_000)).max(32),
  conflictingWork: z.array(safeLine.max(1_000)).max(32),
}).strict()

/** Persist only the local owner identity; Peer metadata can contain fields unsuitable for durable storage. */
export const activityResponsibilityPrincipalSchema = z.object({ kind: z.literal('owner') }).strict()
const principalSchema = activityResponsibilityPrincipalSchema

const actorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('authenticated-user'), principal: principalSchema }).strict(),
  z.object({ kind: z.literal('dsh-session'), sessionId: sessionIdSchema }).strict(),
])

const factBaseSchema = z.object({
  id: factIdSchema,
  responsibilityId: responsibilityIdSchema,
  activityId: activityIdSchema,
  revision: z.number().int().positive().max(MAX_HOME_ACTIVITY_RESPONSIBILITY_FACTS_PER_ACTIVITY),
  previousFactId: factIdSchema.optional(),
  requestId,
  recordedAt: z.iso.datetime(),
})

const sourceEventSeqsSchema = z.array(z.number().int().nonnegative())
  .min(1).max(MAX_HOME_ACTIVITY_RESPONSIBILITY_SOURCE_EVENTS)
  .refine(values => new Set(values).size === values.length, 'source Session event sequences must be unique')

const observationSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('available'),
    cursor: z.number().int().nonnegative(),
    agentAvailable: z.boolean(),
    active: z.boolean(),
    running: z.boolean(),
    queueAvailable: z.boolean(),
    pendingInput: z.array(z.enum(['approval', 'question', 'other'])).max(16),
  }).strict(),
  z.object({
    status: z.literal('unavailable'),
    reason: z.enum(['not-found', 'access-denied', 'disconnected', 'unknown']),
  }).strict(),
])

const factSchemas = [
  factBaseSchema.extend({
    kind: z.literal('proposed'),
    proposal: proposalSchema,
    source: z.object({
      kind: z.literal('coordinating-session'),
      sessionId: sessionIdSchema,
      eventSeq: z.number().int().nonnegative().optional(),
    }).strict(),
  }).strict(),
  factBaseSchema.extend({
    kind: z.literal('confirmed'),
    proposalFactId: factIdSchema,
    proposal: proposalSchema,
    actor: z.object({ kind: z.literal('authenticated-user'), principal: principalSchema }).strict(),
  }).strict(),
  factBaseSchema.extend({
    kind: z.literal('dispatch-attempted'),
    promptRequestId: requestId,
    targetSessionId: sessionIdSchema,
    source: z.literal('session-controller.prompt'),
  }).strict(),
  factBaseSchema.extend({
    kind: z.literal('dispatch-settled'),
    promptRequestId: requestId,
    targetSessionId: sessionIdSchema,
    outcome: z.enum(['accepted', 'not-admitted', 'uncertain']),
    diagnostic: safeLine.max(1_000).optional(),
    source: z.literal('session-controller.prompt'),
  }).strict(),
  factBaseSchema.extend({
    kind: z.literal('observed'),
    targetSessionId: sessionIdSchema,
    observedAt: z.iso.datetime(),
    observation: observationSchema,
    source: z.literal('session-controller.state'),
  }).strict(),
  factBaseSchema.extend({
    kind: z.literal('reported'),
    targetSessionId: sessionIdSchema,
    promptRequestId: requestId,
    sourceEventSeqs: sourceEventSeqsSchema,
    summary: safeLine.max(4_000),
    reportedAt: z.iso.datetime(),
    source: z.literal('target-session-assistant-message'),
  }).strict(),
  factBaseSchema.extend({
    kind: z.literal('verification-recorded'),
    reportFactId: factIdSchema,
    actor: actorSchema,
    evidence: z.object({
      source: safeLine.max(240),
      reference: safeLine.max(2_048).optional(),
      result: z.enum(['passed', 'failed', 'inconclusive', 'unavailable']),
      summary: safeLine.max(2_000),
      observedAt: z.iso.datetime().optional(),
    }).strict(),
  }).strict(),
  factBaseSchema.extend({
    kind: z.literal('acceptance-recorded'),
    reportFactId: factIdSchema,
    disposition: z.enum(['accepted', 'declined', 'requires-follow-up']),
    actor: z.object({ kind: z.literal('authenticated-user'), principal: principalSchema }).strict(),
    supersedes: factIdSchema.optional(),
  }).strict(),
] as const

/** Strict, discriminated persistent fact row; additions require a versioned successor domain. */
export const activityResponsibilityFactSchema = z.discriminatedUnion('kind', factSchemas)
  .superRefine((fact, context) => {
    if (fact.revision === 1 && fact.kind !== 'proposed') {
      context.addIssue({ code: 'custom', message: 'the first responsibility fact must be a proposal' })
    }
    if (fact.revision > 1 && (fact.kind === 'proposed' || fact.previousFactId === undefined)) {
      context.addIssue({ code: 'custom', message: 'later responsibility facts must identify their predecessor' })
    }
    if (fact.kind === 'dispatch-attempted' && fact.promptRequestId !== fact.requestId) {
      context.addIssue({ code: 'custom', message: 'dispatch attempt request id must match the Session prompt request id' })
    }
  }) satisfies z.ZodType<ActivityResponsibilityFact>

/** Validated proposal fields before trusted Activity identity and recording metadata are added. */
export const createActivityResponsibilityRequestSchema = z.object({
  activityId: activityIdSchema,
  requestId,
  coordinatingSessionId: sessionIdSchema,
  sourceEventSeq: z.number().int().nonnegative().optional(),
  ...proposalSchema.shape,
}).strict()

/** Validated exact proposal echo and principal supplied by the authenticated confirmation route. */
export const confirmActivityResponsibilityRequestSchema = z.object({
  activityId: activityIdSchema,
  responsibilityId: responsibilityIdSchema,
  requestId,
  proposalFactId: factIdSchema,
  proposal: proposalSchema,
  principal: principalSchema,
}).strict()

/** Validate the exact request identity before a target Session prompt is dispatched. */
export const beginActivityResponsibilityDispatchRequestSchema = z.object({
  activityId: activityIdSchema,
  responsibilityId: responsibilityIdSchema,
  promptRequestId: requestId,
}).strict()

/** Validate the result and identity returned by the authenticated prompt route. */
export const settleActivityResponsibilityDispatchRequestSchema = beginActivityResponsibilityDispatchRequestSchema.extend({
  outcome: z.enum(['accepted', 'not-admitted', 'uncertain']),
  diagnostic: safeLine.max(1_000).optional(),
}).strict()

/** Validated passive Session observation; the target identity comes from its proposal. */
export const recordActivityResponsibilityObservationRequestSchema = z.object({
  activityId: activityIdSchema,
  responsibilityId: responsibilityIdSchema,
  requestId,
  observedAt: z.iso.datetime(),
  observation: observationSchema,
}).strict()

/** Validated report fields; source Session identity comes from its proposal. */
export const recordActivityResponsibilityReportRequestSchema = z.object({
  activityId: activityIdSchema,
  responsibilityId: responsibilityIdSchema,
  requestId,
  promptRequestId: requestId,
  sourceEventSeqs: sourceEventSeqsSchema,
  summary: safeLine.max(4_000),
  reportedAt: z.iso.datetime(),
}).strict()

/** Validated verification evidence tied to a report in the same responsibility. */
export const recordActivityResponsibilityVerificationRequestSchema = z.object({
  activityId: activityIdSchema,
  responsibilityId: responsibilityIdSchema,
  requestId,
  reportFactId: factIdSchema,
  actor: actorSchema,
  evidence: z.object({
    source: safeLine.max(240),
    reference: safeLine.max(2_048).optional(),
    result: z.enum(['passed', 'failed', 'inconclusive', 'unavailable']),
    summary: safeLine.max(2_000),
    observedAt: z.iso.datetime().optional(),
  }).strict(),
}).strict()

/** Validated user disposition tied to a report in the same responsibility. */
export const recordActivityResponsibilityAcceptanceRequestSchema = z.object({
  activityId: activityIdSchema,
  responsibilityId: responsibilityIdSchema,
  requestId,
  reportFactId: factIdSchema,
  disposition: z.enum(['accepted', 'declined', 'requires-follow-up']),
  principal: principalSchema,
}).strict()

/** Independent additive version-one domain for append-only responsibility facts. */
export const homeActivityResponsibilitiesDomain = defineDomain({
  name: 'home_activity_responsibilities',
  version: 1,
  tables: {
    facts: domainTable<ActivityResponsibilityFactId, ActivityResponsibilityFact>(activityResponsibilityFactSchema),
  },
})
