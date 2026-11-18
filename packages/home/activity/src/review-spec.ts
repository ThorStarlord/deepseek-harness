/** Versioned StorageDomain layout for user reviews of Activity delegations. @module @deepseek-ai/dsh-home-activity/review-spec */

import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { ActivityDelegationId } from './delegation-types.ts'
import type { ActivityId } from './types.ts'
import type { ActivityReview, ActivityReviewEvidenceId } from './review-types.ts'

const activityIdSchema = z.uuid().transform(value => brandString<ActivityId>(value))
const delegationIdSchema = z.uuid().transform(value => brandString<ActivityDelegationId>(value))
const evidenceIdSchema = z.uuid().transform(value => brandString<ActivityReviewEvidenceId>(value))
const safeText = z.string().trim().min(1).regex(/^[^\p{Cc}]+$/u)

/** Maximum user-supplied evidence entries retained for one delegation review. */
export const MAX_HOME_ACTIVITY_REVIEW_EVIDENCE = 128

const activityReviewEvidenceSchema = z.object({
  id: evidenceIdSchema,
  source: safeText.max(128),
  result: z.enum(['passed', 'failed', 'inconclusive', 'unavailable']),
  summary: safeText.max(1_024),
  reference: safeText.max(2_048).optional(),
  observedAt: z.iso.datetime().optional(),
  recordedAt: z.iso.datetime(),
  origin: z.literal('user-command'),
}).strict()

/** Strict durable review row; changing persisted fields requires a versioned successor. */
export const activityReviewRecordSchema = z.object({
  activityId: activityIdSchema,
  delegationId: delegationIdSchema,
  disposition: z.enum(['pending', 'accepted', 'declined', 'requires-investigation']),
  evidence: z.array(activityReviewEvidenceSchema).max(MAX_HOME_ACTIVITY_REVIEW_EVIDENCE),
  updatedAt: z.iso.datetime(),
  source: z.literal('user-command'),
}).strict() satisfies z.ZodType<ActivityReview>

/** The independent, additive version-one Activity review domain. */
export const homeActivityReviewsDomain = defineDomain({
  name: 'home_activity_reviews',
  version: 1,
  tables: {
    reviews: domainTable<ActivityDelegationId, ActivityReview>(activityReviewRecordSchema),
  },
})
