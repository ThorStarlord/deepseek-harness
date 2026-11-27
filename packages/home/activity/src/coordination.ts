/** Authenticated Activity-scoped discovery of explicitly selected root Sessions. */

import { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionPromptRequest, SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import { SessionQueryError, type SessionObservation } from '@deepseek-ai/dsh-session-query'
import { Remote, RemoteError, TypertRemoteService, type Principal } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertResource } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ActivityResponsibilityHistory,
  ActivityResponsibilityId,
  ActivityResponsibilityPrincipal,
  ActivityResponsibilityProposal,
  ActivityResponsibilityProposedFact,
  ActivityResponsibilityReportedFact,
} from './responsibility-types.ts'
import { ActivityResponsibilityStorageError, activityResponsibilityRequestId } from './responsibilities.ts'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { Workspace } from '@deepseek-ai/dsh-workspace/types'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-gateway'
import type {} from '@deepseek-ai/dsh-api-remote-access'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-workspace'
import type { Activity, ActivityId } from './activity-types.ts'
import type {
  ActivityCoordinationCatalogItem,
  ActivityCoordinationDispatchRequest,
  ActivityCoordinationDispatchResult,
  ActivityCoordinationMessage,
  ActivityCoordinationProposalRequest,
  ActivityCoordinationReconcileResult,
  ActivityCoordinationResponsibilityList,
  ActivityCoordinationSessionSnapshot,
  ActivityCoordinationTarget,
} from './coordination-types.ts'
import type {} from './activity-types.ts'
import type {} from './associations.ts'
import type {} from './types.ts'

const MAX_DISCOVERY_TARGETS = 16
const MAX_RECENT_MESSAGES = 3
const MAX_MESSAGE_CODE_POINTS = 1000

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Authenticated Activity-scoped discovery and coordination API. */
    homeActivityCoordination: ActivityCoordinationService
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertResourceMap {
    /** One saved Activity; associations never grant access to its targets. */
    activity: TypertResource<ActivityId>
  }

  interface RemoteErrorDetailsMap {
    /** The selected Activity, Workspace, or root Session reference is stale, unrelated, or mismatched. */
    'activity-coordination/context-invalid': {
      readonly activityId: ActivityId
      readonly workspaceId?: WorkspaceId
      readonly sessionId?: SessionId
      readonly reason: 'activity-unavailable' | 'not-associated' | 'workspace-unavailable'
        | 'session-not-in-workspace' | 'session-unavailable' | 'subagent-target' | 'repository-mismatch'
        | 'coordinator-session-unavailable'
    }
    /** Discovery selections do not describe one to sixteen distinct targets. */
    'activity-coordination/selection-invalid': Record<string, never>
    /** A proposed responsibility does not cite an assistant message from the selected coordinator Session. */
    'activity-coordination/proposal-invalid': { readonly activityId: ActivityId; readonly sessionId: SessionId }
    /** A responsibility or one of its selected references is unavailable to this caller. */
    'activity-coordination/responsibility-unavailable': { readonly activityId: ActivityId }
  }
}

/** Authenticated Client API for Activity-scoped, passive Session discovery. */
export class ActivityCoordinationService extends TypertRemoteService {
  static inject = [
    'agents',
    'homeActivityResponsibilities',
    'homeActivities',
    'homeActivityAssociations',
    'remoteAccess',
    'sessionQuery',
    'sessionController',
    'typertGateway',
    'workspaceRegistry',
  ]

  private readonly dispatches = new Map<ActivityResponsibilityId, Promise<void>>()

  constructor(ctx: Context) {
    super(ctx, 'homeActivityCoordination')
  }

  /**
   * List saved Activities visible to the authenticated caller, with their separately selected references.
   * @returns newest-first Activities and descriptive Workspace and Session links.
   */
  @Remote('activities')
  activities(): readonly ActivityCoordinationCatalogItem[] {
    return this.ctx.homeActivities.list()
      .filter(activity => this.ctx.remoteAccess.allows({ kind: 'activity', id: activity.id }))
      .map((activity) => {
        const associations = this.ctx.homeActivityAssociations.get(activity.id)
        return {
          activity,
          associations: Object.freeze({
            workspaceIds: Object.freeze(associations.workspaceIds.filter(id => this.ctx.remoteAccess.allows({ kind: 'workspace', id }))),
            sessionIds: Object.freeze(associations.sessionIds.filter(id => this.ctx.remoteAccess.allows({ kind: 'session', id }))),
          }),
        }
      })
  }

