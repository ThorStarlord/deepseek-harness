/**
 * User-invoked DSH-native delegation through the saved Activity command.
 * @module @deepseek-ai/dsh-command-home-activity/delegation-command
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { StorageError } from '@deepseek-ai/dsh-storage'
import { SubagentError, type SubagentRunId } from '@deepseek-ai/dsh-subagent'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { ActivityId } from '@deepseek-ai/dsh-home-activity'
import { ActivityDelegationError } from '@deepseek-ai/dsh-home-activity/delegations'
import type {
  ActivityDelegation,
  ActivityDelegationAdmission,
  ActivityDelegationReport,
  ActivityDelegationUncertainty,
} from '@deepseek-ai/dsh-home-activity/delegations'
import { captureActivityDelegationExecutionSelection } from './execution-selection.ts'

const MAX_TASK_BYTES = 4_096
const MAX_RENDERED_SELECTION_NAMES = 12
const DELEGATE_USAGE = 'Usage: /activity delegate <activity-id> spawn|codex|claude-code <one bounded task>'
const uncertaintySources: Record<ActivityDelegationUncertainty['reason'], string> = {
  'restart-before-admission-recorded': 'application restart recovery',
  'restart-before-report-recorded': 'application restart recovery',
  'admission-write-failed': 'Activity persistence',
  'report-write-failed': 'Activity persistence',
  'startup-result-rejected': 'activation result observer',
  'codex-start-outcome-unknown': 'native Codex start response',
  'claude-code-start-outcome-unknown': 'native Claude Code start response',
}
type SpawnExecutionSelectionSnapshot = Extract<
  NonNullable<ActivityDelegation['request']['executionSelection']>,
  { readonly provider: 'spawn' }
>
const taskSchema = z.string().trim().min(1).max(MAX_TASK_BYTES)
  .refine(value => Buffer.byteLength(value, 'utf8') <= MAX_TASK_BYTES, `task must not exceed ${MAX_TASK_BYTES} UTF-8 bytes`)

/** Start one user-requested task through the existing managed activation API.
 * @param ctx - Command services.
 * @param invocation - Exact live command owner and request cancellation.
 * @param rawInput - Input following `/activity delegate`.
 * @returns The admission or a safe command error.
 */
