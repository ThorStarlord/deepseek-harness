/** User-supplied references to work recorded from an external native interface. @module @deepseek-ai/dsh-home-activity/handoff-types */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ActivityId } from './types.ts'

/** Stable identity of one externally reported Activity handoff. */
export type ActivityHandoffId = Branded<'ActivityHandoffId'>

/** An artifact reference supplied by the user with an external handoff. */
export interface ActivityHandoffArtifact {
  /** User-supplied label for the referenced artifact. */
  readonly label: string
  /** User-supplied path or URL. DSH does not fetch or validate its contents. */
  readonly location: string
  /** User-supplied revision, when known. */
  readonly revision?: string | undefined
}

/** A separately initiated external result the user chose to record under an Activity. */
export interface ActivityHandoff {
  /** Stable handoff identity. */
  readonly id: ActivityHandoffId
  /** Existing Activity that owns this user-supplied record. */
  readonly activityId: ActivityId
  /** User-supplied name of the external native interface or source. */
  readonly source: string
  /** User-supplied short report, when provided. */
  readonly summary?: string | undefined
  /** User-supplied source link, when provided. DSH does not fetch it. */
  readonly sourceReference?: string | undefined
  /** User-supplied artifact references. */
  readonly artifacts: readonly ActivityHandoffArtifact[]
  /** DSH Session whose human command recorded the handoff. */
  readonly recordedInSessionId: SessionId
  /** Fixed attribution marker; this record is not imported native execution history. */
  readonly origin: 'user-supplied-external'
  /** Time DSH recorded the user-supplied handoff. */
  readonly recordedAt: string
}

/** User-supplied fields for recording an external Activity handoff. */
export type CreateActivityHandoffRequest = Pick<
  ActivityHandoff,
  'activityId' | 'source' | 'summary' | 'sourceReference' | 'artifacts' | 'recordedInSessionId'
>
