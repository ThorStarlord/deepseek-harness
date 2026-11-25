/**
 * Versioned sidecar storage for target-authored Activity responsibility status reports.
 * @module @deepseek-ai/dsh-home-activity/responsibility-status-spec
 */

import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { ActivityResponsibilityStatusReport, ActivityResponsibilityStatusReportId } from './responsibility-types.ts'
import type { ActivityId } from './activity-types.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ActivityResponsibilityId, ActivityResponsibilityRequestId } from './responsibility-types.ts'

const activityIdSchema = z.uuid().transform(value => brandString<ActivityId>(value))
const responsibilityIdSchema = z.uuid().transform(value => brandString<ActivityResponsibilityId>(value))
const reportIdSchema = z.uuid().transform(value => brandString<ActivityResponsibilityStatusReportId>(value))
const sessionIdSchema = z.string().trim().min(1).max(256).regex(/^\S+$/u).transform(value => brandString<SessionId>(value))
const requestIdSchema = z.uuid().transform(value => brandString<ActivityResponsibilityRequestId>(value))
const safeLine = z.string().trim().min(1).max(1_000).regex(/^[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+$/u)

/** Maximum reports retained for one responsibility. */
export const MAX_ACTIVITY_RESPONSIBILITY_STATUS_REPORTS = 64

/** Strict version-one row for target-authored progress, separate from final outcome facts. */
export const activityResponsibilityStatusReportSchema: z.ZodType<ActivityResponsibilityStatusReport> = z.object({
  id: reportIdSchema,
  activityId: activityIdSchema,
  responsibilityId: responsibilityIdSchema,
  targetSessionId: sessionIdSchema,
  promptRequestId: requestIdSchema,
  status: z.enum(['progress', 'waiting', 'ready', 'blocked', 'failed']),
  summary: safeLine,
  sourceEventSeq: z.number().int().nonnegative(),
  recordedAt: z.iso.datetime(),
  source: z.literal('target-session-status-tool'),
}).strict()

/** Parse one model-visible target status report before it reaches durable storage. */
export const recordActivityResponsibilityStatusReportRequestSchema = z.object({
  activityId: activityIdSchema,
  responsibilityId: responsibilityIdSchema,
  callerSessionId: sessionIdSchema,
  sourceEventSeq: z.number().int().nonnegative(),
  status: z.enum(['progress', 'waiting', 'ready', 'blocked', 'failed']),
  summary: safeLine,
}).strict()

/** Separate versioned domain; the strict responsibility v1 fact reader remains unchanged. */
export const homeActivityResponsibilityStatusReportsDomain = defineDomain({
  name: 'home_activity_responsibility_status_reports',
  version: 1,
  tables: {
    reports: domainTable<string, ActivityResponsibilityStatusReport>(activityResponsibilityStatusReportSchema),
  },
})