export async function executeActivityDelegation(
  ctx: Context,
  invocation: CommandInvocation,
  rawInput: string,
): Promise<CommandResult> {
  const match = /^\s*(\S+)\s+(\S+)\s+([\s\S]+)$/u.exec(rawInput)
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) {
    return { kind: 'error', text: DELEGATE_USAGE }
  }
  const activityIdResult = z.uuid().safeParse(match[1])
  if (!activityIdResult.success) return { kind: 'error', text: `Activity id must be a UUID. ${DELEGATE_USAGE}` }
  if (match[2] !== 'spawn' && match[2] !== 'codex' && match[2] !== 'claude-code') {
    return { kind: 'error', text: `Provider ${JSON.stringify(match[2])} is not supported here. Choose spawn, codex, or claude-code. ${DELEGATE_USAGE}` }
  }
  const parsedTask = taskSchema.safeParse(match[3])
  if (!parsedTask.success) {
    return { kind: 'error', text: `Delegated task is invalid: ${parsedTask.error.issues.map(issue => issue.message).join('; ')}.` }
  }
  const activityId = ctx.homeActivities.get(ActivityId(activityIdResult.data))?.id
  if (activityId === undefined) return { kind: 'error', text: `No saved Activity has id ${match[1]}.` }

  let request: ActivityDelegation
  try {
    request = await ctx.homeActivityDelegations.createRequest({
      activityId,
      provider: match[2],
      task: parsedTask.data,
      parentSessionId: invocation.agent.session.id,
      ...(match[2] === 'spawn' ? {
        executionSelection: captureActivityDelegationExecutionSelection(
          ctx.get('profileContext'),
          ctx.get('agentPresets'),
          invocation.agent.ctx,
        ),
      } : {}),
    })
  } catch (error: unknown) {
    if (error instanceof ActivityDelegationError) return { kind: 'error', text: error.message }
    if (error instanceof StorageError) {
      ctx.logger.warn('command-home-activity: delegation request persistence failed: %o', error)
      return { kind: 'error', text: 'Delegation request could not be saved; no provider start was attempted.' }
    }
    ctx.logger.warn('command-home-activity: delegation request failed: %o', error)
    return { kind: 'error', text: 'Delegation request could not be saved; no provider start was attempted.' }
  }

  const childSessionId = request.request.provider === 'spawn'
    ? request.request.requestedChildSessionId
    : undefined
  if (request.request.provider !== 'spawn' && ctx.subagents.getProvider(request.request.provider) === undefined) {
    const providerLabel = externalProviderLabel(request.request.provider)
    const message = `The ${providerLabel} provider is unavailable; DSH did not attempt activation.`
    try {
      await ctx.homeActivityDelegations.markNotAdmitted(request.id, message)
    } catch (error: unknown) {
      ctx.logger.warn('command-home-activity: unavailable external provider state could not be saved: %o', error)
      return { kind: 'error', text: `${message} Saving this Activity state failed; no provider call occurred.` }
    }
    return { kind: 'error', text: message }
  }
  let runId: SubagentRunId | undefined
  const stopObservingStart = childSessionId === undefined
    ? () => undefined
    : ctx.on('subagent/start', (info) => {
      if (info.id === childSessionId && info.parentSessionId === invocation.agent.session.id && info.provider === 'spawn') {
        runId = info.runId
      }
    })
  let activation
  try {
    activation = await ctx.subagents.startActivation({
      provider: request.request.provider,
      label: `Activity ${request.id}`,
      ...(childSessionId === undefined ? {} : { name: `activity-${randomUUID().slice(0, 8)}` }),
      ...(childSessionId === undefined ? {} : { childId: childSessionId }),
      prompt: [{ type: 'text', text: parsedTask.data }],
      parent: invocation.agent,
      signal: invocation.signal,
      delivery: 'caller',
    })
  } catch (error: unknown) {
    stopObservingStart()
    if (error instanceof SubagentError && (error.code === 'PROVIDER_CHANGED' || error.code === 'NOT_DISPATCHED')) {
      const providerLabel = request.request.provider === 'spawn'
        ? 'DSH spawn'
        : externalProviderLabel(request.request.provider)
      const message = error.code === 'PROVIDER_CHANGED'
        ? `The ${providerLabel} provider changed before dispatch, so DSH did not start this task. Check the provider, then explicitly submit a new request if you still want it run. Opening the Activity will not retry it.`
        : `DSH could not complete startup preparation and did not call the ${providerLabel} provider. Check the DSH runtime, current Session, Activity, and provider, then explicitly submit a new request if you still want it run. Opening the Activity will not retry it.`
      try {
        await ctx.homeActivityDelegations.markNotAdmitted(request.id, message)
      } catch (recordError: unknown) {
        ctx.logger.warn('command-home-activity: pre-dispatch outcome could not be saved: %o', recordError)
        return {
          kind: 'error',
          text: `${message} Saving this Activity status failed; check the Activity before submitting another request.`,
        }
      }
      ctx.logger.warn('command-home-activity: activation was not dispatched: %o', error)
      return { kind: 'error', text: `${message} Request ID: ${request.id}` }
    }
    if (request.request.provider !== 'spawn') {
      const providerLabel = externalProviderLabel(request.request.provider)
      const uncertaintyReason = request.request.provider === 'codex'
        ? 'codex-start-outcome-unknown'
        : 'claude-code-start-outcome-unknown'
      const message = `DSH could not confirm whether ${providerLabel} started. It may have started; do not repeat this task unless you have independently confirmed it did not start. Reopening the Activity will not retry it.`
      try {
        await ctx.homeActivityDelegations.markUnconfirmed(
          request.id,
          undefined,
          uncertaintyReason,
        )
      } catch (recordError: unknown) {
        ctx.logger.warn('command-home-activity: uncertain external provider startup could not be saved: %o', recordError)
        return {
          kind: 'error',
          text: `${message} Saving the Activity status also failed; check the Activity after storage is available.`,
        }
      }
      ctx.logger.warn('command-home-activity: external provider startup outcome is unknown: %o', error)
      return { kind: 'error', text: message }
    }
    try {
      await ctx.homeActivityDelegations.markNotAdmitted(
        request.id,
        'The DSH provider did not admit this task; no activation was published.',
      )
    } catch (recordError: unknown) {
      ctx.logger.warn('command-home-activity: rejected delegation state could not be saved: %o', recordError)
      return {
        kind: 'error',
        text: `The ${request.request.provider} provider rejected the request before activation. Its final record could not be confirmed; Activity ${activityId} may show an unconfirmed request. Opening the Activity does not restart or retry it.`,
      }
    }
    ctx.logger.warn('command-home-activity: subagent activation was not admitted: %o', error)
    return {
      kind: 'error',
      text: `The DSH provider did not admit this task; no activation was published. Request ID: ${request.id}`,
    }
  }
  stopObservingStart()

  const admission: ActivityDelegationAdmission = request.request.provider === 'spawn'
    ? {
      childSessionId: activation.childId,
      activationName: activation.name,
      ...(runId === undefined ? {} : { runId }),
      admittedAt: new Date().toISOString(),
      source: 'subagents.startActivation',
    }
    : {
      provider: request.request.provider,
      // External activation.childId is SubagentRun.id, not a DSH Session or native conversation id.
      providerRunId: String(activation.childId),
      admittedAt: new Date().toISOString(),
      source: 'subagents.startActivation',
    }
  try {
    await ctx.homeActivityDelegations.recordAdmitted(request.id, admission)
  } catch (error: unknown) {
    ctx.logger.warn('command-home-activity: accepted delegation admission could not be confirmed in storage: %o', error)
    observeActivation(ctx, request.id, admission, activation.result)
    return {
      kind: 'success',
      text: renderAdmission(request, admission, true),
    }
  }
  observeActivation(ctx, request.id, admission, activation.result)
  return { kind: 'success', text: renderAdmission(request, admission, false) }
}

