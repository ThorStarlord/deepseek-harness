// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/types'
import type { ActivityCoordinationCandidate, ActivityCoordinationState } from '../src/client/surface.ts'
import type { ActivityCoordinationSessionSnapshot } from '@deepseek-ai/dsh-home-activity/coordination-types'
import type {
  ActivityResponsibilityFactId,
  ActivityResponsibilityId,
  ActivityResponsibilityProposedFact,
  ActivityResponsibilityRequestId,
} from '@deepseek-ai/dsh-home-activity/responsibility-types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { ActivityId } from '@deepseek-ai/dsh-home-activity/activity-types'
import { CoordinateDialog } from '../src/client/CoordinateDialog.tsx'
import type { ActivityCoordinationProps } from '../src/client/slots.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(en, commonEn)
const workspaceId = brandString<WorkspaceId>('workspace-1')
const sessionId = brandString<SessionId>('session-1')
const candidate: ActivityCoordinationCandidate = {
  key: JSON.stringify([workspaceId, sessionId]),
  target: { workspaceId, sessionId },
  workspace: {
    workspaceId,
    title: 'Harness',
    path: 'C:/Projects/Harness',
    sessionIds: [sessionId],
    createdAt: '2026-11-24T12:00:00.000Z',
    updatedAt: '2026-11-24T12:00:00.000Z',
  },
}
const sourceSnapshot: ActivityCoordinationSessionSnapshot = {
  activityId: brandString<ActivityId>('activity-1'),
  workspaceId,
  workspaceTitle: 'Harness',
  workspacePath: 'C:/Projects/Harness',
  sessionId,
  sessionCwd: 'C:/Projects/Harness',
  sessionCreatedAt: Date.parse('2026-11-24T12:00:00.000Z'),
  observedAt: Date.parse('2026-11-24T12:30:00.000Z'),
  source: 'live',
  cursor: -1,
  runtime: 'loaded',
  recentMessages: [{
    role: 'assistant', sourceKind: 'assistant/message', eventSeq: 12, time: Date.parse('2026-11-24T12:29:00.000Z'),
    text: 'The current implementation is complete.', truncated: false,
  }],
}
const proposalFact: ActivityResponsibilityProposedFact = {
  id: brandString<ActivityResponsibilityFactId>('proposal-fact'),
  responsibilityId: brandString<ActivityResponsibilityId>('responsibility-id'),
  activityId: brandString<ActivityId>('activity-1'),
  revision: 1,
  requestId: brandString<ActivityResponsibilityRequestId>('proposal-request'),
  recordedAt: '2026-11-24T12:40:00.000Z',
  kind: 'proposed',
  proposal: {
    target: candidate.target,
    task: 'Inspect the target Session and return a concise attributed report.',
    inScope: ['Read recent Session evidence', 'Name remaining uncertainty'],
    outOfScope: ['Do not edit repository files'],
    expectedOutcome: 'An attributed report with no acceptance claim.',
    prerequisites: ['Check the target is still available'],
    conflictingWork: ['Existing queued work'],
  },
  source: { kind: 'coordinating-session', sessionId: brandString<SessionId>('coordinator-session'), eventSeq: 91 },
}