  /**
   * Read bounded recent text from explicitly selected associated root Sessions without activating them.
   * Every request is checked for the Activity, each Workspace, and each Session at the Gateway, then the
   * Host verifies the saved links, current Workspace membership, root identity, and Session cwd.
   * @param request - Activity and one to sixteen distinct Workspace/Session pairs.
   * @param signal - cancellation for all cold Session observations.
   * @returns exact observations ordered as requested, at their own Session-log cursors.
   */
  @Remote({ resources: {
    activity: request => request.activityId,
    workspace: request => request.targets.map(target => target.workspaceId),
    session: request => request.targets.map(target => target.sessionId),
  } })
  async discover(
    request: { readonly activityId: ActivityId; readonly targets: readonly ActivityCoordinationTarget[] },
    signal: AbortSignal,
  ): Promise<readonly ActivityCoordinationSessionSnapshot[]> {
    validateSelection(request.targets)
    const activity = this.ctx.homeActivities.get(request.activityId)
    if (activity === undefined) throw contextInvalid(request.activityId, 'activity-unavailable')
    const associations = this.ctx.homeActivityAssociations.get(request.activityId)
    const output: ActivityCoordinationSessionSnapshot[] = []

    for (const target of request.targets) {
      signal.throwIfAborted()
      if (!associations.workspaceIds.includes(target.workspaceId)
        || !associations.sessionIds.includes(target.sessionId)) {
        throw contextInvalid(request.activityId, 'not-associated', target)
      }
      const workspace = this.ctx.workspaceRegistry.get(target.workspaceId)
      if (workspace === undefined) throw contextInvalid(request.activityId, 'workspace-unavailable', target)
      if (!workspace.sessionIds.includes(target.sessionId)) {
        throw contextInvalid(request.activityId, 'session-not-in-workspace', target)
      }

      let observation: SessionObservation
      try {
        observation = await this.ctx.sessionQuery.observeSession(target.sessionId, {
          signal,
          projectionMode: 'none',
        })
      } catch (error: unknown) {
        if (signal.aborted) throw new RemoteError('gateway/cancelled', 'Session discovery was cancelled', {}, { cause: error })
        if (error instanceof SessionQueryError && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
          throw contextInvalid(request.activityId, 'session-unavailable', target)
        }
        throw error
      }
      using owned = observation
      if (owned.header.origin === 'subagent') {
        throw contextInvalid(request.activityId, 'subagent-target', target)
      }
      if (owned.header.cwd === undefined || owned.header.cwd !== workspace.path) {
        throw contextInvalid(request.activityId, 'repository-mismatch', target)
      }
      const agent = this.ctx.agents.get(target.sessionId)
      output.push(Object.freeze({
        activityId: activity.id,
        workspaceId: workspace.id,
        workspaceTitle: workspace.title,
        workspacePath: workspace.path,
        sessionId: owned.header.id,
        sessionCwd: owned.header.cwd,
        sessionCreatedAt: owned.header.createdAt,
        observedAt: Date.now(),
        source: owned.source,
        cursor: owned.cursor,
        runtime: runtimeState(agent),
        recentMessages: Object.freeze(recentMessages(owned)),
      }))
    }
    return Object.freeze(output)
  }

  /**
   * Recover responsibility histories whose Activity, source Session, Workspace, and target Session are readable.
   * @param request - saved Activity identity.
   * @returns histories in append order without exposing references the caller cannot read.
   */
  @Remote({ resources: { activity: request => request.activityId } })
  responsibilities(request: { readonly activityId: ActivityId }): ActivityCoordinationResponsibilityList {
    return { items: this.ctx.homeActivityResponsibilities.list(request.activityId)
      .filter((history) => {
        return this.canReadHistory(history)
      }) }
  }

