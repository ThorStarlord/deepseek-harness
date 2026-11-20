import { describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { ActivityId } from '@deepseek-ai/dsh-home-activity'
import type { ActivityDelegation, ActivityDelegationId } from '@deepseek-ai/dsh-home-activity/delegations'
import { SessionId } from '@deepseek-ai/dsh-session'
import { renderActivityNextActions } from '../src/next-actions.ts'

const activityId = ActivityId('00000000-0000-4000-8000-000000000028')
const task = 'Review the saved check results.'

describe('renderActivityNextActions', () => {
  it('offers a distinct explicit request only through routes registered after a confirmed non-admission', () => {
    const delegation = savedDelegation('codex', 'not-admitted')
    const isRegistered = vi.fn(provider => provider === 'codex' || provider === 'spawn')

    const lines = renderActivityNextActions(delegation, isRegistered)

    expect(lines.join('\n')).toContain('confirms that DSH published no activation')
    expect(lines.join('\n')).toContain('Provider routes registered now: spawn, codex')
    expect(lines.join('\n')).toContain('Registration does not establish credential readiness, user consent, native permission, or provider admission.')
    expect(lines.join('\n')).toContain(`/activity delegate ${activityId} <registered-provider> <one bounded task>`)
    expect(lines.join('\n')).toContain('This creates a new request; it does not retry or resume the saved request.')
    expect(isRegistered).toHaveBeenCalledTimes(3)
  })

  it('keeps an unavailable provider blocked when no delegation route is registered', () => {
    const lines = renderActivityNextActions(savedDelegation('claude-code', 'not-admitted'), () => false)

    expect(lines.join('\n')).toContain('No Activity delegation route is registered now.')
    expect(lines.join('\n')).toContain('opening it does not start, retry, or resume work.')
    expect(lines.join('\n')).toContain('does not expose a stop action')
  })

  it.each(['requested', 'admitted', 'unconfirmed'] as const)(
    'keeps DSH %s outcomes pending and offers only Session-summary inspection',
    (status) => {
      const isRegistered = vi.fn(() => true)
      const lines = renderActivityNextActions(savedDelegation('spawn', status), isRegistered)
      const text = lines.join('\n')

      expect(text).toContain('Leave this request pending')
      expect(text).toContain('/activity sessions')
      expect(text).toContain('A missing Session does not establish that admission failed.')
      expect(text).not.toContain('/activity delegate')
      expect(text).not.toContain('resume')
      expect(isRegistered).not.toHaveBeenCalled()
    },
  )

  it('does not offer control or retry actions for an external one-shot with an unknown start', () => {
    const isRegistered = vi.fn(() => true)
    const text = renderActivityNextActions(savedDelegation('codex', 'unconfirmed'), isRegistered).join('\n')

    expect(text).toContain('Leave this request pending')
    expect(text).toContain('no status query, transcript inspection, stop, or resume action')
    expect(text).not.toContain('/activity delegate')
    expect(isRegistered).not.toHaveBeenCalled()
  })

  it.each(['error', 'aborted', 'max-tokens'] as const)(
    'treats provider-reported %s as possibly partial and distinguishes new work from retry',
    (stopReason) => {
      const delegation = savedDelegation('codex', 'reported', stopReason)
      const text = renderActivityNextActions(delegation, provider => provider === 'claude-code').join('\n')

      expect(text).toContain('Review the provider-reported output and check for external effects')
      expect(text).toContain('Provider routes registered now: claude-code.')
      expect(text).toContain('This creates a new request; it does not retry or resume the saved request.')
      expect(text).toContain('native permission')
    },
  )

  it('offers only a registered alternate after a refusal and never transfers consent', () => {
    const text = renderActivityNextActions(
      savedDelegation('codex', 'reported', 'refusal'),
      provider => provider === 'codex' || provider === 'claude-code',
    ).join('\n')

    expect(text).toContain('It did not transfer this task or authorize another provider.')
    expect(text).toContain('Review the report and check for external effects')
    expect(text).toContain('Alternate provider routes registered now: claude-code.')
    expect(text).toContain('explicitly submit a new request')
    expect(text).not.toContain('Alternate provider routes registered now: codex')
  })

  it('keeps a refusal blocked when there is no alternate registered route', () => {
    const text = renderActivityNextActions(
      savedDelegation('codex', 'reported', 'refusal'),
      provider => provider === 'codex',
    ).join('\n')

    expect(text).toContain('No alternate Activity delegation route is registered now.')
    expect(text).toContain('no retry, stop, or resume action is available here.')
  })

  it('does not suggest a new execution for an unclassified report or a missing report', () => {
    const unclassified = renderActivityNextActions(
      savedDelegation('spawn', 'reported', 'provider-added-reason'),
      () => true,
    ).join('\n')
    const missingReport = renderActivityNextActions(savedDelegation('spawn', 'reported'), () => true).join('\n')

    expect(unclassified).toContain('stop reason is unclassified')
    expect(unclassified).toContain('No retry, reassignment, stop, or resume action is offered')
    expect(missingReport).toContain('no provider report, so its outcome is unknown')
    expect(missingReport).not.toContain('/activity delegate')
  })

  it('adds no recovery guidance to a completed provider report', () => {
    const isRegistered = vi.fn(() => true)

    expect(renderActivityNextActions(savedDelegation('claude-code', 'reported', 'completed'), isRegistered)).toEqual([])
    expect(isRegistered).not.toHaveBeenCalled()
  })
})

function savedDelegation(
  provider: ActivityDelegation['request']['provider'],
  status: ActivityDelegation['status'],
  stopReason?: string,
): ActivityDelegation {
  const request = provider === 'spawn'
    ? {
      provider,
      requestedChildSessionId: SessionId('requested-child-session'),
      task,
      parentSessionId: SessionId('parent-session'),
      requestedAt: '2026-11-20T00:00:00.000Z',
      source: 'user-command' as const,
    }
    : {
      provider,
      task,
      parentSessionId: SessionId('parent-session'),
      requestedAt: '2026-11-20T00:00:00.000Z',
      source: 'user-command' as const,
    }
  const report = stopReason === undefined ? undefined : {
    stopReason,
    outputText: 'Some reported work may be incomplete.',
    nonTextBlockTypes: [],
    outputTruncated: false,
    reportedAt: '2026-11-20T00:00:01.000Z',
    source: 'subagent-activation-result' as const,
  }
  return {
    id: brandString<ActivityDelegationId>('delegation-1'),
    activityId,
    request,
    status,
    ...(report === undefined ? {} : { report }),
  }
}