describe('CoordinateDialog', () => {
  it('shows linked targets and only calls explicit preview and context-add actions', () => {
    const initial = state({ candidates: [candidate], selectedActivityId: brandString<ActivityId>('activity-1') })
    const ui = mount(initial)
    const toggleTarget = vi.fn()
    const discover = vi.fn()
    const addToConversation = vi.fn()
    ui.rerender(<CoordinateDialog {...props(initial, { toggleTarget, discover, addToConversation })} />)

    expect(ui.getByRole('dialog', { name: en['dialog.title'] })).toBeTruthy()
    fireEvent.click(ui.getByRole('checkbox', { name: /Harness/ }))
    expect(toggleTarget).toHaveBeenCalledWith(candidate.key, true)
    expect(discover).not.toHaveBeenCalled()
    expect(addToConversation).not.toHaveBeenCalled()

    const selected = state({ candidates: [candidate], selectedActivityId: brandString<ActivityId>('activity-1'), selectedKeys: [candidate.key] })
    ui.rerender(<CoordinateDialog {...props(selected, { toggleTarget, discover, addToConversation })} />)
    fireEvent.click(ui.getByRole('button', { name: en['preview.button'] }))
    expect(discover).toHaveBeenCalledTimes(1)
  })

  it('shows source identity and trust guidance before the separate Add action', () => {
    const initial = state({
      activities: [{
        activity: {
          id: brandString<ActivityId>('activity-1'), name: 'Coordination', objective: 'Coordinate current work.',
          boundaries: { inScope: ['Inspect'], outOfScope: ['Do not execute'] }, createdAt: '2026-11-24T12:00:00.000Z',
        },
        associations: { workspaceIds: [workspaceId], sessionIds: [sessionId] },
      }],
      candidates: [candidate],
      selectedActivityId: brandString<ActivityId>('activity-1'),
      selectedKeys: [candidate.key],
      snapshots: [sourceSnapshot],
      phase: 'discovered',
    })
    const addToConversation = vi.fn()
    const ui = mount(initial, { addToConversation })
    expect(ui.getByText(/Observation source: live/)).toBeTruthy()
    expect(ui.getByText(en['preview.trust'])).toBeTruthy()
    expect(ui.getByText('The current implementation is complete.')).toBeTruthy()
    fireEvent.click(ui.getByRole('button', { name: en['add.button'] }))
    expect(addToConversation).toHaveBeenCalledTimes(1)
  })

  it('shows the exact saved task and target before explicit confirmation dispatch', () => {
    const initial = state({
      mode: 'responsibility',
      activities: [{
        activity: {
          id: brandString<ActivityId>('activity-1'), name: 'Coordination', objective: 'Coordinate current work.',
          boundaries: { inScope: ['Inspect'], outOfScope: ['Do not execute'] }, createdAt: '2026-11-24T12:00:00.000Z',
        },
        associations: { workspaceIds: [workspaceId], sessionIds: [sessionId] },
      }],
      candidates: [candidate],
      selectedActivityId: brandString<ActivityId>('activity-1'),
      sourceMessage: { id: brandString<MessageId>('assistant-message'), eventSeq: 91, text: 'Inspect the active work and report what should happen next.', truncated: false },
      responsibilityPhase: 'confirm',
      responsibilityDraft: {
        targetKey: candidate.key,
        task: 'Inspect the target Session and return a concise attributed report.',
        inScopeText: 'Read recent Session evidence\nName remaining uncertainty',
        outOfScopeText: 'Do not edit repository files',
        expectedOutcome: 'An attributed report with no acceptance claim.',
        prerequisitesText: 'Check the target is still available',
        conflictingWorkText: 'Existing queued work',
      },
      proposalFact,
    })
    const confirmAndDispatch = vi.fn(async () => undefined)
    const ui = mount(initial, { confirmAndDispatch })
    expect(ui.getByRole('dialog', { name: en['responsibility.dialog.title'] })).toBeTruthy()
    expect(ui.getByText('Inspect the target Session and return a concise attributed report.')).toBeTruthy()
    expect(ui.getByText('Do not edit repository files')).toBeTruthy()
    expect(ui.getByText(/Workspace Harness/)).toBeTruthy()
    expect(ui.getByText(en['responsibility.confirm.notice'])).toBeTruthy()
    expect(confirmAndDispatch).not.toHaveBeenCalled()
    fireEvent.click(ui.getByRole('button', { name: en['responsibility.confirm.button'] }))
    expect(confirmAndDispatch).toHaveBeenCalledTimes(1)
  })

  it('labels accepted prompt admission without claiming task completion and requires explicit reconciliation', () => {
    const initial = state({
      activities: [{
        activity: {
          id: brandString<ActivityId>('activity-1'), name: 'Coordination', objective: 'Coordinate current work.',
          boundaries: { inScope: ['Inspect'], outOfScope: ['Do not execute'] }, createdAt: '2026-11-24T12:00:00.000Z',
        },
        associations: { workspaceIds: [workspaceId], sessionIds: [sessionId] },
      }],
      candidates: [candidate],
      selectedActivityId: brandString<ActivityId>('activity-1'),
      histories: [{ id: proposalFact.responsibilityId, activityId: proposalFact.activityId, proposal: proposalFact, facts: [
        proposalFact,
        {
          id: brandString<ActivityResponsibilityFactId>('dispatch-attempt-fact'), responsibilityId: proposalFact.responsibilityId,
          activityId: proposalFact.activityId, revision: 2, previousFactId: proposalFact.id,
          requestId: brandString<ActivityResponsibilityRequestId>('dispatch-attempt-request'),
          recordedAt: '2026-11-24T12:40:30.000Z', kind: 'dispatch-attempted',
          promptRequestId: brandString<ActivityResponsibilityRequestId>('prompt-request'),
          targetSessionId: sessionId, source: 'session-controller.prompt',
        },
        {
          id: brandString<ActivityResponsibilityFactId>('dispatch-fact'), responsibilityId: proposalFact.responsibilityId, activityId: proposalFact.activityId,
          revision: 3, previousFactId: brandString<ActivityResponsibilityFactId>('dispatch-attempt-fact'),
          requestId: brandString<ActivityResponsibilityRequestId>('dispatch-settled-request'),
          recordedAt: '2026-11-24T12:41:00.000Z', kind: 'dispatch-settled', promptRequestId: brandString<ActivityResponsibilityRequestId>('prompt-request'),
          targetSessionId: sessionId, outcome: 'accepted', source: 'session-controller.prompt',
        },
      ] }],
    })
    const reconcileResponsibility = vi.fn(async () => undefined)
    const addResponsibilityToConversation = vi.fn(async () => undefined)
    const ui = mount(initial, { reconcileResponsibility, addResponsibilityToConversation })
    expect(ui.getByText(en['responsibility.outcome.accepted'])).toBeTruthy()
    expect(ui.queryByText(/work completed/i)).toBeNull()
    expect(reconcileResponsibility).not.toHaveBeenCalled()
    const historySummary = ui.getByText('Inspect the target Session and return a concise attributed report.')
      .closest('summary')
    if (historySummary === null) throw new Error('Saved responsibility does not have a history disclosure control.')
    const historyDisclosure = historySummary.closest('details')
    if (historyDisclosure === null) throw new Error('Saved responsibility is not inside its disclosure control.')
    historyDisclosure.open = true
    expect(addResponsibilityToConversation).not.toHaveBeenCalled()
    fireEvent.click(ui.getByRole('button', { name: en['responsibility.history.share.button'] }))
    expect(addResponsibilityToConversation).toHaveBeenCalledWith(proposalFact.responsibilityId)
    fireEvent.click(ui.getByRole('button', { name: en['responsibility.reconcile.button'] }))
    expect(reconcileResponsibility).toHaveBeenCalledWith(proposalFact.responsibilityId)
  })

  it('shows selection, loading, error, and target-limit states without changing scopes implicitly', () => {
    const activities = [{
      activity: {
        id: brandString<ActivityId>('activity-1'), name: 'Coordination', objective: 'Coordinate current work.',
        boundaries: { inScope: ['Inspect'], outOfScope: ['Do not execute'] }, createdAt: '2026-11-24T12:00:00.000Z',
      },
      associations: { workspaceIds: [workspaceId], sessionIds: [sessionId] },
    }]
    const secondActivity = {
      activity: {
        id: brandString<ActivityId>('activity-2'), name: 'Another activity', objective: 'Inspect another project.',
        boundaries: { inScope: ['Inspect'], outOfScope: ['Do not execute'] }, createdAt: '2026-11-24T12:00:00.000Z',
      },
      associations: { workspaceIds: [workspaceId], sessionIds: [sessionId] },
    }
    const selectActivity = vi.fn()
    const ui = mount(
      state({ activities: [activities[0]!, secondActivity], selectedActivityId: activities[0]!.activity.id }),
      { selectActivity },
    )
    fireEvent.change(ui.getByRole('combobox'), { target: { value: 'activity-2' } })
    expect(selectActivity).toHaveBeenCalledWith('activity-2')

    ui.rerender(<CoordinateDialog {...props(state())} />)
    expect(ui.getByText(en['activity.empty'])).toBeTruthy()

    ui.rerender(<CoordinateDialog {...props(state({ activities, selectedActivityId: activities[0]!.activity.id }), { selectActivity })} />)
    expect(ui.getByText('Coordinate current work.')).toBeTruthy()
    expect(ui.getByText(en['status.selectTargets'])).toBeTruthy()
    expect(ui.getByText(en['targets.empty'])).toBeTruthy()

    const manyCandidates = Array.from({ length: 17 }, (_, index) => {
      const targetId = brandString<SessionId>(`candidate-${index}`)
      return {
        ...candidate,
        key: JSON.stringify([workspaceId, targetId]),
        target: { workspaceId, sessionId: targetId },
      }
    })
    const selectedKeys = manyCandidates.slice(0, 16).map(value => value.key)
    ui.rerender(<CoordinateDialog {...props(state({
      activities,
      candidates: manyCandidates,
      selectedActivityId: activities[0]!.activity.id,
      selectedKeys,
    }))} />)
    expect(ui.getByText(en['status.limit'])).toBeTruthy()
    expect(ui.getByRole('checkbox', { name: new RegExp('candidate-0') }).hasAttribute('disabled')).toBe(false)
    expect(ui.getByRole('checkbox', { name: new RegExp('candidate-16') }).hasAttribute('disabled')).toBe(true)

    const busyStates: Array<[ActivityCoordinationState['phase'], string]> = [
      ['loading', en['status.loading']],
      ['discovering', en['preview.loading']],
      ['sending', en['add.loading']],
    ]
    for (const [phase, message] of busyStates) {
      ui.rerender(
        <CoordinateDialog
          {...props(state({
            phase,
            activities,
            candidates: [candidate],
            selectedActivityId: activities[0]!.activity.id,
            selectedKeys: [candidate.key],
          }))}
        />,
      )
      expect(ui.getByRole('status').textContent).toBe(message)
      expect(ui.getByRole('button', { name: en['cancel'] }).hasAttribute('disabled')).toBe(true)
    }

    const failures: Array<[NonNullable<ActivityCoordinationState['failure']>, string]> = [
      ['load', en['status.unavailable']],
      ['discover', en['error.context']],
      ['add', en['add.uncertain']],
      ['history', en['responsibility.error.history']],
      ['reconcile', en['responsibility.error.reconcile']],
    ]
    for (const [failure, message] of failures) {
      ui.rerender(<CoordinateDialog {...props(state({ failure, activities }))} />)
      expect(ui.getByRole('alert').textContent).toBe(message)
    }

    ui.rerender(<CoordinateDialog {...props(state({ phase: 'sent', activities, candidates: [candidate], selectedActivityId: activities[0]!.activity.id }))} />)
    expect(ui.getAllByRole('status').some(node => node.textContent === en['add.done'])).toBe(true)
    expect(ui.getByRole('group', { name: en['targets.label'] }).hasAttribute('disabled')).toBe(true)
  })

  it('renders empty and attributed snapshot messages with optional provider and truncation metadata', () => {
    const activities = [{
      activity: {
        id: brandString<ActivityId>('activity-1'), name: 'Coordination', objective: 'Coordinate current work.',
        boundaries: { inScope: ['Inspect'], outOfScope: ['Do not execute'] }, createdAt: '2026-11-24T12:00:00.000Z',
      },
      associations: { workspaceIds: [workspaceId], sessionIds: [sessionId] },
    }]
    const emptySnapshot = { ...sourceSnapshot, recentMessages: [] }
    const attributedSnapshot = {
      ...sourceSnapshot,
      sessionId: brandString<SessionId>('session-with-provider'),
      recentMessages: [{ ...sourceSnapshot.recentMessages[0]!, provider: 'deepseek', model: 'v4.1-flash', truncated: true }],
    }
    const ui = mount(state({
      activities,
      selectedActivityId: activities[0]!.activity.id,
      selectedKeys: [candidate.key],
      snapshots: [emptySnapshot, attributedSnapshot],
      phase: 'discovered',
    }))
    expect(ui.getByText(en['preview.noMessages'])).toBeTruthy()
    expect(ui.getByText('Source: deepseek / v4.1-flash')).toBeTruthy()
    expect(ui.getByText(en['preview.truncated'])).toBeTruthy()
    fireEvent.change(ui.getByRole('combobox'), { target: { value: '' } })
  })
})