  /**
   * Save an agent recommendation only when its source is an attributed assistant message in the coordinating Session.
   * This operation records advisory intent; it does not confirm or send the task.
   * @param request - bounded proposal, selected target, and exact source message identity.
   * @param signal - cancellation for passive source and target reads.
   * @returns the append-only proposal fact and stable responsibility identity.
   */
  @Remote({ resources: {
    activity: request => request.activityId,
    workspace: request => request.target.workspaceId,
    session: request => [request.coordinatingSessionId, request.target.sessionId],
  } })
  async propose(
    request: ActivityCoordinationProposalRequest,
    signal: AbortSignal,
  ): Promise<ActivityResponsibilityProposedFact> {
    await this.validateTarget(request.activityId, request.target, signal)
    if (request.coordinatingSessionId === request.target.sessionId) {
      throw selectionInvalid('The coordinating Session and target Session must be different root Sessions.')
    }
    const associations = this.ctx.homeActivityAssociations.get(request.activityId)
    if (!associations.sessionIds.includes(request.coordinatingSessionId)) {
      throw coordinatorInvalid(request.activityId, request.coordinatingSessionId)
    }
    const source = await this.ctx.sessionQuery.observeSession(request.coordinatingSessionId, {
      signal,
      projectionMode: 'none',
    })
    using ownedSource = source
    if (ownedSource.header.id !== request.coordinatingSessionId || ownedSource.header.origin === 'subagent') {
      throw coordinatorInvalid(request.activityId, request.coordinatingSessionId)
    }
    const coordinatorWorkspace = associations.workspaceIds
      .map(workspaceId => this.ctx.workspaceRegistry.get(workspaceId))
      .find(workspace => workspace !== undefined
        && workspace.sessionIds.includes(request.coordinatingSessionId)
        && workspace.path === ownedSource.header.cwd
        && this.ctx.remoteAccess.allows({ kind: 'workspace', id: workspace.id }))
    if (coordinatorWorkspace === undefined) {
      throw coordinatorInvalid(request.activityId, request.coordinatingSessionId)
    }
    const sourceEvent = ownedSource.events.find(event => event.seq === request.sourceEventSeq)
    if (sourceEvent?.type !== 'assistant/message' || sourceEvent.data.message.source.kind !== 'model') {
      throw proposalInvalid(request.activityId, request.coordinatingSessionId)
    }
    const { activityId, requestId, coordinatingSessionId, sourceEventSeq, ...proposal } = request
    return await this.ctx.homeActivityResponsibilities.createProposal({
      ...proposal,
      activityId,
      requestId: activityResponsibilityRequestId(requestId),
      coordinatingSessionId,
      sourceEventSeq,
    })
  }

  /**
   * Recover append-only histories for an Activity without waking target Sessions.
   * @param request - Activity identity and responsibility identity.
   * @returns the history when the caller can read its source and target Sessions and Workspace.
   */
  @Remote({ resources: { activity: request => request.activityId } })
  responsibility(request: {
    readonly activityId: ActivityId
    readonly responsibilityId: ActivityResponsibilityId
  }): ActivityResponsibilityHistory {
    const history = this.ctx.homeActivityResponsibilities.get(request.activityId, request.responsibilityId)
    if (history === undefined || !this.canReadHistory(history)) {
      throw responsibilityUnavailable(request.activityId)
    }
    return history
  }

  /**
   * Bind the displayed proposal to an authenticated user confirmation, then send it through the native `session/prompt` route.
   * Persist a Host-generated request identity before delivery for safe retry handling and later report correlation.
   * The nested Gateway call rechecks the caller's actual `session/prompt` grant for the exact target.
   * @param request - exact proposal echo and authenticated confirmation id.
   * @param signal - cancellation for target validation and prompt admission.
   * @returns confirmed admission, known non-admission, or an explicitly uncertain result with recovered history.
   */
  @Remote({ resources: {
    activity: request => request.activityId,
    workspace: request => request.proposal.target.workspaceId,
    session: request => request.proposal.target.sessionId,
  } })
  async dispatchConfirmed(
    request: ActivityCoordinationDispatchRequest,
    signal: AbortSignal,
  ): Promise<ActivityCoordinationDispatchResult> {
    return await this.withDispatchLock(request.responsibilityId, async () => await this.dispatchConfirmedOnce(request, signal))
  }

