/** Persisted facts for one user-requested Activity delegation. @module @deepseek-ai/dsh-home-activity/delegation-types */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentRunId } from '@deepseek-ai/dsh-subagent'
import type { ActivityId } from './types.ts'

/** Stable identity of one Activity delegation request. */
export type ActivityDelegationId = Branded<'ActivityDelegationId'>

/** Durable lifecycle label for separately sourced delegation facts. */
export type ActivityDelegationStatus =
  | 'requested'
  | 'not-admitted'
  | 'admitted'
  | 'reported'
  | 'unconfirmed'

/** The explicit user request persisted before provider startup. */
export interface ActivityDelegationRequest {
  /** DSH-native provider selected by the user. */
  readonly provider: 'spawn'
  /** One bounded task sent as the child Session's initial user message. */
  readonly task: string
  /** Exact parent Session that invoked the command. */
  readonly parentSessionId: SessionId
  /** Child Session identity requested from the provider; does not establish admission. */
  readonly requestedChildSessionId: SessionId
  /** Time the request was durably saved, in canonical UTC ISO-8601 form. */
  readonly requestedAt: string
  /** Records that the request originated from the human `/activity` command. */
  readonly source: 'user-command'
}

/** The DSH activation accepted by `ctx.subagents.startActivation`. */
export interface ActivityDelegationAdmission {
  /** Stable child Session identity returned by the accepted activation. */
  readonly childSessionId: SessionId
  /** Runtime activation name returned by the accepted activation. */
  readonly activationName: string
  /** Matched `subagent/start` identity when the lifecycle event was observed. */
  readonly runId?: SubagentRunId | undefined
  /** Time the runtime accepted the activation. */
  readonly admittedAt: string
  /** Identifies the DSH API that accepted this activation. */
  readonly source: 'subagents.startActivation'
}

/** A provider-authored report, without verification or user-acceptance claims. */
export interface ActivityDelegationReport {
  /** Provider-reported terminal reason; merge-extensible provider values are retained. */
  readonly stopReason: string
  /** Text blocks returned by the provider, clipped only at the declared byte limit. */
  readonly outputText: string
  /** Non-text result block types present in the provider response. */
  readonly nonTextBlockTypes: readonly string[]
  /** Whether `outputText` was clipped to the persistence limit. */
  readonly outputTruncated: boolean
  /** Provider-authored diagnostic, when supplied. */
  readonly diagnostic?: string | undefined
  /** Time the activation result settled. */
  readonly reportedAt: string
  /** Identifies the managed activation result that supplied this report. */
  readonly source: 'subagent-activation-result'
}

/** Why the start call rejected before publishing an activation. */
export interface ActivityDelegationFailure {
  /** Safe user-facing explanation; provider error details remain in the host log. */
  readonly message: string
  /** Identifies the rejected DSH startup operation. */
  readonly source: 'subagents.startActivation'
}

/** Why the saved state cannot establish the final execution or persistence fact. */
export interface ActivityDelegationUncertainty {
  /** Known point where the execution or its report became uncertain. */
  readonly reason:
    | 'restart-before-admission-recorded'
    | 'restart-before-report-recorded'
    | 'admission-write-failed'
    | 'report-write-failed'
    | 'startup-result-rejected'
  /** Time this uncertainty was recorded or recovered. */
  readonly observedAt: string
}

/** Version-1 sidecar entry; Activity v1 remains unchanged. */
export interface ActivityDelegation {
  /** Stable delegation identity. */
  readonly id: ActivityDelegationId
  /** Activity owning the request. */
  readonly activityId: ActivityId
  /** Request saved before any provider execution begins. */
  readonly request: ActivityDelegationRequest
  /** Current persistence state for the distinct facts below. */
  readonly status: ActivityDelegationStatus
  /** Present only after `startActivation` returns an accepted activation. */
  readonly admission?: ActivityDelegationAdmission | undefined
  /** Present only after the managed activation result is reported. */
  readonly report?: ActivityDelegationReport | undefined
  /** Present only when startup rejects before publication. */
  readonly failure?: ActivityDelegationFailure | undefined
  /** Explicit uncertainty after interrupted recording or a restart. */
  readonly uncertainty?: ActivityDelegationUncertainty | undefined
}

/** New Activity delegation request accepted by the service. */
export interface CreateActivityDelegationRequest {
  /** Existing saved Activity. */
  readonly activityId: ActivityId
  /** DSH-native provider explicitly selected by the user. */
  readonly provider: 'spawn'
  /** One bounded task. */
  readonly task: string
  /** Exact live Session that owns the command invocation. */
  readonly parentSessionId: SessionId
}
