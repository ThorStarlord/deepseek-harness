/** Append-only records of reconsidered Activity Strategic Briefs. @module @deepseek-ai/dsh-home-activity/strategic-deliberation-types */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ActivityId } from './types.ts'
import type { ActivityStrategicEpisodeId } from './strategic-episode-types.ts'

/** Stable identity of one saved strategic deliberation. */
export type ActivityStrategicDeliberationId = Branded<'ActivityStrategicDeliberationId'>

/** A prior brief citation and the new agent's treatment of it. */
export interface ActivityStrategicEvidenceUse {
  readonly evidenceId: string
  readonly treatment: 'supports' | 'challenges' | 'limits' | 'not-relied-on'
  readonly rationale: string
}

/** Review of an uncertainty retained by the selected historical brief. */
export interface ActivityStrategicUncertaintyReview {
  readonly uncertaintyId: string
  readonly treatment: 'remains-open' | 'reframed' | 'not-decision-relevant'
  readonly rationale: string
}

/** New unresolved uncertainty raised by reconsidering the prior brief. */
export interface ActivityStrategicNewUncertainty {
  readonly id: string
  readonly statement: string
  readonly evidenceIds: readonly string[]
}

/** Durable advisory reconsideration linked to one exact historical brief. */
export interface ActivityStrategicDeliberation {
  readonly id: ActivityStrategicDeliberationId
  readonly activityId: ActivityId
  readonly revision: number
  readonly supersedes?: ActivityStrategicDeliberationId | undefined
  readonly originSessionId: string
  readonly producer: 'dsh-active-agent'
  readonly requestId: string
  readonly sourceEpisodeId: ActivityStrategicEpisodeId
  readonly sourceEpisodeRevision: number
  readonly sourceEpisodeRecordedAt: string
  readonly sourceEpisodeSessionId: string
  readonly decisionQuestion: string
  readonly status: 'complete'
  readonly outcome: 'next-responsibility' | 'no-selection' | 'owner-decision' | 'thesis-review' | 'insufficient-evidence'
  readonly disposition: 'retain' | 'adapt' | 'reject' | 'defer' | 'escalate' | 'no-selection'
  readonly proposedResponsibility: string | null
  readonly scope: 'within-activity' | 'owner-decision' | 'outside-activity'
  readonly rationale: string
  readonly evidenceUses: readonly ActivityStrategicEvidenceUse[]
  readonly uncertaintyReviews: readonly ActivityStrategicUncertaintyReview[]
  readonly newUncertainties: readonly ActivityStrategicNewUncertainty[]
  readonly skillDigests: readonly { readonly name: string; readonly provider: string; readonly digest: string }[]
  readonly requestedAt: string
  readonly recordedAt: string
}

/** Model-authored conclusion captured for an explicit reconsideration request. */
export type RecordActivityStrategicDeliberationRequest = Pick<
  ActivityStrategicDeliberation,
  | 'activityId'
  | 'originSessionId'
  | 'requestId'
  | 'sourceEpisodeId'
  | 'sourceEpisodeRevision'
  | 'decisionQuestion'
  | 'outcome'
  | 'disposition'
  | 'proposedResponsibility'
  | 'scope'
  | 'rationale'
  | 'evidenceUses'
  | 'uncertaintyReviews'
  | 'newUncertainties'
  | 'skillDigests'
  | 'requestedAt'
>