  /** Perform one serialized dispatch attempt after the per-responsibility lock is held. */
  private async dispatchConfirmedOnce(
    request: ActivityCoordinationDispatchRequest,
    signal: AbortSignal,
  ): Promise<ActivityCoordinationDispatchResult> {
    const responsibilityId = request.responsibilityId
    const proposalFactId = request.proposalFactId
    const historyBefore = this.ctx.homeActivityResponsibilities.get(request.activityId, responsibilityId)
    if (historyBefore === undefined || !this.canReadHistory(historyBefore) || historyBefore.proposal.id !== proposalFactId
      || !sameProposal(historyBefore.proposal.proposal, request.proposal)) {
      throw responsibilityUnavailable(request.activityId)
    }
    const target = request.proposal.target
    await this.validateTarget(request.activityId, target, signal)
    const invocation = this.ctx.invocation
    if (invocation === undefined || invocation.request.namespace !== 'homeActivityCoordination'
      || invocation.request.method !== 'dispatchConfirmed' || invocation.peer.principal.kind !== 'owner') {
      throw new RemoteError('gateway/invocation-unavailable', 'Confirmation requires an authenticated Client call.', {
        endpoint: 'homeActivityCoordination/dispatchConfirmed',
      })
    }
    const principal = principalSnapshot(invocation.peer.principal)
    const priorConfirmation = historyBefore.facts.find(fact => fact.kind === 'confirmed')
    if (priorConfirmation === undefined) {
      await this.ctx.homeActivityResponsibilities.confirm({
        activityId: request.activityId,
        responsibilityId,
        requestId: activityResponsibilityRequestId(request.confirmationRequestId),
        proposalFactId,
        proposal: request.proposal,
        principal,
      })
    }

    const priorAttempt = historyBefore.facts.find(fact => fact.kind === 'dispatch-attempted')
    if (priorAttempt !== undefined) {
      const history = this.ctx.homeActivityResponsibilities.get(request.activityId, responsibilityId)
      if (history === undefined) throw responsibilityUnavailable(request.activityId)
      const settled = history.facts.find(fact => fact.kind === 'dispatch-settled')
      if (settled === undefined) {
        return { outcome: 'uncertain', promptRequestId: priorAttempt.promptRequestId, recorded: true, diagnostic: 'delivery-uncertain', history }
      }
      return {
        outcome: settled.outcome,
        promptRequestId: priorAttempt.promptRequestId,
        recorded: true,
        ...(settled.outcome === 'uncertain' ? { diagnostic: 'delivery-uncertain' as const } : {}),
        history,
      }
    }

    const promptRequestId = brandString<SessionRequestId>(randomUUID())
    await this.ctx.homeActivityResponsibilities.beginDispatch({
      activityId: request.activityId,
      responsibilityId,
      promptRequestId: activityResponsibilityRequestId(promptRequestId),
    })
    const activity = this.ctx.homeActivities.get(request.activityId)
    if (activity === undefined) throw contextInvalid(request.activityId, 'activity-unavailable')
    const prompt: SessionPromptRequest = {
      requestId: promptRequestId,
      sessionId: target.sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: assignmentPrompt(activity, request.proposal) }],
    }
    let outcome: ActivityCoordinationDispatchResult['outcome'] = 'uncertain'
    let diagnostic: ActivityCoordinationDispatchResult['diagnostic'] = 'delivery-uncertain'
    try {
      const result = await this.ctx.typertGateway.invoke({
        peer: invocation.peer,
        namespace: 'session',
        method: 'prompt',
        args: { request: prompt },
        signal,
      })
      if (isAcceptedPrompt(result)) {
        outcome = 'accepted'
        diagnostic = undefined
      }
    } catch (error: unknown) {
      if (signal.aborted) {
        outcome = 'uncertain'
      } else if (definiteNonAdmission(error)) {
        outcome = 'not-admitted'
        diagnostic = dispatchDiagnostic(error)
      }
    }

    let recorded = true
    try {
      await this.ctx.homeActivityResponsibilities.settleDispatch({
        activityId: request.activityId,
        responsibilityId,
        promptRequestId: activityResponsibilityRequestId(promptRequestId),
        outcome,
        ...(outcome === 'uncertain' ? { diagnostic: 'delivery outcome could not be confirmed' } : {}),
      })
    } catch (error: unknown) {
      if (!(error instanceof ActivityResponsibilityStorageError)) throw error
      recorded = false
    }
    const history = this.ctx.homeActivityResponsibilities.get(request.activityId, responsibilityId)
    if (history === undefined) throw responsibilityUnavailable(request.activityId)
    return {
      outcome,
      promptRequestId,
      recorded,
      ...(recorded ? {} : { diagnostic: 'history-unconfirmed' as const }),
      ...(recorded && diagnostic !== undefined ? { diagnostic } : {}),
      history,
    }
  }

  /** Prevent duplicate Client confirmations from racing the same native Session request within this Host process. */
  private async withDispatchLock<T>(responsibilityId: ActivityResponsibilityId, operation: () => Promise<T>): Promise<T> {
    const predecessor = this.dispatches.get(responsibilityId) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    this.dispatches.set(responsibilityId, current)
    await predecessor
    try {
      return await operation()
    } finally {
      release()
      if (this.dispatches.get(responsibilityId) === current) this.dispatches.delete(responsibilityId)
    }
  }

  /**
   * Read current target state and append a source-attributed observation; it does not resume the target.
   * @param request - Activity responsibility and exact Workspace/Session target.
   * @param signal - cancellation for passive reads.
   * @returns the new observation and complete responsibility history.
   */
  @Remote({ resources: {
    activity: request => request.activityId,
    workspace: request => request.workspaceId,
    session: request => request.sessionId,
  } })
  async observeResponsibility(
    request: {
      readonly activityId: ActivityId
      readonly responsibilityId: ActivityResponsibilityId
      readonly workspaceId: WorkspaceId
      readonly sessionId: SessionId
    },
    signal: AbortSignal,
  ): Promise<ActivityResponsibilityHistory> {
    const history = this.requireTargetHistory(request)
    await this.validateTarget(request.activityId, { workspaceId: request.workspaceId, sessionId: request.sessionId }, signal)
    const state = await this.ctx.sessionController.state({ sessionId: request.sessionId }, signal)
    const observedAt = new Date().toISOString()
    await this.ctx.homeActivityResponsibilities.recordObservation({
      activityId: request.activityId,
      responsibilityId: history.id,
      requestId: activityResponsibilityRequestId(randomUUID()),
      observedAt,
      observation: {
        status: 'available',
        cursor: state.cursor,
        agentAvailable: state.active,
        active: state.active,
        running: state.running,
        queueAvailable: state.queue !== null,
        pendingInput: state.pendingInput,
      },
    })
    return this.ctx.homeActivityResponsibilities.get(request.activityId, history.id) ?? history
  }

  /**
   * Reconcile one responsibility against its exact target request id using only passive Session reads.
   * @param request - Activity, responsibility, and exact Workspace/Session identity.
   * @param signal - cancellation of the state and history reads.
   * @returns current execution state plus a report only when its matching target turn completed.
   */
  @Remote({ resources: {
    activity: request => request.activityId,
    workspace: request => request.workspaceId,
    session: request => request.sessionId,
  } })
  async reconcileResponsibility(
    request: {
      readonly activityId: ActivityId
      readonly responsibilityId: ActivityResponsibilityId
      readonly workspaceId: WorkspaceId
      readonly sessionId: SessionId
    },
    signal: AbortSignal,
  ): Promise<ActivityCoordinationReconcileResult> {
    const history = this.requireTargetHistory(request)
    await this.validateTarget(request.activityId, { workspaceId: request.workspaceId, sessionId: request.sessionId }, signal)
    const state = await this.ctx.sessionController.state({ sessionId: request.sessionId }, signal)
    const status = {
      cursor: state.cursor,
      active: state.active,
      running: state.running,
      queueAvailable: state.queue !== null,
      pendingInput: state.pendingInput,
    }
    await this.ctx.homeActivityResponsibilities.recordObservation({
      activityId: request.activityId,
      responsibilityId: history.id,
      requestId: activityResponsibilityRequestId(randomUUID()),
      observedAt: new Date().toISOString(),
      observation: {
        status: 'available',
        cursor: state.cursor,
        agentAvailable: state.active,
        active: state.active,
        running: state.running,
        queueAvailable: state.queue !== null,
        pendingInput: state.pendingInput,
      },
    })
    const latest = this.ctx.homeActivityResponsibilities.get(request.activityId, history.id) ?? history
    const attempt = latest.facts.find(fact => fact.kind === 'dispatch-attempted')
    if (attempt === undefined) return { history: latest, observed: status, reportState: 'no-dispatch' }
    const settled = latest.facts.find((fact): fact is Extract<ActivityResponsibilityHistory['facts'][number], { kind: 'dispatch-settled' }> =>
      fact.kind === 'dispatch-settled' && fact.promptRequestId === attempt.promptRequestId)
    if (settled?.outcome === 'not-admitted') return { history: latest, observed: status, reportState: 'no-dispatch' }
    const priorReport = latest.facts.find((fact): fact is ActivityResponsibilityReportedFact =>
      fact.kind === 'reported' && fact.promptRequestId === attempt.promptRequestId,
    )
    if (priorReport !== undefined) return { history: latest, observed: status, reportState: 'reported', report: priorReport }

    const observation = await this.ctx.sessionQuery.observeSession(request.sessionId, { signal, projectionMode: 'none' })
    using owned = observation
    const userInput = owned.events.find((event): event is Extract<SessionEvent, { type: 'user/message' }> =>
      event.type === 'user/message' && event.data.source.kind === 'user'
      && 'rpcId' in event.data.source
      && String(event.data.source.rpcId) === String(attempt.promptRequestId))
    if (userInput === undefined) return { history: latest, observed: status, reportState: 'awaiting-target-input' }
    if (settled === undefined) {
      await this.ctx.homeActivityResponsibilities.settleDispatch({
        activityId: request.activityId,
        responsibilityId: history.id,
        promptRequestId: activityResponsibilityRequestId(attempt.promptRequestId),
        outcome: 'accepted',
      })
    }
    const turnStart = containingTurnStart(owned.events, userInput.seq)
    if (turnStart === undefined) return { history: this.ctx.homeActivityResponsibilities.get(request.activityId, history.id) ?? latest, observed: status, reportState: 'awaiting-turn-end' }
    const turnEnd = owned.events.find((event): event is Extract<SessionEvent, { type: 'turn/end' }> =>
      event.type === 'turn/end' && event.seq > userInput.seq && event.data.turn === turnStart.data.turn)
    if (turnEnd === undefined) return { history: this.ctx.homeActivityResponsibilities.get(request.activityId, history.id) ?? latest, observed: status, reportState: 'awaiting-turn-end' }
    if (turnEnd.data.reason.kind !== 'completed') {
      return { history: this.ctx.homeActivityResponsibilities.get(request.activityId, history.id) ?? latest, observed: status, reportState: 'no-completed-response' }
    }
    const assistant = owned.events.findLast(event => event.type === 'assistant/message'
      && event.data.turn === turnStart.data.turn && event.seq > userInput.seq
      && event.seq < turnEnd.seq
      && event.data.message.content.some(block => block.type === 'text' && block.text.trim().length > 0))
    if (assistant?.type !== 'assistant/message') {
      return { history: this.ctx.homeActivityResponsibilities.get(request.activityId, history.id) ?? latest, observed: status, reportState: 'no-completed-response' }
    }
    const summary = truncateUnicodeCodePoints(assistant.data.message.content
      .flatMap(block => block.type === 'text' ? [block.text] : []).join(' ')
      .replace(/\s+/gu, ' ').trim(), 4_000).text
    /* v8 ignore next 2 -- findLast accepts only trimmed assistant text after whitespace normalization. */
    if (summary.length === 0) {
      return { history: this.ctx.homeActivityResponsibilities.get(request.activityId, history.id) ?? latest, observed: status, reportState: 'no-completed-response' }
    }
    await this.ctx.homeActivityResponsibilities.recordReport({
      activityId: request.activityId,
      responsibilityId: history.id,
      requestId: activityResponsibilityRequestId(attempt.promptRequestId),
      promptRequestId: activityResponsibilityRequestId(attempt.promptRequestId),
      sourceEventSeqs: [userInput.seq, assistant.seq, turnEnd.seq],
      summary,
      reportedAt: new Date(turnEnd.time).toISOString(),
    })
    const updated = this.ctx.homeActivityResponsibilities.get(request.activityId, history.id) ?? latest
    const report = updated.facts.find((fact): fact is ActivityResponsibilityReportedFact =>
      fact.kind === 'reported' && fact.promptRequestId === attempt.promptRequestId,
    )
    return report === undefined
      ? { history: updated, observed: status, reportState: 'no-completed-response' }
      : { history: updated, observed: status, reportState: 'reported', report }
  }

  /** Revalidate an associated Workspace/Session pair and dispose the passive observation before returning. */
  private async validateTarget(
    activityId: ActivityId,
    target: ActivityCoordinationTarget,
    signal: AbortSignal,
  ): Promise<{ readonly workspace: Workspace }> {
    if (this.ctx.homeActivities.get(activityId) === undefined) throw contextInvalid(activityId, 'activity-unavailable')
    const associations = this.ctx.homeActivityAssociations.get(activityId)
    if (!associations.workspaceIds.includes(target.workspaceId) || !associations.sessionIds.includes(target.sessionId)) {
      throw contextInvalid(activityId, 'not-associated', target)
    }
    const workspace = this.ctx.workspaceRegistry.get(target.workspaceId)
    if (workspace === undefined) throw contextInvalid(activityId, 'workspace-unavailable', target)
    if (!workspace.sessionIds.includes(target.sessionId)) throw contextInvalid(activityId, 'session-not-in-workspace', target)
    try {
      const observation = await this.ctx.sessionQuery.observeSession(target.sessionId, { signal, projectionMode: 'none' })
      using owned = observation
      if (owned.header.origin === 'subagent') throw contextInvalid(activityId, 'subagent-target', target)
      if (owned.header.id !== target.sessionId || owned.header.cwd === undefined || owned.header.cwd !== workspace.path) {
        throw contextInvalid(activityId, 'repository-mismatch', target)
      }
    } catch (error: unknown) {
      if (signal.aborted) throw new RemoteError('gateway/cancelled', 'Session coordination was cancelled.', {}, { cause: error })
      if (error instanceof RemoteError) throw error
      if (error instanceof SessionQueryError && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
        throw contextInvalid(activityId, 'session-unavailable', target)
      }
      throw error
    }
    return { workspace }
  }

  /** Read one responsibility only when its immutable target matches the caller's requested target. */
  private requireTargetHistory(request: {
    readonly activityId: ActivityId
    readonly responsibilityId: ActivityResponsibilityId
    readonly workspaceId: WorkspaceId
    readonly sessionId: SessionId
  }): ActivityResponsibilityHistory {
    const history = this.ctx.homeActivityResponsibilities.get(request.activityId, request.responsibilityId)
    const target = history?.proposal.proposal.target
    if (history === undefined || target?.workspaceId !== request.workspaceId || target.sessionId !== request.sessionId
      || !this.canReadHistory(history)) {
      throw responsibilityUnavailable(request.activityId)
    }
    return history
  }

  /** Require access to every Session and Workspace whose identity appears in a returned history. */
  private canReadHistory(history: ActivityResponsibilityHistory): boolean {
    const target = history.proposal.proposal.target
    const sourceSessionId = history.proposal.source.sessionId
    return this.ctx.remoteAccess.allows({ kind: 'session', id: sourceSessionId })
      && this.ctx.remoteAccess.allows({ kind: 'workspace', id: target.workspaceId })
      && this.ctx.remoteAccess.allows({ kind: 'session', id: target.sessionId })
  }
}

