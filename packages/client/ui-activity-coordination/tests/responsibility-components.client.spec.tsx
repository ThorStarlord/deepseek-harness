// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ActivityCoordinationState } from '../src/client/surface.ts'
import type { ActivityCoordinationProps } from '../src/client/slots.ts'
import type {
  ActivityResponsibilityFact,
  ActivityResponsibilityFactId,
  ActivityResponsibilityHistory as ResponsibilityHistory,
  ActivityResponsibilityProposal,
  ActivityResponsibilityProposedFact,
} from '@deepseek-ai/dsh-home-activity/responsibility-types'
import type { ActivityCoordinationDispatchResult, ActivityCoordinationReconcileResult } from '@deepseek-ai/dsh-home-activity/coordination-types'
import type { ActivityId } from '@deepseek-ai/dsh-home-activity/activity-types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { ActivityResponsibilityHistory } from '../src/client/ActivityResponsibilityHistory.tsx'
import { ActivityResponsibilityDialog } from '../src/client/ActivityResponsibilityDialog.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(en, commonEn)
const activityId = brandString<ActivityId>('activity-1')
const workspaceId = brandString<WorkspaceId>('workspace-1')
const sessionId = brandString<SessionId>('session-1')
const responsibilityId = brandString<ResponsibilityHistory['id']>('responsibility-1')
const proposal: ActivityResponsibilityProposal = {
  target: { workspaceId, sessionId },
  task: 'Inspect the selected Session and report a bounded next step.',
  inScope: ['Read recent Session evidence'],
  outOfScope: ['Do not change repository files'],
  expectedOutcome: 'An attributed report with uncertainty.',
  prerequisites: ['Confirm the Session is still available'],
  conflictingWork: ['Existing queued work'],
}
const proposedFact: ActivityResponsibilityProposedFact = {
  id: factId('proposed'),
  responsibilityId,
  activityId,
  revision: 1,
  requestId: requestId('proposed'),
  recordedAt: '2026-11-24T12:00:00.000Z',
  kind: 'proposed',
  proposal,
  source: { kind: 'coordinating-session', sessionId: brandString<SessionId>('coordinator-1'), eventSeq: 42 },
}