function state(overrides: Partial<ActivityCoordinationState> = {}): ActivityCoordinationState {
  return {
    open: true,
    mode: 'context',
    phase: 'ready',
    activities: [],
    selectedActivityId: null,
    candidates: [],
    selectedKeys: [],
    snapshots: [],
    histories: [],
    statusReports: [],
    historyShares: [],
    historyLoading: false,
    sourceMessage: null,
    responsibilityPhase: 'idle',
    responsibilityDraft: {
      targetKey: null, task: '', inScopeText: '', outOfScopeText: '', expectedOutcome: '', prerequisitesText: '', conflictingWorkText: '',
    },
    proposalRequestId: null,
    proposalFact: null,
    dispatchResult: null,
    reconcileResults: [],
    reconciling: [],
    failure: null,
    ...overrides,
  }
}

function props(value: ActivityCoordinationState, overrides: Partial<ActivityCoordinationProps> = {}): ActivityCoordinationProps {
  const useCoordination = (<T,>(select: (state: ActivityCoordinationState) => T): T =>
    useSyncExternalStore(() => () => undefined, () => select(value))) as ActivityCoordinationProps['useCoordination']
  return {
    useCoordination,
    dismiss: vi.fn(),
    selectActivity: vi.fn(),
    toggleTarget: vi.fn(),
    discover: vi.fn(async () => undefined),
    addToConversation: vi.fn(async () => undefined),
    selectProposalTarget: vi.fn(),
    editProposalDraft: vi.fn(),
    proposeResponsibility: vi.fn(async () => undefined),
    confirmAndDispatch: vi.fn(async () => undefined),
    reconcileResponsibility: vi.fn(async () => undefined),
    addResponsibilityToConversation: vi.fn(async () => undefined),
    t,
    ...overrides,
  }
}

function mount(value: ActivityCoordinationState, overrides: Partial<ActivityCoordinationProps> = {}) {
  const current = props(value, overrides)
  return render(<CoordinateDialog {...current} />)
}
