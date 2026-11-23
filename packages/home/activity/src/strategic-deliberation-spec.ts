/** Versioned StorageDomain layout for Activity Strategic Deliberations.
 * @module @deepseek-ai/dsh-home-activity/strategic-deliberation-spec
 */

import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type {
  ActivityStrategicDeliberation,
  ActivityStrategicDeliberationId,
  ActivityStrategicNewUncertainty,
  ActivityStrategicEvidenceUse,
  ActivityStrategicUncertaintyReview,
  RecordActivityStrategicDeliberationRequest,
} from './strategic-deliberation-types.ts'
import type { ActivityId } from './types.ts'
import type { ActivityStrategicEpisodeId } from './strategic-episode-types.ts'

const idSchema = z.uuid().transform(value => brandString<ActivityStrategicDeliberationId>(value))
const activityIdSchema = z.uuid().transform(value => brandString<ActivityId>(value))
const episodeIdSchema = z.uuid().transform(value => brandString<ActivityStrategicEpisodeId>(value))
const textSchema = z.string().trim().min(1).max(4_000)
const evidenceIdSchema = z.string().regex(/^E[1-9][0-9]{0,2}$/u)
const uncertaintyIdSchema = z.string().regex(/^U[1-9][0-9]{0,2}$/u)
const newUncertaintyIdSchema = z.string().regex(/^N[1-9][0-9]{0,2}$/u)

/** Maximum append-only deliberation revisions per Activity. */
export const MAX_HOME_ACTIVITY_STRATEGIC_DELIBERATIONS_PER_ACTIVITY = 128
/** Maximum serialized bytes for one deliberation. */
export const MAX_HOME_ACTIVITY_STRATEGIC_DELIBERATION_BYTES = 64 * 1024

const evidenceUseSchema = z.object({
  evidenceId: evidenceIdSchema,
  treatment: z.enum(['supports', 'challenges', 'limits', 'not-relied-on']),
  rationale: textSchema,
}).strict() satisfies z.ZodType<ActivityStrategicEvidenceUse>

const uncertaintyReviewSchema = z.object({
  uncertaintyId: uncertaintyIdSchema,
  treatment: z.enum(['remains-open', 'reframed', 'not-decision-relevant']),
  rationale: textSchema,
}).strict() satisfies z.ZodType<ActivityStrategicUncertaintyReview>

const newUncertaintySchema = z.object({
  id: newUncertaintyIdSchema,
  statement: textSchema,
  evidenceIds: z.array(evidenceIdSchema).max(256),
}).strict() satisfies z.ZodType<ActivityStrategicNewUncertainty>

const conclusionObjectSchema = z.object({
  decisionQuestion: textSchema.max(2_000),
  outcome: z.enum(['next-responsibility', 'no-selection', 'owner-decision', 'thesis-review', 'insufficient-evidence']),
  disposition: z.enum(['retain', 'adapt', 'reject', 'defer', 'escalate', 'no-selection']),
  proposedResponsibility: textSchema.nullable(),
  scope: z.enum(['within-activity', 'owner-decision', 'outside-activity']),
  rationale: textSchema,
  evidenceUses: z.array(evidenceUseSchema).max(256),
  uncertaintyReviews: z.array(uncertaintyReviewSchema).max(128),
  newUncertainties: z.array(newUncertaintySchema).max(64),
}).strict()