/** Find the active turn containing one logged user message without scanning later turns.
 * @param events - Ordered durable Session events.
 * @param inputSeq - Event sequence of the matched user message.
 * @returns the preceding unmatched turn start, when the message belongs to an active turn.
 */
function containingTurnStart(
  events: readonly SessionEvent[],
  inputSeq: number,
): Extract<SessionEvent, { type: 'turn/start' }> | undefined {
  let active: Extract<SessionEvent, { type: 'turn/start' }> | undefined
  for (const event of events) {
    if (event.seq >= inputSeq) break
    if (event.type === 'turn/start') active = event
    if (event.type === 'turn/end' && active?.data.turn === event.data.turn) active = undefined
  }
  return active
}

/** Reject a coordinating Session that is no longer linked to the Activity. */
function coordinatorInvalid(activityId: ActivityId, sessionId: SessionId): RemoteError<'activity-coordination/context-invalid'> {
  return new RemoteError('activity-coordination/context-invalid', 'The selected coordinating Session is unavailable or no longer linked.', {
    activityId,
    sessionId,
    reason: 'coordinator-session-unavailable',
  })
}

/** Reject a proposal whose source is not a model-authored Session message. */
function proposalInvalid(activityId: ActivityId, sessionId: SessionId): RemoteError<'activity-coordination/proposal-invalid'> {
  return new RemoteError('activity-coordination/proposal-invalid', 'Select a recommendation recorded in the coordinating Session.', {
    activityId,
    sessionId,
  })
}

