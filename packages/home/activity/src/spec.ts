/** Durable JSON record layout for Home Activities. @module @deepseek-ai/dsh-home-activity/src/spec */

import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Activity, ActivityId } from './types.ts'

const activityIdSchema = z.uuid().transform(value => brandString<ActivityId>(value))
const statementSchema = z.string().trim().min(1).max(500)

const activityDetailsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  objective: z.string().trim().min(1).max(4_000),
  boundaries: z.object({
    inScope: z.array(statementSchema).min(1).max(20),
    outOfScope: z.array(statementSchema).max(20),
  }).strict(),
}).strict()

/** Record schema validated whenever the persistent domain opens or writes. */
export const activityRecordSchema = activityDetailsSchema.extend({
  id: activityIdSchema,
  createdAt: z.iso.datetime(),
})

/** Public create input validation shared by the service and command parser. */
export const createActivityRequestSchema = activityDetailsSchema

/** The versioned storage domain containing independently addressable Activities. */
export const homeActivityDomain = defineDomain({
  name: 'home_activities',
  version: 1,
  tables: { activities: domainTable<Activity['id'], Activity>(activityRecordSchema) },
})
