/** Shared Home Activity records without Host service augmentation. @module @deepseek-ai/dsh-home-activity/activity-types */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable identity of one persisted Home Activity. */
export type ActivityId = Branded<'ActivityId'>

/** Statements that describe intended work without granting runtime permissions. */
export interface ActivityBoundaries {
  /** Work the user intends to include. At least one statement is required. */
  readonly inScope: readonly string[]
  /** Work the user intends to exclude. */
  readonly outOfScope: readonly string[]
}

/** Immutable saved identity and intent for one user-directed undertaking. */
export interface Activity {
  /** Stable Activity identity retained across restarts. */
  readonly id: ActivityId
  /** Human-readable name. */
  readonly name: string
  /** User-supplied objective; saving it does not start work. */
  readonly objective: string
  /** User-supplied descriptive boundaries; they do not change tool permissions. */
  readonly boundaries: ActivityBoundaries
  /** Creation time in canonical UTC ISO-8601 form. */
  readonly createdAt: string
}

/** User-supplied fields for creating one Activity. */
export type CreateActivityRequest = Pick<Activity, 'name' | 'objective' | 'boundaries'>