/** Return a generic unavailable response without exposing a hidden target identity. */
function responsibilityUnavailable(activityId: ActivityId): RemoteError<'activity-coordination/responsibility-unavailable'> {
  return new RemoteError('activity-coordination/responsibility-unavailable', 'This responsibility is unavailable in the selected Activity.', { activityId })
}

/** Confirm equality of all user-visible proposal fields. */
function sameProposal(left: ActivityResponsibilityProposal, right: ActivityResponsibilityProposal): boolean {
  return left.task === right.task
    && left.expectedOutcome === right.expectedOutcome
    && left.target.workspaceId === right.target.workspaceId
    && left.target.sessionId === right.target.sessionId
    && equalStrings(left.inScope, right.inScope)
    && equalStrings(left.outOfScope, right.outOfScope)
    && equalStrings(left.prerequisites, right.prerequisites)
    && equalStrings(left.conflictingWork, right.conflictingWork)
}

/** Compare ordered string fields without normalizing the confirmed text. */
function equalStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

/** Retain the sole authenticated local owner identity and exclude unrelated Peer metadata from durable facts. */
function principalSnapshot(principal: Extract<Principal, { readonly kind: 'owner' }>): ActivityResponsibilityPrincipal {
  return Object.freeze({ kind: principal.kind })
}

