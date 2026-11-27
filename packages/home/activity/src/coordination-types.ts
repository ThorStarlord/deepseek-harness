/** Client-safe wire values for Activity-scoped cross-Session coordination. @module @deepseek-ai/dsh-home-activity/coordination-types */

import type { SessionId, SessionSeqCursor } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { Activity, ActivityId } from './activity-types.ts'
import type { HomeActivityAssociations } from './association-types.ts'
import type {
  ActivityResponsibilityFactId,
  ActivityResponsibilityHistory,
  ActivityResponsibilityId,
  ActivityResponsibilityProposal,
  ActivityResponsibilityReportedFact,
  ActivityResponsibilityRequestId,
  ActivityResponsibilityStatusReport,
} from './responsibility-types.ts'

/** One explicitly selected Workspace and root Session pair. */
export interface ActivityCoordinationTarget {
  readonly workspaceId: WorkspaceId
  readonly sessionId: SessionId
}

/** Bounded text retained from one source Session message. */
export interface ActivityCoordinationMessage {
  readonly role: 'user' | 'assistant'
  readonly sourceKind: string
  readonly eventSeq: number
  readonly time: number
  readonly text: string
  readonly truncated: boolean
  readonly provider?: string
  readonly model?: string
  readonly requestId?: string
}

/** One passive, source-attributed view of an authorized root Session. */
export interface ActivityCoordinationSessionSnapshot {
  readonly activityId: ActivityId
  readonly workspaceId: WorkspaceId
  readonly workspaceTitle: string
  readonly workspacePath: string
  readonly sessionId: SessionId
  readonly sessionCwd: string
  readonly sessionCreatedAt: number
  readonly observedAt: number
  readonly source: 'live' | 'prepared'
  readonly cursor: SessionSeqCursor
  /** `not-loaded` and `loaded` do not imply that work completed. */
  readonly runtime: 'running' | 'loaded' | 'not-loaded'
  readonly recentMessages: readonly ActivityCoordinationMessage[]
}

/** One saved Activity and its descriptive Workspace and Session references. */
export interface ActivityCoordinationCatalogItem {
  readonly activity: Activity
  readonly associations: HomeActivityAssociations
}

/** Authorized durable responsibility histories for one Activity. */
export interface ActivityCoordinationResponsibilityList {
  readonly items: readonly ActivityResponsibilityHistory[]
  /** Target-authored progress reports scoped to the returned histories. */
  readonly statusReports?: readonly ActivityResponsibilityStatusReport[]
}

/** A model recommendation tied to an exact assistant message in the coordinating Session. */
export interface ActivityCoordinationProposalRequest extends ActivityResponsibilityProposal {
  readonly activityId: ActivityId
  readonly requestId: ActivityResponsibilityRequestId
  readonly coordinatingSessionId: SessionId
  readonly sourceEventSeq: number
}

/** The authenticated user's exact confirmation; the Host creates the target prompt identity. */
export interface ActivityCoordinationDispatchRequest {
  readonly activityId: ActivityId
  readonly responsibilityId: ActivityResponsibilityId
  readonly proposalFactId: ActivityResponsibilityFactId
  readonly proposal: ActivityResponsibilityProposal
  readonly confirmationRequestId: ActivityResponsibilityRequestId
}

/** Result of one confirmed Client-mediated prompt delivery. */
export interface ActivityCoordinationDispatchResult {
  readonly outcome: 'accepted' | 'not-admitted' | 'uncertain'
  /** Host-generated native Session request identity used to correlate admission and any later report. */
  readonly promptRequestId: string
  readonly recorded: boolean
  readonly diagnostic?: 'access-denied' | 'target-unavailable' | 'target-busy' | 'delivery-uncertain' | 'history-unconfirmed'
  readonly history: ActivityResponsibilityHistory
}

/** Passive refresh and outcome-recovery result; runtime availability is not completion. */
export interface ActivityCoordinationReconcileResult {
  readonly history: ActivityResponsibilityHistory
  readonly statusReports?: readonly ActivityResponsibilityStatusReport[]
  readonly observed: {
    readonly cursor: number
    readonly active: boolean
    readonly running: boolean
    readonly queueAvailable: boolean
    readonly pendingInput: readonly ('approval' | 'question' | 'other')[]
  }
  readonly reportState: 'no-dispatch' | 'awaiting-target-input' | 'awaiting-turn-end' | 'no-completed-response' | 'reported'
  readonly report?: ActivityResponsibilityReportedFact
}