/** Render one provider-attributed fact group without implying verification or acceptance.
 * @param delegation - Saved request and any later lifecycle facts.
 * @returns User-facing Activity detail lines.
 */
export function renderActivityDelegation(delegation: ActivityDelegation): readonly string[] {
  const isExternal = delegation.request.provider !== 'spawn'
  const providerLabel = isExternal ? externalProviderLabel(delegation.request.provider) : 'provider'
  const lines = [
    `Delegation ${delegation.id}: provider ${delegation.request.provider}${isExternal ? ` (native ${providerLabel}, external one-shot)` : ''}`,
    `Requested task: ${delegation.request.task}`,
    `Requesting Session: ${delegation.request.parentSessionId}`,
    ...renderExecutionSelection(delegation.request),
    isExternal
      ? externalExecutionPolicyMessage(delegation.request.provider)
      : 'Activity scope does not restrict child tools or permissions; DSH active runtime policy controls access.',
  ]
  if (delegation.status === 'requested') {
    lines.push(`Status: request saved; ${isExternal ? `${providerLabel} admission` : 'provider admission'} has not been confirmed.`)
    lines.push('Outcome: unknown; the saved request does not establish provider admission or a result.')
    if (delegation.request.provider === 'spawn') {
      lines.push(`Requested child Session id (not admission evidence): ${delegation.request.requestedChildSessionId}`)
    } else {
      lines.push(`The ${providerLabel} start outcome may be unknown. Do not repeat this task unless you independently confirm it did not start; opening the Activity does not start it.`)
    }
    return lines
  }
  if (delegation.status === 'not-admitted') {
    lines.push(`Status: not admitted. ${delegation.failure?.message ?? 'The DSH API did not publish an activation.'}`)
    lines.push('Outcome: startup failed before DSH admission; no activation was published.')
    lines.push(`Failure source: ${delegation.failure?.source ?? 'unavailable'}.`)
    lines.push('Failure observed at: unavailable (the failure time was not recorded).')
    return lines
  }
  if (delegation.status === 'unconfirmed') {
    if (delegation.admission === undefined) {
      if (delegation.request.provider === 'spawn') {
        lines.push('Status: unconfirmed; saved facts do not establish whether DSH admitted the request.')
        lines.push(`Requested child Session id (not admission evidence): ${delegation.request.requestedChildSessionId}`)
        lines.push('Check /activity sessions for this exact id and its summary metadata before deciding whether to retry. A missing Session record does not confirm that admission failed.')
      } else {
        lines.push(`Status: unconfirmed; saved facts do not establish whether the external ${providerLabel} run started.`)
        lines.push(`No ${providerLabel} execution id was saved. Activity does not expose its transcript, resume the run, or retry it; do not repeat the task unless you independently confirm it did not start.`)
      }
    } else {
      lines.push(isExternal
        ? `Status: DSH admitted one external ${providerLabel} execution; its provider report is unconfirmed.`
        : 'Status: DSH admitted this child; its provider report is unconfirmed.')
      lines.push(...renderAdmissionReferences(delegation.admission))
      lines.push(isExternal
        ? `This ${providerLabel} run is one-shot. Activity does not inspect its transcript, resume it, or roll back its effects; its report is unconfirmed, and user disposition is shown separately.`
        : 'Inspect the child Session summary before retrying. The provider report is unconfirmed; DSH has not independently verified it, and user disposition is shown separately.')
    }
    lines.push('Outcome: unknown; no provider result was recorded.')
    lines.push(`Reason: ${uncertaintyMessage(delegation.uncertainty?.reason)}`)
    lines.push(`Uncertainty source: ${uncertaintySource(delegation.uncertainty?.reason)}.`)
    lines.push(`Uncertainty observed at: ${delegation.uncertainty?.observedAt ?? 'unavailable'}.`)
    return lines
  }
  if (delegation.status === 'admitted') {
    lines.push('Outcome: pending; DSH admission is recorded, but no provider report is available.')
  }
  lines.push(`Delegation state: ${delegation.status}.`)
  if (delegation.admission === undefined) {
    lines.push('Activation reference is unavailable.')
  } else {
    lines.push(...renderAdmissionReferences(delegation.admission))
  }
  if (delegation.report !== undefined) {
    lines.push('Provider report: received; DSH has not independently verified it.')
    lines.push(`Reported outcome: ${reportedOutcome(delegation.report.stopReason)}.`)
    lines.push(`Provider report source: ${delegation.report.source}.`)
    lines.push(`Provider report observed at: ${delegation.report.reportedAt}.`)
    lines.push('Freshness: unknown; DSH has no freshness check for this saved report, so it may be stale.')
    lines.push(`Provider stop reason: ${delegation.report.stopReason}`)
    lines.push(`${isExternal ? `${providerLabel}-reported` : 'Provider-reported'} output: ${delegation.report.outputText || '(no text output)'}`)
    if (delegation.report.nonTextBlockTypes.length > 0) {
      lines.push(`Additional provider output blocks: ${delegation.report.nonTextBlockTypes.join(', ')}`)
    }
    if (delegation.report.outputTruncated) lines.push('Provider-reported text was clipped at 16384 UTF-8 bytes.')
    if (delegation.report.diagnostic !== undefined) lines.push(`Provider diagnostic: ${delegation.report.diagnostic}`)
  } else {
    lines.push(isExternal
      ? `${providerLabel} outcome is pending. This one-shot execution has no Activity continuation, resume, transcript inspection, or rollback; opening the Activity does not wait or start another run.`
      : 'Provider report: not recorded; opening the Activity does not wait for the child Session.')
  }
  return lines
}

