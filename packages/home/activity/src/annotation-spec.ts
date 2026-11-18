/** Versioned StorageDomain layout for Home Activity annotation history. @module @deepseek-ai/dsh-home-activity/annotation-spec */

import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { ActivityAnnotation, ActivityAnnotationId } from './annotation-types.ts'
import type { ActivityId } from './types.ts'

const annotationIdSchema = z.uuid().transform(value => brandString<ActivityAnnotationId>(value))
const activityIdSchema = z.uuid().transform(value => brandString<ActivityId>(value))
const noteSchema = z.string().trim().min(1).max(4_000).regex(/^[^\p{Cc}]+$/u)

/** Maximum immutable annotation revisions stored for one Activity. */
export const MAX_HOME_ACTIVITY_ANNOTATIONS_PER_ACTIVITY = 256

/** Strict durable annotation row; new fields require a versioned successor. */
export const activityAnnotationRecordSchema = z.object({
  id: annotationIdSchema,
  activityId: activityIdSchema,
  revision: z.number().int().positive().max(MAX_HOME_ACTIVITY_ANNOTATIONS_PER_ACTIVITY),
  text: noteSchema,
  supersedes: annotationIdSchema.optional(),
  source: z.literal('user-command'),
  recordedAt: z.iso.datetime(),
}).strict() satisfies z.ZodType<ActivityAnnotation>

/** Public note input validation shared by the service and command. */
export const correctActivityAnnotationRequestSchema = z.object({
  activityId: activityIdSchema,
  text: noteSchema,
}).strict()

/** The independent, additive version-one Activity annotation domain. */
export const homeActivityAnnotationsDomain = defineDomain({
  name: 'home_activity_annotations',
  version: 1,
  tables: {
    annotations: domainTable<ActivityAnnotationId, ActivityAnnotation>(activityAnnotationRecordSchema),
  },
})
