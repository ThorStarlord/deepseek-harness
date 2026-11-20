/** Read-only recovery guidance for saved Activity delegation facts.
 * @module @deepseek-ai/dsh-command-home-activity/next-actions
 */

import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { ActivityDelegation } from '@deepseek-ai/dsh-home-activity/delegations'

type ActivityProvider = ActivityDelegation['request']['provider']

const providers: readonly ActivityProvider[] = ['spawn', 'codex', 'claude-code']

/** Render only explicit operations supported by this saved outcome and current provider registry.
 * @param delegation - Saved Activity request and provider lifecycle facts.
 * @param isProviderRegistered - Read-only lookup for a provider route in the current runtime.
 * @returns Recovery guidance, or no additional guidance for a completed provider report.
 */
export function renderActivityNextActions(
  delegation: ActivityDelegation,
  isProviderRegistered: (provider: ActivityProvider) => boolean,
): readonly string[] {
  switch (delegation.status) {
    case 'requested':
    case 'admitted':
    case 'unconfirmed':
      return renderPendingActions(delegation)
    case 'not-admitted':
      return renderNewRequestActions(delegation, registeredProviders(isProviderRegistered), false)
    case 'reported':
      return renderReportedActions(delegation, isProviderRegistered)
    /* v8 ignore next -- ActivityDelegationStatus is a typed closed union. */
    default: return assertNever(delegation.status, 'Unknown Activity delegation status')
  }
}

function renderPendingActions(delegation: ActivityDelegation): readonly string[] {
  const lines = [
    'Next actions:',
    'Leave this request pending and inspect the saved facts above. Do not submit another request while its start or result is unknown.',
  ]
  if (delegation.request.provider === 'spawn') {
    lines.push(
      'Use /activity sessions to inspect the proposed child Session and its summary. A missing Session does not establish that admission failed.',
      'Activity does not expose a stop action for this saved delegation.',
    )
  } else {
    lines.push(
      'Activity has no status query, transcript inspection, stop, or resume action for this external one-shot run.',
    )
  }
  return lines
}

function renderReportedActions(
  delegation: ActivityDelegation,
  isProviderRegistered: (provider: ActivityProvider) => boolean,
): readonly string[] {
  const report = delegation.report
  if (report === undefined) {
    return [
      'Next actions:',
      'The saved lifecycle state has no provider report, so its outcome is unknown. Leave it blocked and inspect the provider state before considering new work.',
    ]
  }
  switch (report.stopReason) {
    case 'completed':
      return []
    case 'error':
    case 'aborted':
    case 'max-tokens':
      return renderNewRequestActions(delegation, registeredProviders(isProviderRegistered), true)
    case 'refusal':
      return renderRefusalActions(delegation, registeredProviders(isProviderRegistered))
    default:
      return [
        'Next actions:',
        'The provider stop reason is unclassified. Leave this request unresolved and inspect the provider report or native provider state; this record does not establish whether the previous work had effects.',
        'No retry, reassignment, stop, or resume action is offered for an unclassified outcome.',
      ]
  }
}

function renderNewRequestActions(
  delegation: ActivityDelegation,
  routes: readonly ActivityProvider[],
  mayHavePartialEffects: boolean,
): readonly string[] {
  const lines = [
    'Next actions:',
    mayHavePartialEffects
      ? 'Review the provider-reported output and check for external effects before deciding whether to submit new work. The prior run may have produced partial effects.'
      : 'The saved record confirms that DSH published no activation for this request.',
  ]
  if (routes.length === 0) {
    lines.push('No Activity delegation route is registered now. Leave the request unresolved; opening it does not start, retry, or resume work.')
  } else {
    lines.push(
      `Provider routes registered now: ${routes.join(', ')}. Registration does not establish credential readiness, user consent, native permission, or provider admission.`,
      `If you choose to start separate work, explicitly submit /activity delegate ${delegation.activityId} <registered-provider> <one bounded task>. This creates a new request; it does not retry or resume the saved request.`,
    )
  }
  lines.push('Activity does not expose a stop action for the saved request.')
  return lines
}

function renderRefusalActions(
  delegation: ActivityDelegation,
  routes: readonly ActivityProvider[],
): readonly string[] {
  const alternatives = routes.filter(provider => provider !== delegation.request.provider)
  const lines = [
    'Next actions:',
    'The provider reported a refusal. It did not transfer this task or authorize another provider.',
    'Review the report and check for external effects before deciding whether to submit new work.',
  ]
  if (alternatives.length === 0) {
    lines.push('No alternate Activity delegation route is registered now. Keep the refusal visible or record a user annotation; no retry, stop, or resume action is available here.')
  } else {
    lines.push(
      `Alternate provider routes registered now: ${alternatives.join(', ')}. Registration does not establish credential readiness, user consent, native permission, or admission.`,
      `If you choose to reassign the work, explicitly submit a new request with /activity delegate ${delegation.activityId} <registered-alternate> <one bounded task>. This is not a continuation of the refusal.`,
      'Activity does not expose a stop or resume action for this reported result.',
    )
  }
  return lines
}

function registeredProviders(
  isProviderRegistered: (provider: ActivityProvider) => boolean,
): readonly ActivityProvider[] {
  return providers.filter(isProviderRegistered)
}
