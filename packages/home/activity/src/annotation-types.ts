/** User-authored corrections to Home Activity coordination notes. @module @deepseek-ai/dsh-home-activity/annotation-types */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ActivityId } from './types.ts'

/** Stable identity of one immutable Activity annotation revision. */
export type ActivityAnnotationId = Branded<'ActivityAnnotationId'>

/** One user-authored annotation revision, kept separate from execution facts. */
export interface ActivityAnnotation {
  /** Stable identity of this revision. */
  readonly id: ActivityAnnotationId
  /** Activity whose coordination note this revision belongs to. */
  readonly activityId: ActivityId
  /** Monotonic revision number within the Activity. */
  readonly revision: number
  /** User-authored coordination note or interpretation. */
  readonly text: string
  /** Previous user annotation revision, when this note corrects one. */
  readonly supersedes?: ActivityAnnotationId | undefined
  /** Identifies the command that recorded the note, not a provider or specialist. */
  readonly source: 'user-command'
  /** Time this revision was recorded. */
  readonly recordedAt: string
}

/** Fields supplied when a user records or corrects the current annotation. */
export type CorrectActivityAnnotationRequest = Pick<ActivityAnnotation, 'activityId' | 'text'>
