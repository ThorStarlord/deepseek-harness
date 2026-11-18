/** Versioned StorageDomain layout for externally reported Activity handoffs. @module @deepseek-ai/dsh-home-activity/handoff-spec */

import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { ActivityHandoff, ActivityHandoffArtifact, ActivityHandoffId } from './handoff-types.ts'
import type { ActivityId } from './types.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'

const handoffIdSchema = z.uuid().transform(value => brandString<ActivityHandoffId>(value))
const activityIdSchema = z.uuid().transform(value => brandString<ActivityId>(value))
const sessionIdSchema = z.string().trim().min(1).max(256).regex(/^\S+$/u).transform(value => brandString<SessionId>(value))
const safeLine = z.string().trim().min(1).regex(/^[^\p{Cc}\p{Cf}]+$/u)

/** Maximum handoffs retained for one Activity. */
export const MAX_HOME_ACTIVITY_HANDOFFS_PER_ACTIVITY = 256
/** Maximum external artifact references attached to one handoff. */
export const MAX_HOME_ACTIVITY_HANDOFF_ARTIFACTS_PER_HANDOFF = 32

const handoffArtifactSchema = z.object({
  label: safeLine.max(160),
  location: safeLine.max(2048),
  revision: safeLine.max(256).optional(),
}).strict() satisfies z.ZodType<ActivityHandoffArtifact>

/** Parse user-supplied handoff details before adding Activity and DSH Session identity. */
export const createActivityHandoffDetailsSchema = z.object({
  source: safeLine.max(120),
  summary: safeLine.max(4000).optional(),
  sourceReference: safeLine.max(2048).optional(),
  artifacts: z.array(handoffArtifactSchema).max(MAX_HOME_ACTIVITY_HANDOFF_ARTIFACTS_PER_HANDOFF).default([]),
}).strict().refine(record => record.summary !== undefined || record.sourceReference !== undefined || record.artifacts.length > 0, {
  message: 'A handoff needs a user-supplied summary, source reference, or artifact reference.',
})

/** Strict durable row schema; additions require a versioned successor. */
export const activityHandoffSchema = z.object({
  id: handoffIdSchema,
  activityId: activityIdSchema,
  source: safeLine.max(120),
  summary: safeLine.max(4000).optional(),
  sourceReference: safeLine.max(2048).optional(),
  artifacts: z.array(handoffArtifactSchema).max(MAX_HOME_ACTIVITY_HANDOFF_ARTIFACTS_PER_HANDOFF),
  recordedInSessionId: sessionIdSchema,
  origin: z.literal('user-supplied-external'),
  recordedAt: z.iso.datetime(),
}).strict().refine(record => record.summary !== undefined || record.sourceReference !== undefined || record.artifacts.length > 0, {
  message: 'A handoff needs a user-supplied summary, source reference, or artifact reference.',
}) satisfies z.ZodType<ActivityHandoff>

/** The independent, additive version-one external handoff domain. */
export const homeActivityHandoffsDomain = defineDomain({
  name: 'home_activity_handoffs',
  version: 1,
  tables: {
    handoffs: domainTable<ActivityHandoffId, ActivityHandoff>(activityHandoffSchema),
  },
})