/** Describe only the provider stop reasons whose semantics are defined by the subagent API.
 * @param stopReason - Provider-authored terminal reason retained in the report.
 * @returns A conservative user-facing classification that does not imply verification.
 */
function reportedOutcome(stopReason: string): string {
  switch (stopReason) {
    case 'completed': return 'provider-reported completion; not independently verified'
    case 'error': return 'provider-reported failure; output may be partial'
    case 'aborted': return 'provider-reported interruption; output may be partial'
    case 'max-tokens': return 'partial output; the provider reached its token limit'
    case 'refusal': return 'provider refusal; the requested task was not completed'
    default: return 'unknown; the provider stop reason is not classified'
  }
}

/** Identify the recorded source category for an unconfirmed Activity fact.
 * @param reason - Persisted reason for the uncertainty, if it was retained.
 * @returns The lifecycle source category or an explicit unavailable label.
 */
function uncertaintySource(reason: ActivityDelegationUncertainty['reason'] | undefined): string {
  if (reason === undefined) return 'unavailable'
  return uncertaintySources[reason]
}

/** Render saved DSH profile and preset facts without implying permission or capability guarantees.
 * @param request - Provider-specific request and captured runtime selection.
 * @returns Profile and preset lines displayed with the delegation lifecycle facts.
 */
