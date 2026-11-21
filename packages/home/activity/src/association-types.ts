/** Persisted association vocabulary for Home Activities. @module @deepseek-ai/dsh-home-activity/association-types */

import type { ActivityId } from './types.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

/** Separately user-authored references from an Activity to existing contexts. */
export interface HomeActivityAssociations {
  /** Existing Workspace registry identities selected by the user. */
  readonly workspaceIds: readonly WorkspaceId[]
  /** Existing DSH Session identities selected by the user. */
  readonly sessionIds: readonly SessionId[]
}

/** Version-one durable row; empty associations are represented by no row. */
export interface HomeActivityAssociationRecord extends HomeActivityAssociations {
  /** Stable Activity identity used as the row key. */
  readonly activityId: ActivityId
  /** Last successful association mutation time in UTC. */
  readonly updatedAt: string
}
