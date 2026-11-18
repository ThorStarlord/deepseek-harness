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

/** Product maturity label for an observed profile or preset selection. */
export type ActivityConfigurationClassification = 'stable' | 'experimental' | 'unavailable'

/** Launch-time profile bundle facts, or why DSH could not expose them. */
export type ActivityDelegationProfileSelectionSnapshot =
  | {
    readonly status: 'available'
    /** Profile name supplied by the DSH launcher. */
    readonly name: string
    /** Ordered bundles used by the launcher, or null when the complete list exceeded the persistence limit. */
    readonly startedBundles: readonly string[] | null
    /** Classification of the recorded bundle selection, not of its runtime permissions. */
    readonly classification: ActivityConfigurationClassification
    /** Product data that supports the classification. */
    readonly classificationSource: 'shipped-profile-template' | 'experimental-package-metadata' | 'unavailable'
  }
  | {
    readonly status: 'unavailable'
    /** Why the profile identity was not captured. */
    readonly reason: 'runtime-profile-unavailable' | 'profile-identity-exceeds-persistence-limit'
  }

/** Active preset facts captured from the parent composition before a child starts. */
export type ActivityDelegationPresetSelectionSnapshot =
  | { readonly status: 'none' }
  | {
    readonly status: 'selected'
    /** Stable preset id applied to the parent Agent and inherited by its DSH child. */
    readonly id: string
    /** Active module names in the retained preset revision, or null when inspection was unavailable. */
    readonly activeModules: readonly string[] | null
    /** Experimental is recorded only when an active module has explicit experimental metadata. */
    readonly classification: 'experimental' | 'unavailable'
    /** Product data that supports the classification. */
    readonly classificationSource: 'experimental-package-metadata' | 'unavailable'
  }
  | {
    readonly status: 'unavailable'
    /** Why the selected preset identity could not be captured. */
    readonly reason:
        | 'agent-preset-registry-unavailable'
        | 'preset-identity-exceeds-persistence-limit'
        | 'preset-module-list-exceeds-persistence-limit'
  }

/** DSH profile and preset facts captured for one native spawn request. */
export interface DshActivityDelegationExecutionSelectionSnapshot {
  /** The child uses the DSH composition associated with the user-requesting runtime. */
  readonly provider: 'spawn'
  /** Runtime profile supplied at process launch. */
  readonly profile: ActivityDelegationProfileSelectionSnapshot
  /** Preset revision joined by the parent and inherited by its child. */
  readonly preset: ActivityDelegationPresetSelectionSnapshot
}

/** Codex owns its external composition and does not expose DSH profile or preset facts. */
export interface ExternalActivityDelegationExecutionSelectionSnapshot {
  /** The selected provider owns a runtime outside DSH's profile and preset registry. */
  readonly provider: 'codex'
  /** Reason DSH cannot report that provider's selected configuration. */
  readonly unavailableReason: 'external-provider-does-not-expose-dsh-composition'
}

/** Provider-specific runtime configuration captured when the request is saved. */
export type ActivityDelegationExecutionSelectionSnapshot =
  | DshActivityDelegationExecutionSelectionSnapshot
  | ExternalActivityDelegationExecutionSelectionSnapshot

interface ActivityDelegationRequestBase {
  /** One bounded task sent as the selected provider's initial request. */
  readonly task: string
  /** Exact parent Session that invoked the command. */
  readonly parentSessionId: SessionId
  /** Time the request was durably saved, in canonical UTC ISO-8601 form. */
  readonly requestedAt: string
  /** Records that the request originated from the human `/activity` command. */
  readonly source: 'user-command'
  /** Runtime selection captured before startup; absent only in records created before selection support. */
  readonly executionSelection?: ActivityDelegationExecutionSelectionSnapshot | undefined
}

/** Request persisted before a local DSH child starts. */
export interface SpawnActivityDelegationRequest extends ActivityDelegationRequestBase {
  /** DSH-native in-process provider selected by the user. */
  readonly provider: 'spawn'
  /** Child Session identity requested from the provider; does not establish admission. */
  readonly requestedChildSessionId: SessionId
}

/** Request persisted before an external native Codex run starts. */
export interface CodexActivityDelegationRequest extends ActivityDelegationRequestBase {
  /** External native Codex provider selected by the user. */
  readonly provider: 'codex'
}

/** The explicit user request persisted before provider startup. */
export type ActivityDelegationRequest =
  | SpawnActivityDelegationRequest
  | CodexActivityDelegationRequest

interface ActivityDelegationAdmissionBase {
  /** Matched `subagent/start` identity when the lifecycle event was observed. */
  readonly runId?: SubagentRunId | undefined
  /** Time the runtime accepted the activation. */
  readonly admittedAt: string
  /** Identifies the DSH API that accepted this activation. */
  readonly source: 'subagents.startActivation'
}

/** Existing DSH-native `spawn` admission; older records omit a provider field. */
export interface SpawnActivityDelegationAdmission extends ActivityDelegationAdmissionBase {
  /** Stable child Session identity returned by the accepted activation. */
  readonly childSessionId: SessionId
  /** Runtime activation name returned by the accepted local activation. */
  readonly activationName: string
  /** Optional discriminator for new callers; legacy records have no provider field. */
  readonly provider?: 'spawn' | undefined
}

/** External Codex admission through its one-shot SubagentRun adapter. */
export interface CodexActivityDelegationAdmission extends ActivityDelegationAdmissionBase {
  /** The external native Codex route accepted this one-shot execution. */
  readonly provider: 'codex'
  /** SubagentRun adapter id, not a DSH Session id or native Codex conversation id. */
  readonly providerRunId: string
}

/** The DSH activation accepted by `ctx.subagents.startActivation`. */
export type ActivityDelegationAdmission =
  | SpawnActivityDelegationAdmission
  | CodexActivityDelegationAdmission

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

/** Why DSH definitively did not publish an activation. */
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
    | 'codex-start-outcome-unknown'
  /** Time this uncertainty was recorded or recovered. */
  readonly observedAt: string
}

/** Version-4 delegation sidecar entry; Activity v1 remains unchanged. */
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
  /** Supported provider explicitly selected by the user. */
  readonly provider: 'spawn' | 'codex'
  /** One bounded task. */
  readonly task: string
  /** Exact live Session that owns the command invocation. */
  readonly parentSessionId: SessionId
  /** DSH composition snapshot for `spawn`; omitted data is recorded as unavailable. Ignored for `codex`. */
  readonly executionSelection?: DshActivityDelegationExecutionSelectionSnapshot | undefined
}
