/** Versioned StorageDomain layout for Home Activity context references. @module @deepseek-ai/dsh-home-activity/association-spec */

import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { ActivityId } from './types.ts'
import type { HomeActivityAssociationRecord } from './association-types.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

const activityIdSchema = z.uuid().transform(value => brandString<ActivityId>(value))
const workspaceIdSchema = z.uuid().transform(value => brandString<WorkspaceId>(value))
const sessionIdSchema = z.string().min(1).max(256).regex(/^\S+$/u).transform(value => brandString<SessionId>(value))
const unique = (values: readonly string[]): boolean => new Set(values).size === values.length

/** Maximum number of Workspace or Session references stored for one Activity. */
export const MAX_HOME_ACTIVITY_ASSOCIATIONS_PER_KIND = 256

/** Strict durable row schema; unrelated fields require a versioned migration. */
export const homeActivityAssociationRecordSchema = z.object({
  activityId: activityIdSchema,
  workspaceIds: z.array(workspaceIdSchema).max(MAX_HOME_ACTIVITY_ASSOCIATIONS_PER_KIND).refine(unique, 'Workspace ids must be unique'),
  sessionIds: z.array(sessionIdSchema).max(MAX_HOME_ACTIVITY_ASSOCIATIONS_PER_KIND).refine(unique, 'Session ids must be unique'),
  updatedAt: z.iso.datetime(),
}).strict().refine(record => record.workspaceIds.length + record.sessionIds.length > 0, 'An empty association row must be deleted')

/** The independent, additive version-one association domain. */
export const homeActivityAssociationsDomain = defineDomain({
  name: 'home_activity_associations',
  version: 1,
  tables: {
    activities: domainTable<ActivityId, HomeActivityAssociationRecord>(homeActivityAssociationRecordSchema),
  },
})
