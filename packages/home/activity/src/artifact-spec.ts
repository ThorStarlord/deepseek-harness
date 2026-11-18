/** Versioned StorageDomain layout for user-linked Activity artifact pointers. @module @deepseek-ai/dsh-home-activity/artifact-spec */

import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { ActivityArtifactId, ActivityArtifactReference } from './artifact-types.ts'
import type { ActivityDelegationId } from './delegation-types.ts'
import type { ActivityId } from './types.ts'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

const idSchema = z.uuid().transform(value => brandString<ActivityArtifactId>(value))
const activityIdSchema = z.uuid().transform(value => brandString<ActivityId>(value))
const delegationIdSchema = z.uuid().transform(value => brandString<ActivityDelegationId>(value))
const workspaceIdSchema = z.uuid().transform(value => brandString<WorkspaceId>(value))
const safeText = z.string().trim().min(1).regex(/^[^\p{Cc}]+$/u)

/** Maximum number of user-linked artifact pointers stored for one Activity. */
export const MAX_HOME_ACTIVITY_ARTIFACTS_PER_ACTIVITY = 512

/** Strict durable row schema; adding fields requires a versioned successor. */
export const activityArtifactReferenceSchema = z.object({
  id: idSchema,
  activityId: activityIdSchema,
  delegationId: delegationIdSchema,
  workspaceId: workspaceIdSchema,
  label: safeText.max(160),
  location: safeText.max(2048),
  revision: safeText.max(256).optional(),
  source: z.literal('user-command'),
  recordedAt: z.iso.datetime(),
}).strict() satisfies z.ZodType<ActivityArtifactReference>

/** The independent, additive version-one artifact-reference domain. */
export const homeActivityArtifactsDomain = defineDomain({
  name: 'home_activity_artifacts',
  version: 1,
  tables: {
    artifacts: domainTable<ActivityArtifactId, ActivityArtifactReference>(activityArtifactReferenceSchema),
  },
})