/** Recognize the successful Session Controller admission receipt without trusting an unchecked cast. */
function isAcceptedPrompt(value: unknown): value is { readonly accepted: true } {
  return typeof value === 'object' && value !== null && 'accepted' in value && value.accepted === true
}

/** Classify only known pre-admission rejections; other failures remain uncertain. */
function definiteNonAdmission(error: unknown): error is RemoteError {
  if (!(error instanceof RemoteError)) return false
  return new Set([
    'remote-access/denied',
    'gateway/bad-request',
    'gateway/service-unavailable',
    'session/agent-busy',
    'session/attachment-invalid',
    'session/migration-required',
    'session/model-unavailable',
    'session/not-found',
    'session/writer-held',
  ]).has(error.code)
}

/** Map a known rejection to a safe, stable UI diagnostic. */
function dispatchDiagnostic(error: RemoteError): ActivityCoordinationDispatchResult['diagnostic'] {
  if (error.code === 'remote-access/denied') return 'access-denied'
  if (error.code === 'session/agent-busy' || error.code === 'session/writer-held') return 'target-busy'
  if (error.code === 'session/not-found' || error.code === 'session/migration-required' || error.code === 'gateway/service-unavailable') {
    return 'target-unavailable'
  }
  return 'delivery-uncertain'
}