function renderExecutionSelection(request: ActivityDelegation['request']): readonly string[] {
  if (request.provider !== 'spawn') {
    const providerLabel = externalProviderLabel(request.provider)
    return [`Runtime profile and preset: unavailable (the native ${providerLabel} provider does not expose DSH composition).`]
  }
  if (request.executionSelection === undefined) return ['Runtime profile and preset: unavailable (record predates profile and preset capture).']
  const lines = [
    ...renderProfileSelection(request.executionSelection.profile),
    ...renderPresetSelection(request.executionSelection.preset),
  ]
  lines.push('These classifications do not establish sandbox isolation, permission enforcement, or Skill qualification.')
  return lines
}

function renderProfileSelection(
  profile: SpawnExecutionSelectionSnapshot['profile'],
): string[] {
  if (profile.status === 'unavailable') return [`DSH profile: unavailable (${profileUnavailableReason(profile.reason)}).`]
  const lines = [
    `DSH profile: ${profile.name}; bundle-set classification: ${profile.classification}`,
    profile.startedBundles === null
      ? 'Profile bundles used at launch: unavailable (the bundle list exceeded the persistence limit).'
      : `Profile bundles used at launch: ${renderSelectionNames(profile.startedBundles)}`,
  ]
  lines.push(profile.classificationSource === 'shipped-profile-template'
    ? 'The stable classification matches the exact ordered bundle list of a shipped profile template; profile patches and overlays are not classified.'
    : profile.classificationSource === 'experimental-package-metadata'
      ? 'The experimental classification comes from an explicitly experimental bundle in the launch list.'
      : 'The product has no reliable stable or experimental classification for this profile bundle list.')
  return lines
}

function renderPresetSelection(
  preset: SpawnExecutionSelectionSnapshot['preset'],
): string[] {
  if (preset.status === 'none') return ['Active Agent preset: none.']
  if (preset.status === 'unavailable') return [`Active Agent preset: unavailable (${presetUnavailableReason(preset.reason)}).`]
  const lines = [`Active Agent preset: ${preset.id}; composition classification: ${preset.classification}`]
  lines.push(preset.activeModules === null
    ? 'Active preset modules: unavailable.'
    : `Active preset modules: ${renderSelectionNames(preset.activeModules)}`)
  lines.push(preset.classificationSource === 'experimental-package-metadata'
    ? 'The experimental classification comes from an explicitly experimental active module.'
    : 'The product supplied no stable classification for this preset composition.')
  return lines
}

