/** Append-only coordination facts for an Activity responsibility. @module @deepseek-ai/dsh-home-activity/responsibility-types */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { ActivityId } from './activity-types.ts'

/** Stable identity of one responsibility proposed for a target Session. */
export type ActivityResponsibilityId = Branded<'ActivityResponsibilityId'>

/** Stable identity of one immutable responsibility fact. */
export type ActivityResponsibilityFactId = Branded<'ActivityResponsibilityFactId'>

/** Idempotency identity supplied by the operation's caller. */
export type ActivityResponsibilityRequestId = Branded<'ActivityResponsibilityRequestId'>

/** Local DSH owner identity used for authenticated coordination decisions. */
export interface ActivityResponsibilityPrincipal {
  readonly kind: 'owner'
}

/** Actor that authored or recorded one responsibility fact. */
export interface ActivityResponsibilityUserActor {
  readonly kind: 'authenticated-user'
  readonly principal: ActivityResponsibilityPrincipal
}

/** A DSH Session that authored or recorded one responsibility fact. */
export interface ActivityResponsibilitySessionActor {
  readonly kind: 'dsh-session'
  readonly sessionId: SessionId
}

/** Actor that authored or recorded one responsibility fact. */
export type ActivityResponsibilityActor = ActivityResponsibilityUserActor | ActivityResponsibilitySessionActor

/** Explicit repository and root Session selected for the responsibility. */
export interface ActivityResponsibilityTarget {
  readonly workspaceId: WorkspaceId
  readonly sessionId: SessionId
}

/** Bounded task details fixed by the initial proposal and confirmed as a whole. */
export interface ActivityResponsibilityProposal {
  readonly target: ActivityResponsibilityTarget
  readonly task: string
  readonly inScope: readonly string[]
  readonly outOfScope: readonly string[]
  readonly expectedOutcome: string
  readonly prerequisites: readonly string[]
  readonly conflictingWork: readonly string[]
}

interface ActivityResponsibilityFactBase {
  readonly id: ActivityResponsibilityFactId
  readonly responsibilityId: ActivityResponsibilityId
  readonly activityId: ActivityId
  /** Append order within one responsibility. */
  readonly revision: number
  /** Prior fact in this responsibility's immutable history. */
  readonly previousFactId?: ActivityResponsibilityFactId | undefined
  /** Caller-supplied operation identity used to make retries idempotent. */
  readonly requestId: ActivityResponsibilityRequestId
  /** Time this fact was durably submitted, in UTC ISO-8601 form. */
  readonly recordedAt: string
}

/** An agent recommendation recorded without granting execution authority. */
export interface ActivityResponsibilityProposedFact extends ActivityResponsibilityFactBase {
  readonly kind: 'proposed'
  readonly proposal: ActivityResponsibilityProposal
  /** Session that produced the proposal and optional durable event cursor. */
  readonly source: { readonly kind: 'coordinating-session'; readonly sessionId: SessionId; readonly eventSeq?: number | undefined }
}

/** An authenticated user confirmation bound to the exact immutable proposal. */
export interface ActivityResponsibilityConfirmedFact extends ActivityResponsibilityFactBase {
  readonly kind: 'confirmed'
  readonly proposalFactId: ActivityResponsibilityFactId
  readonly proposal: ActivityResponsibilityProposal
  readonly actor: ActivityResponsibilityUserActor
}

/** A durable intent to prompt the selected target through Session Controller. */
export interface ActivityResponsibilityDispatchAttemptedFact extends ActivityResponsibilityFactBase {
  readonly kind: 'dispatch-attempted'
  /** Same request id sent to `session.prompt`; it is not a Session id. */
  readonly promptRequestId: ActivityResponsibilityRequestId
  readonly targetSessionId: SessionId
  readonly source: 'session-controller.prompt'
}

/** Admission result from the authenticated Session prompt route. */
export interface ActivityResponsibilityDispatchSettledFact extends ActivityResponsibilityFactBase {
  readonly kind: 'dispatch-settled'
  readonly promptRequestId: ActivityResponsibilityRequestId
  readonly targetSessionId: SessionId
  readonly outcome: 'accepted' | 'not-admitted' | 'uncertain'
  /** Safe diagnostic supplied by the route, when a known rejection explains the outcome. */
  readonly diagnostic?: string | undefined
  readonly source: 'session-controller.prompt'
}

/** A bounded passive observation of the target Session, not a responsibility status. */
export interface ActivityResponsibilityObservedFact extends ActivityResponsibilityFactBase {
  readonly kind: 'observed'
  readonly targetSessionId: SessionId
  readonly observedAt: string
  readonly observation:
    | {
      readonly status: 'available'
      readonly cursor: number
      readonly agentAvailable: boolean
      readonly active: boolean
      readonly running: boolean
      readonly queueAvailable: boolean
      readonly pendingInput: readonly ('approval' | 'question' | 'other')[]
    }
    | {
      readonly status: 'unavailable'
      readonly reason: 'not-found' | 'access-denied' | 'disconnected' | 'unknown'
    }
  readonly source: 'session-controller.state'
}