describe('ActivityResponsibilityHistory', () => {
  it('shows loading and failure states, then renders nothing before any history exists', () => {
    const loading = render(<History state={state({ historyLoading: true })} />)
    expect(loading.getByRole('status').textContent).toBe(en['responsibility.history.loading'])
    loading.unmount()

    const failure = render(<History state={state({ failure: 'history' })} />)
    expect(failure.getByRole('alert').textContent).toBe(en['responsibility.error.history'])
    failure.unmount()

    const empty = render(<History state={state()} />)
    expect(empty.container.textContent).toBe('')
  })

  it('renders every durable fact and the distinct reconciliation and sharing states', () => {
    const histories = [
      history('one', [
        proposedFact,
        fact('confirmed', 2, { kind: 'confirmed', proposalFactId: proposedFact.id, proposal, actor: userActor() }),
        fact('attempt', 3, { kind: 'dispatch-attempted', promptRequestId: requestId('prompt-1'), targetSessionId: sessionId, source: 'session-controller.prompt' }),
        fact('settled', 4, { kind: 'dispatch-settled', promptRequestId: requestId('prompt-1'), targetSessionId: sessionId, outcome: 'accepted', source: 'session-controller.prompt' }),
        fact('observed', 5, { kind: 'observed', targetSessionId: sessionId, observedAt: '2026-11-24T12:05:00.000Z', observation: { status: 'available', cursor: 8, agentAvailable: true, active: false, running: false, queueAvailable: true, pendingInput: [] }, source: 'session-controller.state' }),
        fact('reported', 6, { kind: 'reported', targetSessionId: sessionId, promptRequestId: requestId('prompt-1'), sourceEventSeqs: [8, 9], summary: 'Provider reported completion.', reportedAt: '2026-11-24T12:06:00.000Z', source: 'target-session-assistant-message' }),
        fact('verified', 7, { kind: 'verification-recorded', reportFactId: factId('reported'), actor: sessionActor(), evidence: { source: 'test run', reference: 'run-1', result: 'passed', summary: 'Focused checks passed.', observedAt: '2026-11-24T12:07:00.000Z' } }),
        fact('accepted', 8, { kind: 'acceptance-recorded', reportFactId: factId('reported'), disposition: 'accepted', actor: userActor() }),
      ]),
      history('two', [
        proposed(null),
        fact('attempt-2', 2, { kind: 'dispatch-attempted', promptRequestId: requestId('prompt-2'), targetSessionId: sessionId, source: 'session-controller.prompt' }),
        fact('settled-2', 3, { kind: 'dispatch-settled', promptRequestId: requestId('prompt-2'), targetSessionId: sessionId, outcome: 'not-admitted', source: 'session-controller.prompt' }),
        fact('unavailable', 4, { kind: 'observed', targetSessionId: sessionId, observedAt: '2026-11-24T12:08:00.000Z', observation: { status: 'unavailable', reason: 'access-denied' }, source: 'session-controller.state' }),
        fact('declined', 5, { kind: 'acceptance-recorded', reportFactId: factId('reported-2'), disposition: 'declined', actor: userActor() }),
      ]),
      history('three', [
        proposed(),
        fact('attempt-3', 2, { kind: 'dispatch-attempted', promptRequestId: requestId('prompt-3'), targetSessionId: sessionId, source: 'session-controller.prompt' }),
        fact('settled-3', 3, { kind: 'dispatch-settled', promptRequestId: requestId('prompt-3'), targetSessionId: sessionId, outcome: 'uncertain', source: 'session-controller.prompt' }),
        fact('followup', 4, { kind: 'acceptance-recorded', reportFactId: factId('reported-3'), disposition: 'requires-follow-up', actor: userActor() }),
      ]),
      history('four', [proposed(), fact('attempt-4', 2, { kind: 'dispatch-attempted', promptRequestId: requestId('prompt-4'), targetSessionId: sessionId, source: 'session-controller.prompt' })]),
      history('five', [proposed(), fact('attempt-5', 2, { kind: 'dispatch-attempted', promptRequestId: requestId('prompt-5'), targetSessionId: sessionId, source: 'session-controller.prompt' })]),
      history('six', [proposed()]),
    ]
    const value = state({
      histories,
      reconciling: [histories[0]!.id],
      historyShares: [
        { responsibilityId: histories[0]!.id, status: 'sending' },
        { responsibilityId: histories[1]!.id, status: 'queued' },
        { responsibilityId: histories[2]!.id, status: 'uncertain' },
        { responsibilityId: histories[3]!.id, status: 'too-large' },
        { responsibilityId: histories[4]!.id, status: 'unavailable' },
      ],
      reconcileResults: (['awaiting-turn-end', 'no-dispatch', 'awaiting-target-input', 'no-completed-response', 'reported'] as const).map((reportState, index): ActivityCoordinationReconcileResult => ({
        history: histories[index]!, reportState,
        observed: { cursor: 0, active: false, running: false, queueAvailable: true, pendingInput: [] },
      })),
    })
    const reconcile = vi.fn(async () => undefined)
    const addToConversation = vi.fn(async () => undefined)
    const ui = render(<History state={value} reconcile={reconcile} addToConversation={addToConversation} />)

    for (const key of [
      'responsibility.fact.proposed', 'responsibility.fact.confirmed', 'responsibility.fact.dispatch-attempted',
      'responsibility.fact.dispatch-settled', 'responsibility.fact.observed', 'responsibility.fact.reported',
      'responsibility.fact.verification-recorded', 'responsibility.fact.acceptance-recorded',
      'responsibility.outcome.accepted', 'responsibility.outcome.not-admitted', 'responsibility.outcome.uncertain',
      'responsibility.acceptance.accepted', 'responsibility.acceptance.declined', 'responsibility.acceptance.requires-follow-up',
      'responsibility.reconcile.awaiting-turn-end', 'responsibility.reconcile.no-dispatch',
      'responsibility.reconcile.awaiting-target-input', 'responsibility.reconcile.no-completed-response',
      'responsibility.reconcile.reported', 'responsibility.history.share.queued',
      'responsibility.history.share.uncertain', 'responsibility.history.share.too-large',
      'responsibility.history.share.unavailable',
    ]) expect(ui.getAllByText(en[key as keyof typeof en]).length).toBeGreaterThan(0)
    expect(ui.getByText(/event 42/)).toBeTruthy()
    expect(ui.container.textContent).toContain('None recorded')
    expect(ui.getByText(/cursor: 8/)).toBeTruthy()
    expect(ui.getByText(/access-denied/)).toBeTruthy()
    expect(ui.getByText('Provider reported completion.')).toBeTruthy()
    expect(ui.getByText('Focused checks passed.')).toBeTruthy()

    const shareButtons = ui.getAllByRole('button', { name: /responsibility|historical/i })
    expect(shareButtons[0]?.textContent).toBe(en['responsibility.history.share.loading'])
    expect((shareButtons[0] as HTMLButtonElement).disabled).toBe(true)
    expect((shareButtons[1] as HTMLButtonElement).disabled).toBe(true)
    expect(ui.getByRole('alert').textContent).toBe(en['responsibility.history.share.uncertain'])

    const reconcileButtons = ui.getAllByRole('button', { name: en['responsibility.reconcile.button'] })
    expect(reconcileButtons).toHaveLength(4)
    expect((ui.getAllByRole('button', { name: en['responsibility.reconcile.loading'] })[0] as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(reconcileButtons[1]!)
    expect(reconcile).toHaveBeenCalledWith(histories[2]!.id)
    expect((shareButtons[1] as HTMLButtonElement).disabled).toBe(true)

    const actionable = render(
      <History
        state={state({ histories: [histories[5]!] })}
        reconcile={reconcile}
        addToConversation={addToConversation}
      />,
    )
    fireEvent.click(within(actionable.container).getByRole('button', { name: en['responsibility.history.share.button'] }))
    expect(addToConversation).toHaveBeenCalledWith(histories[5]!.id)
  })
})

describe('ActivityResponsibilityDialog', () => {
  it('covers loading, unavailable, empty-target, and source-truncation feedback', () => {
    const loading = render(<Dialog state={state({ phase: 'loading', activities: [catalogItem()] })} />)
    expect(loading.getByRole('status').textContent).toBe(en['status.loading'])
    loading.unmount()

    const unavailable = render(<Dialog state={state({ phase: 'ready', failure: 'load' })} />)
    expect(unavailable.getByRole('alert').textContent).toBe(en['status.unavailable'])
    unavailable.unmount()

    const empty = render(<Dialog state={state({ selectedActivityId: activityId, activities: [catalogItem()], responsibilityPhase: 'draft' })} />)
    expect(empty.getByText(en['targets.empty'])).toBeTruthy()
    empty.unmount()

    const truncated = render(<Dialog state={state({
      selectedActivityId: activityId,
      activities: [catalogItem()],
      sourceMessage: { id: brandString<MessageId>('source'), eventSeq: 3, text: 'A shortened recommendation.', truncated: true },
    })} />)
    expect(truncated.getByText(en['preview.truncated'])).toBeTruthy()
    expect(truncated.getByText(en['responsibility.source.trust'])).toBeTruthy()
  })

  it('validates every bounded draft field before enabling proposal save', () => {
    const baseDraft = { targetKey: candidateKey, task: 'Task', inScopeText: 'Inspect', outOfScopeText: '', expectedOutcome: 'Report', prerequisitesText: '', conflictingWorkText: '' }
    const invalidDrafts = [
      { ...baseDraft, task: '' }, { ...baseDraft, task: 'x'.repeat(4_001) },
      { ...baseDraft, expectedOutcome: '' }, { ...baseDraft, expectedOutcome: 'x'.repeat(2_001) },
      { ...baseDraft, inScopeText: '' }, { ...baseDraft, inScopeText: Array(33).fill('scope').join('\n') },
      { ...baseDraft, inScopeText: 'x'.repeat(1_001) },
      { ...baseDraft, outOfScopeText: Array(33).fill('scope').join('\n') }, { ...baseDraft, outOfScopeText: 'x'.repeat(1_001) },
      { ...baseDraft, prerequisitesText: Array(33).fill('scope').join('\n') }, { ...baseDraft, prerequisitesText: 'x'.repeat(1_001) },
      { ...baseDraft, conflictingWorkText: Array(33).fill('scope').join('\n') }, { ...baseDraft, conflictingWorkText: 'x'.repeat(1_001) },
    ]
    const current = render(<Dialog state={state({
      selectedActivityId: activityId,
      activities: [catalogItem()],
      candidates: [candidate()],
      sourceMessage: { id: brandString<MessageId>('source'), eventSeq: 3, text: 'Recommendation.', truncated: false },
      responsibilityPhase: 'draft',
      responsibilityDraft: baseDraft,
    })} />)
    for (const draft of invalidDrafts) {
      current.rerender(<Dialog state={state({
        selectedActivityId: activityId,
        activities: [catalogItem()],
        candidates: [candidate()],
        sourceMessage: { id: brandString<MessageId>('source'), eventSeq: 3, text: 'Recommendation.', truncated: false },
        responsibilityPhase: 'draft', responsibilityDraft: draft,
      })} />)
      expect((current.getByRole('button', { name: en['responsibility.proposal.save'] }) as HTMLButtonElement).disabled).toBe(true)
    }
    current.rerender(<Dialog state={state({
      selectedActivityId: activityId,
      activities: [catalogItem()],
      candidates: [candidate()],
      sourceMessage: { id: brandString<MessageId>('source'), eventSeq: 3, text: 'Recommendation.', truncated: false },
      responsibilityPhase: 'draft', responsibilityDraft: { ...baseDraft, task: '  Task  ', inScopeText: ' Inspect \n\nRead evidence' },
    })} />)
    expect((current.getByRole('button', { name: en['responsibility.proposal.save'] }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows all failure notices and busy, confirmation, dispatch, and uncertainty states', () => {
    const failures = [
      ['proposal', 'responsibility.error.proposal'], ['coordinator-unlinked', 'responsibility.error.coordinator'],
      ['dispatch', 'responsibility.error.dispatch'], ['source', 'responsibility.error.source'],
      ['history', 'responsibility.error.history'], ['reconcile', 'responsibility.error.reconcile'],
    ] as const
    const current = render(<Dialog state={state()} />)
    for (const [failure, key] of failures) {
      current.rerender(<Dialog state={state({ failure })} />)
      expect(current.getByRole('alert').textContent).toBe(en[key])
    }

    current.rerender(<Dialog state={state({ responsibilityPhase: 'saving' })} />)
    expect(current.getByRole('status').textContent).toBe(en['responsibility.proposal.saving'])
    expect((current.getByRole('button', { name: en['cancel'] }) as HTMLButtonElement).disabled).toBe(true)
    current.rerender(<Dialog state={state({
      phase: 'loading',
      selectedActivityId: activityId,
      activities: [catalogItem()],
      candidates: [candidate()],
      sourceMessage: { id: brandString<MessageId>('source'), eventSeq: 3, text: 'Recommendation.', truncated: false },
      responsibilityPhase: 'draft',
      responsibilityDraft: { targetKey: candidateKey, task: 'Task', inScopeText: 'Inspect', outOfScopeText: '', expectedOutcome: 'Report', prerequisitesText: '', conflictingWorkText: '' },
    })} />)
    expect((current.getByRole('button', { name: en['responsibility.proposal.saving'] }) as HTMLButtonElement).disabled).toBe(true)
    current.rerender(<Dialog state={state({ responsibilityPhase: 'dispatching' })} />)
    expect(current.getByRole('status').textContent).toBe(en['responsibility.dispatching'])
    current.rerender(<Dialog state={state({ responsibilityPhase: 'dispatched', dispatchResult: dispatchResult('accepted') })} />)
    expect(current.getByRole('status').textContent).toBe(en['responsibility.outcome.accepted'])
    current.rerender(<Dialog state={state({ responsibilityPhase: 'dispatched', dispatchResult: dispatchResult('not-admitted') })} />)
    expect(current.getByRole('status').textContent).toBe(en['responsibility.outcome.not-admitted'])
    current.rerender(<Dialog state={state({ responsibilityPhase: 'uncertain' })} />)
    expect(current.getByRole('alert').textContent).toBe(en['responsibility.outcome.uncertain'])
    current.rerender(<Dialog state={state({ responsibilityPhase: 'uncertain', dispatchResult: { ...dispatchResult('accepted'), recorded: false } })} />)
    expect(current.getByRole('alert').textContent).toBe(en['responsibility.outcome.history-unconfirmed'])
  })

  it('requires a selected target, calls only the chosen proposal action, and binds confirmation to the saved proposal', () => {
    const dismiss = vi.fn()
    const selectActivity = vi.fn()
    const selectProposalTarget = vi.fn()
    const editProposalDraft = vi.fn()
    const proposeResponsibility = vi.fn(async () => undefined)
    const confirmAndDispatch = vi.fn(async () => undefined)
    const current = render(<Dialog state={state({
      selectedActivityId: activityId,
      activities: [catalogItem()],
      candidates: [candidate()],
      sourceMessage: { id: brandString<MessageId>('source'), eventSeq: 3, text: 'Recommendation.', truncated: false },
      responsibilityPhase: 'draft',
      responsibilityDraft: { targetKey: null, task: 'Task', inScopeText: 'Inspect', outOfScopeText: '', expectedOutcome: 'Report', prerequisitesText: '', conflictingWorkText: '' },
    })} overrides={{ dismiss, selectActivity, selectProposalTarget, editProposalDraft, proposeResponsibility, confirmAndDispatch }} />)
    expect((current.getByRole('button', { name: en['responsibility.proposal.save'] }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(current.getByLabelText(en['activity.label']), { target: { value: activityId } })
    expect(selectActivity).toHaveBeenCalledWith(activityId)
    fireEvent.click(current.getByRole('radio', { name: /Harness/ }))
    expect(selectProposalTarget).toHaveBeenCalledWith(candidateKey)
    fireEvent.change(current.getByLabelText(en['responsibility.field.task']), { target: { value: 'Updated task' } })
    expect(editProposalDraft).toHaveBeenCalledWith({ task: 'Updated task' })
    for (const [field, key] of [
      ['inScopeText', 'responsibility.field.inScope'],
      ['outOfScopeText', 'responsibility.field.outOfScope'],
      ['expectedOutcome', 'responsibility.field.expected'],
      ['prerequisitesText', 'responsibility.field.prerequisites'],
      ['conflictingWorkText', 'responsibility.field.conflicts'],
    ] as const) {
      fireEvent.change(current.getByLabelText(en[key]), { target: { value: `Changed ${field}` } })
      expect(editProposalDraft).toHaveBeenLastCalledWith({ [field]: `Changed ${field}` })
    }
    fireEvent.click(current.getByRole('button', { name: en['cancel'] }))
    expect(dismiss).toHaveBeenCalledOnce()
    current.rerender(<Dialog state={state({
      selectedActivityId: activityId,
      activities: [catalogItem()],
      candidates: [candidate()],
      sourceMessage: { id: brandString<MessageId>('source'), eventSeq: 3, text: 'Recommendation.', truncated: false },
      responsibilityPhase: 'draft',
      responsibilityDraft: { targetKey: candidateKey, task: 'Task', inScopeText: 'Inspect', outOfScopeText: '', expectedOutcome: 'Report', prerequisitesText: '', conflictingWorkText: '' },
    })} overrides={{ selectProposalTarget, editProposalDraft, proposeResponsibility, confirmAndDispatch }} />)
    fireEvent.click(current.getByRole('button', { name: en['responsibility.proposal.save'] }))
    expect(proposeResponsibility).toHaveBeenCalledOnce()
    expect(confirmAndDispatch).not.toHaveBeenCalled()

    current.rerender(<Dialog state={state({
      selectedActivityId: activityId,
      activities: [catalogItem()],
      responsibilityPhase: 'confirm',
      proposalFact: { ...proposedFact, proposal: { ...proposal, outOfScope: [], prerequisites: [], conflictingWork: [] } },
    })} overrides={{ selectProposalTarget, editProposalDraft, proposeResponsibility, confirmAndDispatch }} />)
    expect(current.getByText(/Workspace workspace-1/)).toBeTruthy()
    expect(current.getAllByText(en['responsibility.none'])).toHaveLength(3)
    current.rerender(<Dialog state={state({
      responsibilityPhase: 'confirm',
      proposalFact: { ...proposedFact, proposal },
    })} overrides={{ selectProposalTarget, editProposalDraft, proposeResponsibility, confirmAndDispatch }} />)
    expect(current.getByText('Do not change repository files')).toBeTruthy()
    expect(current.getByText('Confirm the Session is still available')).toBeTruthy()
    expect(current.getByText('Existing queued work')).toBeTruthy()
    fireEvent.click(current.getByRole('button', { name: en['responsibility.confirm.button'] }))
    expect(confirmAndDispatch).toHaveBeenCalledOnce()
  })
})

const candidateKey = JSON.stringify([workspaceId, sessionId])

function History({ state: value, reconcile = vi.fn(async () => undefined), addToConversation = vi.fn(async () => undefined) }: {
  readonly state: ActivityCoordinationState
  readonly reconcile?: (responsibilityId: ResponsibilityHistory['id']) => Promise<void>
  readonly addToConversation?: (responsibilityId: ResponsibilityHistory['id']) => Promise<void>
}) {
  return <ActivityResponsibilityHistory state={value} t={t} reconcile={reconcile} addToConversation={addToConversation} />
}

function Dialog({ state: value, overrides = {} }: {
  readonly state: ActivityCoordinationState
  readonly overrides?: Partial<ActivityCoordinationProps>
}) {
  return <ActivityResponsibilityDialog {...props(value, overrides)} state={value} />
}

function props(value: ActivityCoordinationState, overrides: Partial<ActivityCoordinationProps> = {}): ActivityCoordinationProps {
  const useCoordination = (<T,>(select: (state: ActivityCoordinationState) => T): T =>
    useSyncExternalStore(() => () => undefined, () => select(value))) as ActivityCoordinationProps['useCoordination']
  return {
    useCoordination,
    dismiss: vi.fn(), selectActivity: vi.fn(), toggleTarget: vi.fn(), discover: vi.fn(async () => undefined),
    addToConversation: vi.fn(async () => undefined), selectProposalTarget: vi.fn(), editProposalDraft: vi.fn(),
    proposeResponsibility: vi.fn(async () => undefined), confirmAndDispatch: vi.fn(async () => undefined),
    reconcileResponsibility: vi.fn(async () => undefined), addResponsibilityToConversation: vi.fn(async () => undefined),
    t, ...overrides,
  }
}

function state(overrides: Partial<ActivityCoordinationState> = {}): ActivityCoordinationState {
  return {
    open: true, mode: 'responsibility', phase: 'ready', activities: [], selectedActivityId: null, candidates: [],
    selectedKeys: [], snapshots: [], histories: [], historyShares: [], historyLoading: false, sourceMessage: null,
    responsibilityPhase: 'idle',
    responsibilityDraft: { targetKey: null, task: '', inScopeText: '', outOfScopeText: '', expectedOutcome: '', prerequisitesText: '', conflictingWorkText: '' },
    proposalRequestId: null, proposalFact: null, dispatchResult: null, reconcileResults: [], reconciling: [], failure: null,
    ...overrides,
  }
}

function catalogItem() {
  return {
    activity: { id: activityId, name: 'Coordination', objective: 'Coordinate bounded work.', boundaries: { inScope: ['Inspect'], outOfScope: ['Do not execute'] }, createdAt: '2026-11-24T12:00:00.000Z' },
    associations: { workspaceIds: [workspaceId], sessionIds: [sessionId] },
  }
}

function candidate() {
  return {
    key: candidateKey,
    target: { workspaceId, sessionId },
    workspace: { workspaceId, title: 'Harness', path: 'C:/Projects/Harness', sessionIds: [sessionId], createdAt: '2026-11-24T12:00:00.000Z', updatedAt: '2026-11-24T12:00:00.000Z' },
  }
}

function history(suffix: string, facts: readonly ActivityResponsibilityFact[]): ResponsibilityHistory {
  const id = brandString<ResponsibilityHistory['id']>(`responsibility-${suffix}`)
  const selected = facts.map((entry, index) => ({
    ...entry,
    responsibilityId: id,
    activityId,
    revision: index + 1,
    previousFactId: index === 0 ? undefined : facts[index - 1]!.id,
  })) as readonly ActivityResponsibilityFact[]
  const initialProposal = selected.find((entry): entry is ActivityResponsibilityProposedFact => entry.kind === 'proposed') ?? proposed()
  return { id, activityId, proposal: { ...initialProposal, responsibilityId: id, activityId }, facts: selected }
}

function proposed(eventSeq: number | null = 7): ActivityResponsibilityProposedFact {
  return { ...proposedFact, id: factId(`proposed-${eventSeq ?? 'none'}`), responsibilityId, activityId, source: { ...proposedFact.source, ...(eventSeq === null ? { eventSeq: undefined } : { eventSeq }) } }
}

type ActivityResponsibilityFactDetails = ActivityResponsibilityFact extends infer Fact
  ? Fact extends ActivityResponsibilityFact
    ? Omit<Fact, 'id' | 'responsibilityId' | 'activityId' | 'revision' | 'requestId' | 'recordedAt' | 'previousFactId'>
    : never
  : never

function fact(id: string, revision: number, detail: ActivityResponsibilityFactDetails): ActivityResponsibilityFact {
  return {
    ...detail,
    id: factId(id), responsibilityId, activityId, revision, requestId: requestId(id), recordedAt: `2026-11-24T12:${String(revision).padStart(2, '0')}:00.000Z`,
  } as ActivityResponsibilityFact
}

function factId(value: string) { return brandString<ActivityResponsibilityFactId>(`fact-${value}`) }
function requestId(value: string) { return brandString<ResponsibilityHistory['proposal']['requestId']>(`request-${value}`) }
function userActor() { return { kind: 'authenticated-user' as const, principal: { kind: 'owner' as const } } }
function sessionActor() { return { kind: 'dsh-session' as const, sessionId: brandString<SessionId>('reviewer-session') } }
function dispatchResult(outcome: 'accepted' | 'not-admitted'): ActivityCoordinationDispatchResult {
  return { outcome, promptRequestId: `prompt-${outcome}`, recorded: true, history: history(`dispatch-${outcome}`, [proposed()]) }
}