function renderSelectionNames(names: readonly string[]): string {
  if (names.length === 0) return '(none)'
  const visible = names.slice(0, MAX_RENDERED_SELECTION_NAMES).join(', ')
  const omitted = names.length - MAX_RENDERED_SELECTION_NAMES
  return omitted > 0 ? `${visible} (${omitted} more recorded)` : visible
}

function profileUnavailableReason(reason: 'runtime-profile-unavailable' | 'profile-identity-exceeds-persistence-limit'): string {
  return reason === 'runtime-profile-unavailable'
    ? 'the runtime did not provide profile metadata'
    : 'the profile identity exceeded the persistence limit'
}

function presetUnavailableReason(
  reason: 'agent-preset-registry-unavailable' | 'preset-identity-exceeds-persistence-limit' | 'preset-module-list-exceeds-persistence-limit',
): string {
  switch (reason) {
    case 'agent-preset-registry-unavailable': return 'the Agent preset registry is unavailable'
    case 'preset-identity-exceeds-persistence-limit': return 'the preset identity exceeded the persistence limit'
    case 'preset-module-list-exceeds-persistence-limit': return 'the module list exceeded the persistence limit'
  }
}

/**
 * Attaches a contained observer to the managed activation result.
 * @param ctx - Logger and persistent delegation sidecar.
 * @param id - Delegation request identity.
 * @param admission - DSH identity returned by `startActivation`.
 * @param result - Managed activation result promise.
 * @returns Nothing; observer failures are contained and logged.
 */
