/** User-linked artifact pointers kept separate from delegation lifecycle facts. @module @deepseek-ai/dsh-home-activity/artifact-types */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ActivityDelegationId } from './delegation-types.ts'
import type { ActivityId } from './types.ts'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

/** Stable identity of one user-linked artifact pointer. */
export type ActivityArtifactId = Branded<'ActivityArtifactId'>

/** A pointer the user recorded for an artifact or result associated with a delegation. */
export interface ActivityArtifactReference {
  /** Stable pointer identity. */
  readonly id: ActivityArtifactId
  /** Activity that owns this reference. */
  readonly activityId: ActivityId
  /** Existing delegation identity selected by the user. */
  readonly delegationId: ActivityDelegationId
  /** Workspace context selected by the user; it does not verify the delegation's execution context. */
  readonly workspaceId: WorkspaceId
  /** User-supplied description of the referenced output. */
  readonly label: string
  /** User-supplied path or URL where the output can be inspected. */
  readonly location: string
  /** User-supplied source revision; absence means the revision is unknown. */
  readonly revision?: string | undefined
  /** Identifies the user command that recorded the pointer, not the artifact producer. */
  readonly source: 'user-command'
  /** Time the pointer was recorded. */
  readonly recordedAt: string
}

/** Fields supplied by the user when recording one pointer. */
export type CreateActivityArtifactRequest = Pick<
  ActivityArtifactReference,
  'activityId' | 'delegationId' | 'workspaceId' | 'label' | 'location' | 'revision'
>