/** Construct one bounded target prompt from the exact proposal the user confirmed. */
function assignmentPrompt(activity: Activity, proposal: ActivityResponsibilityProposal): string {
  return [
    `Activity: ${activity.name}`,
    `Objective: ${activity.objective}`,
    `Task: ${proposal.task}`,
    `Scope: ${proposal.inScope.join('; ')}`,
    `Out of scope: ${proposal.outOfScope.join('; ')}`,
    `Prerequisites: ${proposal.prerequisites.length === 0 ? 'None recorded.' : proposal.prerequisites.join('; ')}`,
    `Conflicting work to account for: ${proposal.conflictingWork.length === 0 ? 'None recorded.' : proposal.conflictingWork.join('; ')}`,
    `Expected outcome: ${proposal.expectedOutcome}`,
    'Use this Session’s existing runtime, permissions, and repository context. Do not expand the task or change permissions. Do not commit, merge, deploy, publish, or release unless that exact action is separately authorized in this Session. Report what you did and what remains uncertain; do not label work independently verified or accepted.',
  ].join('\n')
}

/** Validate bounded, distinct target pairs before the Gateway resolves resource grants. */
function selectionInvalid(message: string): RemoteError<'activity-coordination/selection-invalid'> {
  return new RemoteError('activity-coordination/selection-invalid', message, {})
}

function validateSelection(targets: readonly ActivityCoordinationTarget[]): void {
  if (targets.length === 0 || targets.length > MAX_DISCOVERY_TARGETS) {
    throw new RemoteError('activity-coordination/selection-invalid', 'Select between one and sixteen Session contexts.', {})
  }
  const seen = new Set<SessionId>()
  for (const target of targets) {
    if (seen.has(target.sessionId)) {
      throw new RemoteError('activity-coordination/selection-invalid', 'A Session context may be selected only once.', {})
    }
    seen.add(target.sessionId)
  }
}

/** Extract only recent human/model text, leaving tool output and control events out of the coordinator context. */
function recentMessages(observation: SessionObservation): ActivityCoordinationMessage[] {
  const messages: ActivityCoordinationMessage[] = []
  for (const event of observation.events) {
    if (event.type === 'user/message' || event.type === 'assistant/message') {
      const message = event.type === 'user/message' ? event.data : event.data.message
      const source = message.source
      const text = message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
      if (text.trim().length === 0) continue
      const bounded = truncateUnicodeCodePoints(text, MAX_MESSAGE_CODE_POINTS)
      messages.push({
        role: event.type === 'user/message' ? 'user' : 'assistant',
        sourceKind: source.kind,
        eventSeq: event.seq,
        time: event.time,
        text: bounded.text,
        truncated: bounded.truncated,
        ...(source.kind === 'model' ? { provider: source.provider, model: source.model } : {}),
        ...source.kind === 'user' && 'rpcId' in source && source.rpcId !== undefined
          ? { requestId: source.rpcId }
          : {},
      })
    }
  }
  return messages.slice(-MAX_RECENT_MESSAGES)
}

/** Bound one message without splitting a Unicode code point. */
function truncateUnicodeCodePoints(value: string, maximum: number): { readonly text: string; readonly truncated: boolean } {
  let end = 0
  let count = 0
  for (const codePoint of value) {
    if (count === maximum) return { text: value.slice(0, end), truncated: true }
    count++
    end += codePoint.length
  }
  return { text: value, truncated: false }
}

/** Keep load state separate from execution and completion. */
function runtimeState(agent: Agent | undefined): ActivityCoordinationSessionSnapshot['runtime'] {
  if (agent === undefined) return 'not-loaded'
  return agent.status === 'running' ? 'running' : 'loaded'
}

/** Build one non-sensitive reference failure. */
function contextInvalid(
  activityId: ActivityId,
  reason: 'activity-unavailable' | 'not-associated' | 'workspace-unavailable'
    | 'session-not-in-workspace' | 'session-unavailable' | 'subagent-target' | 'repository-mismatch',
  target?: ActivityCoordinationTarget,
): RemoteError<'activity-coordination/context-invalid'> {
  return new RemoteError('activity-coordination/context-invalid', 'The selected Activity context is unavailable or no longer matches.', {
    activityId,
    ...(target === undefined ? {} : { workspaceId: target.workspaceId, sessionId: target.sessionId }),
    reason,
  })
}

export const name = 'home-activity-coordination'

export default ActivityCoordinationService