function observeActivation(
  ctx: Context,
  id: ActivityDelegation['id'],
  admission: ActivityDelegationAdmission,
  result: Promise<import('@deepseek-ai/dsh-subagent').SubagentResult>,
): void {
  void (async () => {
    let providerResult: import('@deepseek-ai/dsh-subagent').SubagentResult
    try {
      providerResult = await result
    } catch (error: unknown) {
      try {
        await ctx.homeActivityDelegations.markUnconfirmed(id, admission, 'startup-result-rejected')
      } catch (recordError: unknown) {
        ctx.logger.warn('command-home-activity: unknown activation result could not be saved: %o', recordError)
      }
      ctx.logger.warn('command-home-activity: admitted activation result was rejected: %o', error)
      return
    }
    let report: ActivityDelegationReport
    try {
      const output = providerResult.output
      const text = truncateUtf8(output.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n'), 16_384)
      report = {
        stopReason: providerResult.stopReason,
        outputText: text.text,
        nonTextBlockTypes: output.flatMap(block => block.type === 'text' ? [] : [block.type]),
        outputTruncated: text.truncated,
        ...(providerResult.diagnostic === undefined ? {} : { diagnostic: providerResult.diagnostic }),
        reportedAt: new Date().toISOString(),
        source: 'subagent-activation-result',
      }
    } catch (error: unknown) {
      try {
        await ctx.homeActivityDelegations.markUnconfirmed(id, admission, 'startup-result-rejected')
      } catch (recordError: unknown) {
        ctx.logger.warn('command-home-activity: unreadable activation result could not be saved as unconfirmed: %o', recordError)
      }
      ctx.logger.warn('command-home-activity: settled activation result could not be read as a provider report: %o', error)
      return
    }
    try {
      await ctx.homeActivityDelegations.recordReported(id, admission, report)
    } catch (error: unknown) {
      ctx.logger.warn('command-home-activity: provider report could not be persisted: %o', error)
    }
  })().catch((error: unknown) => {
    ctx.logger.warn('command-home-activity: result observer failed: %o', error)
  })
}

/** Format accepted child Session and activation references. */
function renderAdmissionReferences(admission: ActivityDelegationAdmission): string[] {
  if (admission.provider === 'codex' || admission.provider === 'claude-code') {
    const providerLabel = externalProviderLabel(admission.provider)
    return [`${providerLabel} adapter run id (not a DSH Session or native ${providerLabel} conversation id): ${admission.providerRunId}`]
  }
  return [
    `Child Session: ${admission.childSessionId}`,
    `Activation: ${admission.activationName}`,
    ...(admission.runId === undefined ? [] : [`Activation run: ${admission.runId}`]),
  ]
}

const uncertaintyMessages: Record<ActivityDelegationUncertainty['reason'], string> = {
  'restart-before-admission-recorded': 'The application restarted before the provider admission was saved.',
  'restart-before-report-recorded': 'The application restarted before the provider report was saved.',
  'admission-write-failed': 'The child was accepted, but saving its admission reference failed.',
  'report-write-failed': 'Saving the provider report failed after the child Session was admitted.',
  'startup-result-rejected': 'The accepted activation did not provide a usable report through the managed result API.',
  'codex-start-outcome-unknown': 'DSH did not confirm whether the external Codex run started.',
  'claude-code-start-outcome-unknown': 'DSH did not confirm whether the external Claude Code run started.',
}

/** Explain the source of uncertainty in actionable user language. */
function uncertaintyMessage(reason: ActivityDelegationUncertainty['reason'] | undefined): string {
  return reason === undefined ? 'The persisted lifecycle state is incomplete.' : uncertaintyMessages[reason]
}

/** State the exact DSH admission without claiming later work or acceptance. */
function renderAdmission(
  request: ActivityDelegation,
  admission: ActivityDelegationAdmission,
  unconfirmed: boolean,
): string {
  const isExternal = admission.provider === 'codex' || admission.provider === 'claude-code'
  const providerLabel = isExternal ? externalProviderLabel(admission.provider) : 'provider'
  return [
    `Delegation ${unconfirmed ? 'admitted but not durably confirmed' : 'admitted'}: provider ${request.request.provider}${isExternal ? ` (native ${providerLabel}, external one-shot)` : ''}`,
    `Requested task: ${request.request.task}`,
    `Requesting Session: ${request.request.parentSessionId}`,
    ...renderExecutionSelection(request.request),
    isExternal
      ? externalExecutionPolicyMessage(admission.provider)
      : 'Activity scope does not restrict child tools or permissions; DSH active runtime policy controls access.',
    ...renderAdmissionReferences(admission),
    unconfirmed
      ? isExternal
        ? `Execution was accepted by DSH, but its admission record could not be confirmed. This one-shot ${providerLabel} run cannot be resumed or inspected through Activity; do not treat this record as proof it did not run.`
        : 'Execution was accepted by DSH, but the admission record could not be confirmed. Do not retry until you inspect this Activity and child Session summary.'
      : isExternal
        ? `${providerLabel} accepted one external one-shot execution; its result is not yet available, verified, or accepted. Activity does not expose transcript inspection, continuation, resume, or rollback.`
        : 'The child Session is a separate one-shot DSH activation. Its result is not yet available, verified, or accepted.',
  ].join('\n')
}

/** Return the product label for a selected external provider.
 * @param provider - External native provider.
 * @returns The provider name used in Activity reports.
 */
function externalProviderLabel(provider: 'codex' | 'claude-code'): 'Codex' | 'Claude Code' {
  return provider === 'codex' ? 'Codex' : 'Claude Code'
}

/** Describe native external settings without exposing provider-specific values.
 * @param provider - External native provider.
 * @returns The provider-owned permission and configuration statement.
 */
function externalExecutionPolicyMessage(provider: 'codex' | 'claude-code'): string {
  return provider === 'codex'
    ? 'Activity scope is descriptive; native Codex configuration and its configured permission mode govern this execution.'
    : 'Activity scope is descriptive; native Claude Code configuration and permission handling govern this one-shot execution.'
}

/** Clip on a UTF-8 code-point boundary so persisted text is valid and bounded. */
function truncateUtf8(value: string, maxBytes: number): { readonly text: string; readonly truncated: boolean } {
  let text = ''
  let bytes = 0
  for (const character of value) {
    const size = Buffer.byteLength(character, 'utf8')
    if (bytes + size > maxBytes) return { text, truncated: true }
    text += character
    bytes += size
  }
  return { text, truncated: false }
}