function validateConclusion(
  value: z.infer<typeof conclusionObjectSchema>,
  context: z.RefinementCtx,
): void {
  if (value.outcome === 'next-responsibility'
    && (value.proposedResponsibility === null || value.scope !== 'within-activity')) {
    context.addIssue({ code: 'custom', message: 'a next responsibility must be bounded within the Activity' })
  }
  if (value.outcome === 'no-selection' && value.proposedResponsibility !== null) {
    context.addIssue({ code: 'custom', message: 'a no-selection outcome cannot name a proposed responsibility' })
  }
  if (value.outcome === 'owner-decision' && (value.disposition !== 'escalate' || value.scope !== 'owner-decision')) {
    context.addIssue({ code: 'custom', message: 'an owner decision outcome must be an escalation with owner-decision scope' })
  }
  if (value.outcome === 'thesis-review' && (value.disposition !== 'escalate' || value.scope !== 'owner-decision')) {
    context.addIssue({ code: 'custom', message: 'a thesis review outcome must be an escalation with owner-decision scope' })
  }
  if (value.outcome === 'insufficient-evidence' && value.proposedResponsibility !== null) {
    context.addIssue({ code: 'custom', message: 'insufficient evidence cannot name a proposed responsibility' })
  }
  for (const [name, values] of [
    ['evidence', value.evidenceUses.map(item => item.evidenceId)],
    ['prior uncertainty', value.uncertaintyReviews.map(item => item.uncertaintyId)],
    ['new uncertainty', value.newUncertainties.map(item => item.id)],
  ] as const) {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: 'custom', message: `${name} references must be unique` })
    }
  }
}

/** Validates one advisory conclusion before its source attribution is persisted. */
export const activityStrategicDeliberationConclusionSchema = conclusionObjectSchema.superRefine(validateConclusion)

/** Strict model-authored request fields before the persistence service binds provenance. */
export const recordActivityStrategicDeliberationRequestSchema = conclusionObjectSchema.extend({
  activityId: activityIdSchema,
  originSessionId: z.string().min(1).max(256),
  requestId: z.uuid(),
  sourceEpisodeId: episodeIdSchema,
  sourceEpisodeRevision: z.number().int().positive().max(128),
  skillDigests: z.array(z.object({
    name: z.string().min(1).max(128),
    provider: z.string().min(1).max(128),
    digest: z.string().regex(/^[a-f0-9]{64}$/u),
  }).strict()).min(1).max(8),
  requestedAt: z.iso.datetime(),
}).strict().superRefine((request, context) => {
  validateConclusion(request, context)
  if (request.outcome === 'insufficient-evidence'
    && request.disposition !== 'defer' && request.disposition !== 'no-selection') {
    context.addIssue({ code: 'custom', message: 'insufficient evidence must defer or make no selection' })
  }
}) satisfies z.ZodType<RecordActivityStrategicDeliberationRequest>

/** Strict durable deliberation row; a later schema uses a successor StorageDomain version. */
export const activityStrategicDeliberationRecordSchema = z.object({
  id: idSchema,
  activityId: activityIdSchema,
  revision: z.number().int().positive().max(MAX_HOME_ACTIVITY_STRATEGIC_DELIBERATIONS_PER_ACTIVITY),
  supersedes: idSchema.optional(),
  originSessionId: z.string().min(1).max(256),
  producer: z.literal('dsh-active-agent'),
  requestId: z.uuid(),
  sourceEpisodeId: episodeIdSchema,
  sourceEpisodeRevision: z.number().int().positive().max(128),
  sourceEpisodeRecordedAt: z.iso.datetime(),
  sourceEpisodeSessionId: z.string().min(1).max(256),
  status: z.literal('complete'),
  ...conclusionObjectSchema.shape,
  skillDigests: z.array(z.object({
    name: z.string().min(1).max(128),
    provider: z.string().min(1).max(128),
    digest: z.string().regex(/^[a-f0-9]{64}$/u),
  }).strict()).min(1).max(8),
  requestedAt: z.iso.datetime(),
  recordedAt: z.iso.datetime(),
}).strict().superRefine((record, context) => {
  validateConclusion(record, context)
  if (record.outcome === 'insufficient-evidence'
    && record.disposition !== 'defer' && record.disposition !== 'no-selection') {
    context.addIssue({ code: 'custom', message: 'insufficient evidence must defer or make no selection' })
  }
}) satisfies z.ZodType<ActivityStrategicDeliberation>

/** The independent, additive version-one deliberation domain. */
export const homeActivityStrategicDeliberationsDomain = defineDomain({
  name: 'home_activity_strategic_deliberations',
  version: 1,
  tables: {
    deliberations: domainTable<ActivityStrategicDeliberationId, ActivityStrategicDeliberation>(activityStrategicDeliberationRecordSchema),
  },
})