/** A concise target-authored result with references into its original Session log. */
export interface ActivityResponsibilityReportedFact extends ActivityResponsibilityFactBase {
  readonly kind: 'reported'
  readonly targetSessionId: SessionId
  readonly promptRequestId: ActivityResponsibilityRequestId
  readonly sourceEventSeqs: readonly number[]
  /** Bounded summary; the original Session remains the transcript source. */
  readonly summary: string
  readonly reportedAt: string
  readonly source: 'target-session-assistant-message'
}

/** Verification evidence recorded separately from the target's reported result. */
export interface ActivityResponsibilityVerificationFact extends ActivityResponsibilityFactBase {
  readonly kind: 'verification-recorded'
  readonly reportFactId: ActivityResponsibilityFactId
  readonly actor: ActivityResponsibilityActor
  readonly evidence: {
    readonly source: string
    readonly reference?: string | undefined
    readonly result: 'passed' | 'failed' | 'inconclusive' | 'unavailable'
    readonly summary: string
    readonly observedAt?: string | undefined
  }
}

/** A user disposition of one reported target outcome. */
export interface ActivityResponsibilityAcceptanceFact extends ActivityResponsibilityFactBase {
  readonly kind: 'acceptance-recorded'
  readonly reportFactId: ActivityResponsibilityFactId
  readonly disposition: 'accepted' | 'declined' | 'requires-follow-up'
  readonly actor: ActivityResponsibilityUserActor
  /** Previous user disposition for this responsibility, if one exists. */
  readonly supersedes?: ActivityResponsibilityFactId | undefined
}

/** One immutable fact in a responsibility history. */
export type ActivityResponsibilityFact =
  | ActivityResponsibilityProposedFact
  | ActivityResponsibilityConfirmedFact
  | ActivityResponsibilityDispatchAttemptedFact
  | ActivityResponsibilityDispatchSettledFact
  | ActivityResponsibilityObservedFact
  | ActivityResponsibilityReportedFact
  | ActivityResponsibilityVerificationFact
  | ActivityResponsibilityAcceptanceFact

/** Recovered facts for one Activity responsibility, oldest first. */
export interface ActivityResponsibilityHistory {
  readonly id: ActivityResponsibilityId
  readonly activityId: ActivityId
  readonly proposal: ActivityResponsibilityProposedFact
  readonly facts: readonly ActivityResponsibilityFact[]
}

/** New bounded recommendation from one coordinating Session. */
export interface CreateActivityResponsibilityRequest extends ActivityResponsibilityProposal {
  readonly activityId: ActivityId
  readonly requestId: ActivityResponsibilityRequestId
  readonly coordinatingSessionId: SessionId
  readonly sourceEventSeq?: number | undefined
}

/** Confirmation must echo the exact proposal displayed to the authenticated user. */
export interface ConfirmActivityResponsibilityRequest {
  readonly activityId: ActivityId
  readonly responsibilityId: ActivityResponsibilityId
  readonly requestId: ActivityResponsibilityRequestId
  readonly proposalFactId: ActivityResponsibilityFactId
  readonly proposal: ActivityResponsibilityProposal
  readonly principal: ActivityResponsibilityPrincipal
}

/** Request to durably mark the exact Session prompt operation before dispatch. */
export interface BeginActivityResponsibilityDispatchRequest {
  readonly activityId: ActivityId
  readonly responsibilityId: ActivityResponsibilityId
  readonly promptRequestId: ActivityResponsibilityRequestId
}

/** Result returned by the authenticated Session prompt route. */
export interface SettleActivityResponsibilityDispatchRequest extends BeginActivityResponsibilityDispatchRequest {
  readonly outcome: ActivityResponsibilityDispatchSettledFact['outcome']
  readonly diagnostic?: string | undefined
}

/** Passive Session Controller state captured for one target. */
export interface RecordActivityResponsibilityObservationRequest {
  readonly activityId: ActivityId
  readonly responsibilityId: ActivityResponsibilityId
  readonly requestId: ActivityResponsibilityRequestId
  readonly observedAt: string
  readonly observation: ActivityResponsibilityObservedFact['observation']
}

/** Bounded target-authored report text with exact references to its source Session events. */
export interface RecordActivityResponsibilityReportRequest {
  readonly activityId: ActivityId
  readonly responsibilityId: ActivityResponsibilityId
  readonly requestId: ActivityResponsibilityRequestId
  readonly promptRequestId: ActivityResponsibilityRequestId
  readonly sourceEventSeqs: readonly number[]
  readonly summary: string
  readonly reportedAt: string
}

/** Evidence about one report, attributed to its recorder and named source. */
export interface RecordActivityResponsibilityVerificationRequest {
  readonly activityId: ActivityId
  readonly responsibilityId: ActivityResponsibilityId
  readonly requestId: ActivityResponsibilityRequestId
  readonly reportFactId: ActivityResponsibilityFactId
  readonly actor: ActivityResponsibilityActor
  readonly evidence: ActivityResponsibilityVerificationFact['evidence']
}

/** User disposition of one report, distinct from verification evidence. */
export interface RecordActivityResponsibilityAcceptanceRequest {
  readonly activityId: ActivityId
  readonly responsibilityId: ActivityResponsibilityId
  readonly requestId: ActivityResponsibilityRequestId
  readonly reportFactId: ActivityResponsibilityFactId
  readonly disposition: ActivityResponsibilityAcceptanceFact['disposition']
  readonly principal: ActivityResponsibilityPrincipal
}
