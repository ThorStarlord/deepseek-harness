/** User-recorded disposition and verification evidence for one Activity delegation. @module @deepseek-ai/dsh-home-activity/review-types */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ActivityDelegationId } from './delegation-types.ts'
import type { ActivityId } from './types.ts'

/** Stable identity of one user-supplied evidence entry. */
export type ActivityReviewEvidenceId = Branded<'ActivityReviewEvidenceId'>

/** Current user disposition of a provider-reported responsibility. */
export type ActivityReviewDisposition = 'pending' | 'accepted' | 'declined' | 'requires-investigation'

/** Result reported by the source of one verification evidence entry. */
export type ActivityReviewEvidenceResult = 'passed' | 'failed' | 'inconclusive' | 'unavailable'

/** Evidence details supplied by a user and kept separate from provider reports. */
export interface ActivityReviewEvidence {
  /** Stable identity of this evidence entry. */
  readonly id: ActivityReviewEvidenceId
  /** User-entered name of the evidence source, such as a CI run or test report. */
  readonly source: string
  /** Result the named source reported; DSH does not verify the source or result. */
  readonly result: ActivityReviewEvidenceResult
  /** User-entered summary of the evidence. */
  readonly summary: string
  /** Optional user-entered link or identifier for the evidence. */
  readonly reference?: string | undefined
  /** When the user says the source observed this result. */
  readonly observedAt?: string | undefined
  /** When this entry was recorded in DSH. */
  readonly recordedAt: string
  /** Identifies the DSH command that recorded the entry, not its evidence source. */
  readonly origin: 'user-command'
}

/** Separate user review of one delegation; provider lifecycle facts remain unchanged. */
export interface ActivityReview {
  /** Activity that owns the reviewed delegation. */
  readonly activityId: ActivityId
  /** Reviewed delegation identity, also the durable record key. */
  readonly delegationId: ActivityDelegationId
  /** User's latest disposition; a missing review record means `pending`. */
  readonly disposition: ActivityReviewDisposition
  /** User-supplied verification evidence in recording order. */
  readonly evidence: readonly ActivityReviewEvidence[]
  /** When the user last recorded a disposition or evidence entry. */
  readonly updatedAt: string
  /** Identifies the command that recorded this review, not a verification authority. */
  readonly source: 'user-command'
}

/** Fields supplied by the user to update a delegation review. */
export interface RecordActivityReviewRequest {
  /** Existing saved Activity. */
  readonly activityId: ActivityId
  /** Delegation owned by the selected Activity. */
  readonly delegationId: ActivityDelegationId
  /** The user's explicit disposition. */
  readonly disposition: ActivityReviewDisposition
  /** Optional evidence entry reported by the user. */
  readonly evidence?: Omit<ActivityReviewEvidence, 'id' | 'recordedAt' | 'origin'> | undefined
}
