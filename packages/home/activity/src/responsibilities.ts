/** Durable, append-only coordination facts for saved Home Activities. @module @deepseek-ai/dsh-home-activity/responsibilities */

import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { ActivityId } from './types.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  ActivityResponsibilityAcceptanceFact,
  ActivityResponsibilityActor,
  ActivityResponsibilityConfirmedFact,
  ActivityResponsibilityDispatchAttemptedFact,
  ActivityResponsibilityDispatchSettledFact,
  ActivityResponsibilityFact,
  ActivityResponsibilityFactId,
  ActivityResponsibilityHistory,
  ActivityResponsibilityId,
  ActivityResponsibilityObservedFact,
  ActivityResponsibilityPrincipal,
  ActivityResponsibilityProposal,
  ActivityResponsibilityProposedFact,
  ActivityResponsibilityReportedFact,
  ActivityResponsibilityRequestId,
  ActivityResponsibilityStatusReport,
  ActivityResponsibilityVerificationFact,
  BeginActivityResponsibilityDispatchRequest,
  ConfirmActivityResponsibilityRequest,
  CreateActivityResponsibilityRequest,
  RecordActivityResponsibilityAcceptanceRequest,
  RecordActivityResponsibilityObservationRequest,
  RecordActivityResponsibilityReportRequest,
  RecordActivityResponsibilityStatusReportRequest,
  RecordActivityResponsibilityVerificationRequest,
  SettleActivityResponsibilityDispatchRequest,
} from './responsibility-types.ts'
import {
  activityResponsibilityRequestIdSchema,
  activityResponsibilityFactSchema,
  beginActivityResponsibilityDispatchRequestSchema,
  confirmActivityResponsibilityRequestSchema,
  createActivityResponsibilityRequestSchema,
  homeActivityResponsibilitiesDomain,
  MAX_HOME_ACTIVITY_RESPONSIBILITY_FACTS_PER_ACTIVITY,
  recordActivityResponsibilityAcceptanceRequestSchema,
  recordActivityResponsibilityObservationRequestSchema,
  recordActivityResponsibilityReportRequestSchema,
  recordActivityResponsibilityVerificationRequestSchema,
  settleActivityResponsibilityDispatchRequestSchema,
} from './responsibility-spec.ts'
import {
  activityResponsibilityStatusReportSchema,
  homeActivityResponsibilityStatusReportsDomain,
  MAX_ACTIVITY_RESPONSIBILITY_STATUS_REPORTS,
  recordActivityResponsibilityStatusReportRequestSchema,
} from './responsibility-status-spec.ts'
import type {} from './index.ts'

export {
  activityResponsibilityRequestIdSchema,
  activityResponsibilityFactSchema,
  beginActivityResponsibilityDispatchRequestSchema,
  confirmActivityResponsibilityRequestSchema,
  createActivityResponsibilityRequestSchema,
  homeActivityResponsibilitiesDomain,
  MAX_HOME_ACTIVITY_RESPONSIBILITY_FACTS_PER_ACTIVITY,
  MAX_HOME_ACTIVITY_RESPONSIBILITY_SOURCE_EVENTS,
  recordActivityResponsibilityAcceptanceRequestSchema,
  recordActivityResponsibilityObservationRequestSchema,
  recordActivityResponsibilityReportRequestSchema,
  recordActivityResponsibilityVerificationRequestSchema,
  settleActivityResponsibilityDispatchRequestSchema,
} from './responsibility-spec.ts'
export {
  activityResponsibilityStatusReportSchema,
  homeActivityResponsibilityStatusReportsDomain,
  MAX_ACTIVITY_RESPONSIBILITY_STATUS_REPORTS,
  recordActivityResponsibilityStatusReportRequestSchema,
} from './responsibility-status-spec.ts'

/** Stable rejection categories for responsibility requests. */
export type ActivityResponsibilityErrorCode =
  | 'unknown-activity'
  | 'unknown-responsibility'
  | 'activity-mismatch'
  | 'invalid-request'
  | 'invalid-history'
  | 'request-id-reused'
  | 'already-confirmed'
  | 'proposal-mismatch'
  | 'dispatch-already-attempted'
  | 'dispatch-not-attempted'
  | 'report-unavailable'
  | 'status-report-unavailable'
  | 'status-report-limit'
  | 'fact-limit'

/** Expected Activity, ownership, lifecycle, or idempotency rejection. */
export class ActivityResponsibilityError extends Error {
  /** @param code - Stable rejection category. @param message - User-readable explanation. */
  constructor(readonly code: ActivityResponsibilityErrorCode, message: string) {
    super(message)
    this.name = 'ActivityResponsibilityError'
  }
}

/** Storage could not confirm a durable responsibility fact. */
export class ActivityResponsibilityStorageError extends Error {
  /** @param cause - Underlying domain read or write failure. */
  constructor(cause: unknown) {
    super('Home Activity responsibility storage failed; inspect saved history before retrying.', { cause })
    this.name = 'ActivityResponsibilityStorageError'
  }
}

/** Immutable Activity responsibility facts mounted as `ctx.homeActivityResponsibilities`. */
export class HomeActivityResponsibilityService extends Service {
  static inject = ['storageDomain', 'homeActivities']

  private table?: KvTable<ActivityResponsibilityFactId, ActivityResponsibilityFact>
  private statusReportsTable?: KvTable<string, ActivityResponsibilityStatusReport>
  private operationTail: Promise<void> = Promise.resolve()

  constructor(ctx: Context) {
    super(ctx, 'homeActivityResponsibilities')
  }

  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(homeActivityResponsibilitiesDomain)
    this.ctx.effect(() => () => domain.close(), 'homeActivityResponsibilities.domainClose')
    this.table = domain.table('facts')
    const statusReports = await this.ctx.storageDomain.open(homeActivityResponsibilityStatusReportsDomain)
    this.ctx.effect(() => () => statusReports.close(), 'homeActivityResponsibilities.statusReportsDomainClose')
    this.statusReportsTable = statusReports.table('reports')
  }

  /** Save an immutable recommendation without authorizing or dispatching it.
   * @param request - Activity, coordinator source, selected target, and exact bounded task.
   * @returns The saved proposal and its stable responsibility identity.
   * @throws {ActivityResponsibilityError} when the Activity or request is invalid, or the idempotency key conflicts.
   * @throws {ActivityResponsibilityStorageError} when persistence cannot be confirmed.
   */
  createProposal(request: CreateActivityResponsibilityRequest): Promise<ActivityResponsibilityProposedFact> {
    return this.enqueue(async () => {
      const parsed = createActivityResponsibilityRequestSchema.safeParse(request)
      if (!parsed.success) throw invalidRequest(parsed.error.issues.map(issue => issue.message).join('; '))
      this.requireActivity(parsed.data.activityId)
      const proposal: ActivityResponsibilityProposal = freezeProposal({
        target: parsed.data.target,
        task: parsed.data.task,
        inScope: parsed.data.inScope,
        outOfScope: parsed.data.outOfScope,
        expectedOutcome: parsed.data.expectedOutcome,
        prerequisites: parsed.data.prerequisites,
        conflictingWork: parsed.data.conflictingWork,
      })
      const duplicate = this.findProposal(parsed.data.activityId, parsed.data.requestId)
      if (duplicate !== undefined) {
        if (!isDeepStrictEqual(proposal, duplicate.proposal)
          || duplicate.source.sessionId !== parsed.data.coordinatingSessionId
          || duplicate.source.eventSeq !== parsed.data.sourceEventSeq) {
          throw requestIdReused()
        }
        return duplicate
      }
      this.requireFactCapacity(parsed.data.activityId)
      const responsibilityId = brandString<ActivityResponsibilityId>(randomUUID())
      const fact = parseFact({
        id: brandString<ActivityResponsibilityFactId>(randomUUID()),
        responsibilityId,
        activityId: parsed.data.activityId,
        revision: 1,
        requestId: parsed.data.requestId,
        recordedAt: new Date().toISOString(),
        kind: 'proposed',
        proposal,
        source: {
          kind: 'coordinating-session',
          sessionId: parsed.data.coordinatingSessionId,
          ...(parsed.data.sourceEventSeq === undefined ? {} : { eventSeq: parsed.data.sourceEventSeq }),
        },
      })
      await this.putFact(fact)
      return fact as ActivityResponsibilityProposedFact
    })
  }

  /** Record a Client-authenticated confirmation of the complete immutable proposal.
   * @param request - Exact proposal echo, idempotency key, and principal read by the trusted Client route.
   * @returns The confirmed fact; this record does not itself dispatch work.
   * @throws {ActivityResponsibilityError} when the proposal is unavailable, differs, or was confirmed already.
   * @throws {ActivityResponsibilityStorageError} when persistence cannot be confirmed.
   */
  confirm(request: ConfirmActivityResponsibilityRequest): Promise<ActivityResponsibilityConfirmedFact> {
    return this.enqueue(async () => {
      const parsed = confirmActivityResponsibilityRequestSchema.safeParse(request)
      if (!parsed.success) throw invalidRequest(parsed.error.issues.map(issue => issue.message).join('; '))
      const history = this.requireHistory(parsed.data.activityId, parsed.data.responsibilityId)
      const proposal = history.proposal
      const principal = freezePrincipal(parsed.data.principal)
      const confirmation = Object.freeze({
        proposalFactId: parsed.data.proposalFactId,
        proposal: freezeProposal(parsed.data.proposal),
        actor: Object.freeze({ kind: 'authenticated-user' as const, principal }),
      })
      const duplicate = this.findDuplicate(history, 'confirmed', parsed.data.requestId, confirmation)
      if (duplicate !== undefined) return duplicate as ActivityResponsibilityConfirmedFact
      if (proposal.id !== parsed.data.proposalFactId || !isDeepStrictEqual(proposal.proposal, parsed.data.proposal)) {
        throw new ActivityResponsibilityError('proposal-mismatch', 'Confirmation must match the saved proposal exactly.')
      }
      if (history.facts.some(fact => fact.kind === 'confirmed')) {
        throw new ActivityResponsibilityError('already-confirmed', 'This responsibility already has a user confirmation.')
      }
      const fact = this.nextFact(history, parsed.data.requestId, 'confirmed', confirmation)
      await this.putFact(fact)
      return fact as ActivityResponsibilityConfirmedFact
    })
  }

  /** Persist dispatch intent before the authenticated Client prompts the target Session.
   * @param request - Activity responsibility and the exact Session prompt request id.
   * @returns The durable dispatch intent.
   * @throws {ActivityResponsibilityError} when confirmation is missing or an attempt already exists.
   * @throws {ActivityResponsibilityStorageError} when persistence cannot be confirmed.
   */
  beginDispatch(request: BeginActivityResponsibilityDispatchRequest): Promise<ActivityResponsibilityDispatchAttemptedFact> {
    return this.enqueue(async () => {
      const parsed = beginActivityResponsibilityDispatchRequestSchema.safeParse(request)
      if (!parsed.success) throw invalidRequest(parsed.error.issues.map(issue => issue.message).join('; '))
      this.requireActivity(parsed.data.activityId)
      const history = this.requireHistory(parsed.data.activityId, parsed.data.responsibilityId)
      const promptRequestId = parsed.data.promptRequestId
      const attemptPayload = {
        promptRequestId,
        targetSessionId: history.proposal.proposal.target.sessionId,
        source: 'session-controller.prompt' as const,
      }
      const duplicate = this.findDuplicate(history, 'dispatch-attempted', promptRequestId, attemptPayload)
      if (duplicate !== undefined) return duplicate as ActivityResponsibilityDispatchAttemptedFact
      if (!history.facts.some(fact => fact.kind === 'confirmed')) {
        throw new ActivityResponsibilityError('invalid-history', 'A user confirmation is required before dispatch.')
      }
      if (history.facts.some(fact => fact.kind === 'dispatch-attempted')) {
        throw new ActivityResponsibilityError('dispatch-already-attempted', 'This responsibility already has a dispatch attempt.')
      }
      const fact = this.nextFact(history, promptRequestId, 'dispatch-attempted', attemptPayload)
      await this.putFact(fact)
      return fact as ActivityResponsibilityDispatchAttemptedFact
    })
  }

  /** Append the prompt route's confirmed, rejected, or uncertain admission result.
   * @param request - Exact prompt request identity and route outcome.
   * @returns The persisted dispatch result, without claiming target execution.
   * @throws {ActivityResponsibilityError} when no matching attempt exists or its result conflicts.
   * @throws {ActivityResponsibilityStorageError} when persistence cannot be confirmed.
   */
  settleDispatch(request: SettleActivityResponsibilityDispatchRequest): Promise<ActivityResponsibilityDispatchSettledFact> {
    return this.enqueue(async () => {
      const parsed = settleActivityResponsibilityDispatchRequestSchema.safeParse(request)
      if (!parsed.success) throw invalidRequest(parsed.error.issues.map(issue => issue.message).join('; '))
      this.requireActivity(parsed.data.activityId)
      const history = this.requireHistory(parsed.data.activityId, parsed.data.responsibilityId)
      const promptRequestId = parsed.data.promptRequestId
      const payload = {
        promptRequestId,
        targetSessionId: history.proposal.proposal.target.sessionId,
        outcome: parsed.data.outcome,
        ...(parsed.data.diagnostic === undefined ? {} : { diagnostic: parsed.data.diagnostic }),
        source: 'session-controller.prompt' as const,
      }
      const duplicate = this.findDuplicate(history, 'dispatch-settled', promptRequestId, payload)
      if (duplicate !== undefined) return duplicate as ActivityResponsibilityDispatchSettledFact
      const attempt = history.facts.find(fact => fact.kind === 'dispatch-attempted' && fact.promptRequestId === promptRequestId)
      if (attempt === undefined) {
        throw new ActivityResponsibilityError('dispatch-not-attempted', 'No matching durable dispatch attempt exists.')
      }
      const fact = this.nextFact(history, promptRequestId, 'dispatch-settled', payload)
      await this.putFact(fact)
      return fact as ActivityResponsibilityDispatchSettledFact
    })
  }

  /** Record a passive target Session state observation without treating it as task completion.
   * @param request - Activity, responsibility, source time, and Session Controller state.
   * @returns The append-only observation fact.
   * @throws {ActivityResponsibilityError} when the Activity or responsibility is unavailable or the request conflicts.
   * @throws {ActivityResponsibilityStorageError} when persistence cannot be confirmed.
   */
  recordObservation(request: RecordActivityResponsibilityObservationRequest): Promise<ActivityResponsibilityObservedFact> {
    return this.enqueue(async () => {
      const parsed = recordActivityResponsibilityObservationRequestSchema.safeParse(request)
      if (!parsed.success) throw invalidRequest(parsed.error.issues.map(issue => issue.message).join('; '))
      const history = this.requireHistory(parsed.data.activityId, parsed.data.responsibilityId)
      const payload = {
        targetSessionId: history.proposal.proposal.target.sessionId,
        observedAt: parsed.data.observedAt,
        observation: parsed.data.observation,
        source: 'session-controller.state' as const,
      }
      const duplicate = this.findDuplicate(history, 'observed', parsed.data.requestId, payload)
      if (duplicate !== undefined) return duplicate as ActivityResponsibilityObservedFact
      const fact = this.nextFact(history, parsed.data.requestId, 'observed', payload)
      await this.putFact(fact)
      return fact as ActivityResponsibilityObservedFact
    })
  }

  /** Record a bounded target-authored summary linked to the target's original Session events.
   * @param request - Summary, target prompt identity, and non-empty source event sequences.
   * @returns The provider-reported fact; it is not independently verified or accepted.
   * @throws {ActivityResponsibilityError} when no matching dispatch or source Session exists.
   * @throws {ActivityResponsibilityStorageError} when persistence cannot be confirmed.
   */
  recordReport(request: RecordActivityResponsibilityReportRequest): Promise<ActivityResponsibilityReportedFact> {
    return this.enqueue(async () => {
      const parsed = recordActivityResponsibilityReportRequestSchema.safeParse(request)
      if (!parsed.success) throw invalidRequest(parsed.error.issues.map(issue => issue.message).join('; '))
      const history = this.requireHistory(parsed.data.activityId, parsed.data.responsibilityId)
      const targetSessionId = history.proposal.proposal.target.sessionId
      const dispatch = history.facts.find(fact => fact.kind === 'dispatch-attempted'
        && fact.promptRequestId === parsed.data.promptRequestId)
      const settled = history.facts.find((fact): fact is ActivityResponsibilityDispatchSettledFact =>
        fact.kind === 'dispatch-settled' && fact.promptRequestId === parsed.data.promptRequestId)
      if (dispatch === undefined || settled?.outcome === 'not-admitted') {
        throw new ActivityResponsibilityError('report-unavailable', 'A matching dispatched prompt is required before recording a target report.')
      }
      const payload = {
        targetSessionId,
        promptRequestId: parsed.data.promptRequestId,
        sourceEventSeqs: parsed.data.sourceEventSeqs,
        summary: parsed.data.summary,
        reportedAt: parsed.data.reportedAt,
        source: 'target-session-assistant-message' as const,
      }
      const duplicate = this.findDuplicate(history, 'reported', parsed.data.requestId, payload)
      if (duplicate !== undefined) return duplicate as ActivityResponsibilityReportedFact
      const fact = this.nextFact(history, parsed.data.requestId, 'reported', payload)
      await this.putFact(fact)
      return fact as ActivityResponsibilityReportedFact
    })
  }

  /** Append a status report from the exact target Session of a confirmed responsibility.
   * @param request - Activity, responsibility, trusted caller Session and logged tool-call sequence.
   * @returns The idempotent target-authored report; it does not mark work complete or verified.
   * @throws {ActivityResponsibilityError} when the caller, dispatch, or report identity is unavailable.
   * @throws {ActivityResponsibilityStorageError} when persistence cannot be confirmed.
   */
  recordTargetStatusReport(request: RecordActivityResponsibilityStatusReportRequest): Promise<ActivityResponsibilityStatusReport> {
    return this.enqueue(async () => {
      const parsed = recordActivityResponsibilityStatusReportRequestSchema.safeParse(request)
      if (!parsed.success) throw invalidRequest(parsed.error.issues.map(issue => issue.message).join('; '))
      const history = this.requireHistory(parsed.data.activityId, parsed.data.responsibilityId)
      const targetSessionId = history.proposal.proposal.target.sessionId
      const attempt = history.facts.find((fact): fact is ActivityResponsibilityDispatchAttemptedFact =>
        fact.kind === 'dispatch-attempted')
      const settled = history.facts.find((fact): fact is ActivityResponsibilityDispatchSettledFact =>
        fact.kind === 'dispatch-settled' && fact.promptRequestId === attempt?.promptRequestId)
      if (parsed.data.callerSessionId !== targetSessionId || attempt === undefined || settled?.outcome === 'not-admitted'
        || history.facts.some(fact => fact.kind === 'reported' && fact.promptRequestId === attempt.promptRequestId)) {
        throw new ActivityResponsibilityError(
          'status-report-unavailable',
          'A target Session may report progress only for its own admitted or unresolved assignment before a final report is recorded.',
        )
      }
      const key = statusReportSourceKey(parsed.data.callerSessionId, parsed.data.sourceEventSeq)
      const table = this.requireStatusReportsTable()
      let prior: ActivityResponsibilityStatusReport | undefined
      let activityCount = 0
      let responsibilityCount = 0
      try {
        for (const [existingKey, report] of table.entries()) {
          if (report.activityId === parsed.data.activityId) activityCount++
          if (report.responsibilityId === parsed.data.responsibilityId) responsibilityCount++
          if (existingKey === key) prior = report
        }
      } catch (cause: unknown) {
        throw new ActivityResponsibilityStorageError(cause)
      }
      const requested = {
        activityId: parsed.data.activityId,
        responsibilityId: parsed.data.responsibilityId,
        targetSessionId,
        promptRequestId: attempt.promptRequestId,
        status: parsed.data.status,
        summary: parsed.data.summary,
        sourceEventSeq: parsed.data.sourceEventSeq,
      }
      if (prior !== undefined) {
        const priorPayload = {
          activityId: prior.activityId,
          responsibilityId: prior.responsibilityId,
          targetSessionId: prior.targetSessionId,
          promptRequestId: prior.promptRequestId,
          status: prior.status,
          summary: prior.summary,
          sourceEventSeq: prior.sourceEventSeq,
        }
        if (!isDeepStrictEqual(priorPayload, requested)) throw requestIdReused()
        return freezeStatusReport(prior)
      }
      if (responsibilityCount >= MAX_ACTIVITY_RESPONSIBILITY_STATUS_REPORTS
        || activityCount >= MAX_HOME_ACTIVITY_RESPONSIBILITY_FACTS_PER_ACTIVITY) {
        throw new ActivityResponsibilityError('status-report-limit', 'The Activity responsibility progress report limit has been reached.')
      }
      const report = parseStatusReport({
        id: brandString<ActivityResponsibilityStatusReport['id']>(randomUUID()),
        ...requested,
        recordedAt: new Date().toISOString(),
        source: 'target-session-status-tool',
      })
      try {
        await table.put(key, report)
      } catch (cause: unknown) {
        throw new ActivityResponsibilityStorageError(cause)
      }
      return report
    })
  }

  /** Whether one Session has an unresolved or admitted responsibility that can accept a self-report.
   * @param targetSessionId - Session identity from a live ToolActivationContext Agent.
   * @returns True only when an existing responsibility is dispatched to this Session and has no final report.
   */
  hasReportableTargetSession(targetSessionId: SessionId): boolean {
    return this.ctx.homeActivities.list().some(activity => this.list(activity.id).some((history) => {
      const attempt = history.facts.find(fact => fact.kind === 'dispatch-attempted')
      const settlement = attempt === undefined ? undefined : history.facts.find(
        (fact): fact is ActivityResponsibilityDispatchSettledFact =>
          fact.kind === 'dispatch-settled' && fact.promptRequestId === attempt.promptRequestId,
      )
      const finalReport = attempt === undefined ? undefined : history.facts.find(fact =>
        fact.kind === 'reported' && fact.promptRequestId === attempt.promptRequestId)
      return history.proposal.proposal.target.sessionId === targetSessionId
        && attempt !== undefined
        && (settlement === undefined || settlement.outcome !== 'not-admitted')
        && finalReport === undefined
    }))
  }

  /** Read immutable status reports without contacting or resuming the target Session.
   * @param activityId - Owning Activity identity.
   * @param responsibilityId - Stable responsibility identity.
   * @returns Target-authored reports in Session event order.
   */
  listTargetStatusReports(
    activityId: ActivityId,
    responsibilityId: ActivityResponsibilityId,
  ): readonly ActivityResponsibilityStatusReport[] {
    const history = this.requireHistory(activityId, responsibilityId)
    const attempt = history.facts.find((fact): fact is ActivityResponsibilityDispatchAttemptedFact =>
      fact.kind === 'dispatch-attempted')
    if (attempt === undefined) return Object.freeze([])
    const targetSessionId = history.proposal.proposal.target.sessionId
    try {
      return Object.freeze([...this.requireStatusReportsTable().entries()]
        .filter(([key, report]) => key === statusReportSourceKey(report.targetSessionId, report.sourceEventSeq)
          && report.activityId === activityId
          && report.responsibilityId === responsibilityId
          && report.targetSessionId === targetSessionId
          && report.promptRequestId === attempt.promptRequestId)
        .map(([, report]) => report)
        .sort((left, right) => left.sourceEventSeq - right.sourceEventSeq)
        .map(freezeStatusReport))
    } catch (cause: unknown) {
      if (cause instanceof ActivityResponsibilityError || cause instanceof ActivityResponsibilityStorageError) throw cause
      throw new ActivityResponsibilityStorageError(cause)
    }
  }

  /** Record separately attributed evidence about one saved target report.
   * @param request - Report identity, recorder, and named verification evidence.
   * @returns The evidence fact; DSH does not independently inspect its source.
   * @throws {ActivityResponsibilityError} when the referenced report is unavailable or the request conflicts.
   * @throws {ActivityResponsibilityStorageError} when persistence cannot be confirmed.
   */
  recordVerification(request: RecordActivityResponsibilityVerificationRequest): Promise<ActivityResponsibilityVerificationFact> {
    return this.enqueue(async () => {
      const parsed = recordActivityResponsibilityVerificationRequestSchema.safeParse(request)
      if (!parsed.success) throw invalidRequest(parsed.error.issues.map(issue => issue.message).join('; '))
      const history = this.requireHistory(parsed.data.activityId, parsed.data.responsibilityId)
      this.requireReport(history, parsed.data.reportFactId)
      const actor = freezeActor(parsed.data.actor)
      const evidence = Object.freeze({ ...parsed.data.evidence })
      const payload = { reportFactId: parsed.data.reportFactId, actor, evidence }
      const duplicate = this.findDuplicate(history, 'verification-recorded', parsed.data.requestId, payload)
      if (duplicate !== undefined) return duplicate as ActivityResponsibilityVerificationFact
      const fact = this.nextFact(history, parsed.data.requestId, 'verification-recorded', payload)
      await this.putFact(fact)
      return fact as ActivityResponsibilityVerificationFact
    })
  }

  /** Record a user disposition of one saved report, separately from verification evidence.
   * @param request - Report identity, explicit user disposition, and authenticated principal.
   * @returns The append-only acceptance fact.
   * @throws {ActivityResponsibilityError} when the report is unavailable or the request conflicts.
   * @throws {ActivityResponsibilityStorageError} when persistence cannot be confirmed.
   */
  recordAcceptance(request: RecordActivityResponsibilityAcceptanceRequest): Promise<ActivityResponsibilityAcceptanceFact> {
    return this.enqueue(async () => {
      const parsed = recordActivityResponsibilityAcceptanceRequestSchema.safeParse(request)
      if (!parsed.success) throw invalidRequest(parsed.error.issues.map(issue => issue.message).join('; '))
      const history = this.requireHistory(parsed.data.activityId, parsed.data.responsibilityId)
      this.requireReport(history, parsed.data.reportFactId)
      const actor = Object.freeze({
        kind: 'authenticated-user' as const,
        principal: freezePrincipal(parsed.data.principal),
      })
      const acceptancePayload = {
        reportFactId: parsed.data.reportFactId,
        disposition: parsed.data.disposition,
        actor,
      }
      const duplicate = this.findDuplicateIgnoringSupersedes(
        history,
        parsed.data.requestId,
        acceptancePayload,
      )
      if (duplicate !== undefined) return duplicate as ActivityResponsibilityAcceptanceFact
      const priorAcceptance = history.facts.findLast(fact => fact.kind === 'acceptance-recorded')
      const payload = {
        ...acceptancePayload,
        ...(priorAcceptance === undefined ? {} : { supersedes: priorAcceptance.id }),
      }
      const fact = this.nextFact(history, parsed.data.requestId, 'acceptance-recorded', payload)
      await this.putFact(fact)
      return fact as ActivityResponsibilityAcceptanceFact
    })
  }

  /** Read one complete responsibility history without contacting or resuming its target Session.
   * @param activityId - Owning Activity identity.
   * @param responsibilityId - Stable responsibility identity.
   * @returns Its facts oldest first, or `undefined` when the identity is not in this Activity.
   * @throws {ActivityResponsibilityError} when the Activity or history is invalid.
   * @throws {ActivityResponsibilityStorageError} when stored facts cannot be read.
   */
  get(activityId: ActivityId, responsibilityId: ActivityResponsibilityId): ActivityResponsibilityHistory | undefined {
    this.requireActivity(activityId)
    try {
      const facts = this.factsFor(activityId, responsibilityId)
      return facts.length === 0 ? undefined : toHistory(facts)
    } catch (cause: unknown) {
      if (cause instanceof ActivityResponsibilityError) throw cause
      throw new ActivityResponsibilityStorageError(cause)
    }
  }

  /** List saved responsibilities for one Activity without contacting their target Sessions.
   * @param activityId - Stable Activity identity.
   * @returns Immutable histories, newest proposal first and facts oldest first.
   * @throws {ActivityResponsibilityError} when the Activity or a stored history is invalid.
   * @throws {ActivityResponsibilityStorageError} when responsibility storage cannot be read.
   */
  list(activityId: ActivityId): readonly ActivityResponsibilityHistory[] {
    this.requireActivity(activityId)
    try {
      const groups = new Map<ActivityResponsibilityId, ActivityResponsibilityFact[]>()
      for (const [, fact] of this.requireTable().entries()) {
        if (fact.activityId !== activityId) continue
        const group = groups.get(fact.responsibilityId) ?? []
        group.push(fact)
        groups.set(fact.responsibilityId, group)
      }
      return Object.freeze([...groups.values()]
        .map(facts => toHistory(facts))
        .sort((left, right) => right.proposal.recordedAt.localeCompare(left.proposal.recordedAt)
          || String(left.id).localeCompare(String(right.id))))
    } catch (cause: unknown) {
      if (cause instanceof ActivityResponsibilityError) throw cause
      throw new ActivityResponsibilityStorageError(cause)
    }
  }

  private requireActivity(activityId: ActivityId): void {
    if (this.ctx.homeActivities.get(activityId) === undefined) {
      throw new ActivityResponsibilityError('unknown-activity', `No saved Activity has id ${activityId}.`)
    }
  }

  private requireHistory(activityId: ActivityId, responsibilityId: ActivityResponsibilityId): ActivityResponsibilityHistory {
    this.requireActivity(activityId)
    let facts: ActivityResponsibilityFact[]
    try {
      facts = this.factsFor(activityId, responsibilityId)
    } catch (cause: unknown) {
      if (cause instanceof ActivityResponsibilityError || cause instanceof ActivityResponsibilityStorageError) throw cause
      throw new ActivityResponsibilityStorageError(cause)
    }
    if (facts.length === 0) throw new ActivityResponsibilityError('unknown-responsibility', `No responsibility has id ${responsibilityId}.`)
    return toHistory(facts)
  }

  private factsFor(activityId: ActivityId, responsibilityId: ActivityResponsibilityId): ActivityResponsibilityFact[] {
    const facts = [...this.requireTable().entries()]
      .map(([, fact]) => fact)
      .filter(fact => fact.responsibilityId === responsibilityId)
    if (facts.some(fact => fact.activityId !== activityId)) {
      throw new ActivityResponsibilityError('activity-mismatch', 'The responsibility belongs to a different Activity.')
    }
    return facts.sort((left, right) => left.revision - right.revision)
  }

  private findProposal(activityId: ActivityId, requestId: ActivityResponsibilityRequestId): ActivityResponsibilityProposedFact | undefined {
    try {
      return [...this.requireTable().entries()]
        .map(([, fact]) => fact)
        .find((fact): fact is ActivityResponsibilityProposedFact => fact.activityId === activityId
          && fact.kind === 'proposed' && fact.requestId === requestId)
    } catch (cause: unknown) {
      throw new ActivityResponsibilityStorageError(cause)
    }
  }

  private findDuplicate<K extends IdempotentFact['kind']>(
    history: ActivityResponsibilityHistory,
    kind: K,
    requestId: ActivityResponsibilityRequestId,
    payload: Record<string, unknown>,
  ): Extract<ActivityResponsibilityFact, { kind: K }> | undefined {
    const existing = history.facts.find((fact): fact is Extract<ActivityResponsibilityFact, { kind: K }> =>
      fact.kind === kind && fact.requestId === requestId)
    if (existing === undefined) return undefined
    if (!isDeepStrictEqual(payloadOf(existing), payload)) throw requestIdReused()
    return existing
  }

  private findDuplicateIgnoringSupersedes(
    history: ActivityResponsibilityHistory,
    requestId: ActivityResponsibilityRequestId,
    payload: Pick<ActivityResponsibilityAcceptanceFact, 'reportFactId' | 'disposition' | 'actor'>,
  ): ActivityResponsibilityAcceptanceFact | undefined {
    const existing = history.facts.find((fact): fact is ActivityResponsibilityAcceptanceFact =>
      fact.kind === 'acceptance-recorded' && fact.requestId === requestId)
    if (existing === undefined) return undefined
    const existingPayload = {
      reportFactId: existing.reportFactId,
      disposition: existing.disposition,
      actor: existing.actor,
    }
    if (!isDeepStrictEqual(existingPayload, payload)) throw requestIdReused()
    return existing
  }

  private nextFact<K extends Exclude<ActivityResponsibilityFact['kind'], 'proposed'>>(
    history: ActivityResponsibilityHistory,
    requestId: ActivityResponsibilityRequestId,
    kind: K,
    payload: Omit<Extract<ActivityResponsibilityFact, { kind: K }>, keyof FactBase | 'kind'>,
  ): Extract<ActivityResponsibilityFact, { kind: K }> {
    const last = history.facts.at(-1)
    /* v8 ignore next -- toHistory rejects histories without their revision-one proposal before nextFact can run. */
    if (last === undefined) throw new ActivityResponsibilityError('invalid-history', 'Responsibility history has no proposal.')
    this.requireFactCapacity(history.activityId)
    return parseFact({
      id: brandString<ActivityResponsibilityFactId>(randomUUID()),
      responsibilityId: history.id,
      activityId: history.activityId,
      revision: last.revision + 1,
      previousFactId: last.id,
      requestId,
      recordedAt: new Date().toISOString(),
      kind,
      ...payload,
    }) as Extract<ActivityResponsibilityFact, { kind: K }>
  }

  private requireFactCapacity(activityId: ActivityId): void {
    let count: number
    try {
      count = [...this.requireTable().entries()].filter(([, fact]) => fact.activityId === activityId).length
    } catch (cause: unknown) {
      throw new ActivityResponsibilityStorageError(cause)
    }
    if (count >= MAX_HOME_ACTIVITY_RESPONSIBILITY_FACTS_PER_ACTIVITY) {
      throw new ActivityResponsibilityError('fact-limit', 'The Activity has reached its responsibility fact limit.')
    }
  }

  private requireReport(
    history: ActivityResponsibilityHistory,
    reportFactId: ActivityResponsibilityFactId,
  ): ActivityResponsibilityReportedFact {
    const report = history.facts.find((fact): fact is ActivityResponsibilityReportedFact =>
      fact.kind === 'reported' && fact.id === reportFactId)
    if (report === undefined) throw new ActivityResponsibilityError('report-unavailable', 'A saved target report is required.')
    return report
  }

  private async putFact(fact: ActivityResponsibilityFact): Promise<void> {
    try {
      await this.requireTable().put(fact.id, fact)
    } catch (cause: unknown) {
      throw new ActivityResponsibilityStorageError(cause)
    }
  }

  private requireTable(): KvTable<ActivityResponsibilityFactId, ActivityResponsibilityFact> {
    if (this.table === undefined) throw new Error('Home Activity responsibility storage is not ready')
    return this.table
  }

  private requireStatusReportsTable(): KvTable<string, ActivityResponsibilityStatusReport> {
    if (this.statusReportsTable === undefined) throw new Error('Home Activity responsibility status report storage is not ready')
    return this.statusReportsTable
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(() => {}, () => {})
    return result
  }
}

type FactBase = Pick<ActivityResponsibilityFact, 'id' | 'responsibilityId' | 'activityId' | 'revision' | 'previousFactId' | 'requestId' | 'recordedAt'>
type IdempotentFact = Exclude<ActivityResponsibilityFact, { kind: 'proposed' | 'acceptance-recorded' }>

function parseFact(value: unknown): ActivityResponsibilityFact {
  const parsed = activityResponsibilityFactSchema.safeParse(value)
  if (!parsed.success) throw invalidRequest(parsed.error.issues.map(issue => issue.message).join('; '))
  return freezeFact(parsed.data)
}

function parseStatusReport(value: unknown): ActivityResponsibilityStatusReport {
  const parsed = activityResponsibilityStatusReportSchema.safeParse(value)
  if (!parsed.success) throw invalidRequest(parsed.error.issues.map(issue => issue.message).join('; '))
  return freezeStatusReport(parsed.data)
}

function freezeStatusReport(report: ActivityResponsibilityStatusReport): ActivityResponsibilityStatusReport {
  return Object.freeze({ ...report })
}

function statusReportSourceKey(sessionId: string, sourceEventSeq: number): string {
  return `${sessionId.length}:${sessionId}:${sourceEventSeq}`
}

function payloadOf(fact: IdempotentFact): Record<string, unknown> {
  switch (fact.kind) {
    case 'confirmed': return { proposalFactId: fact.proposalFactId, proposal: fact.proposal, actor: fact.actor }
    case 'dispatch-attempted': return { promptRequestId: fact.promptRequestId, targetSessionId: fact.targetSessionId, source: fact.source }
    case 'dispatch-settled': return {
      promptRequestId: fact.promptRequestId,
      targetSessionId: fact.targetSessionId,
      outcome: fact.outcome,
      ...(fact.diagnostic === undefined ? {} : { diagnostic: fact.diagnostic }),
      source: fact.source,
    }
    case 'observed': return {
      targetSessionId: fact.targetSessionId,
      observedAt: fact.observedAt,
      observation: fact.observation,
      source: fact.source,
    }
    case 'reported': return {
      targetSessionId: fact.targetSessionId,
      promptRequestId: fact.promptRequestId,
      sourceEventSeqs: fact.sourceEventSeqs,
      summary: fact.summary,
      reportedAt: fact.reportedAt,
      source: fact.source,
    }
    case 'verification-recorded': return { reportFactId: fact.reportFactId, actor: fact.actor, evidence: fact.evidence }
    /* v8 ignore next -- findDuplicate calls payloadOf only after matching a member of the closed, schema-validated kind union. */
    default: return assertNever(fact)
  }
}

function toHistory(values: readonly ActivityResponsibilityFact[]): ActivityResponsibilityHistory {
  const facts = [...values].sort((left, right) => left.revision - right.revision)
  const proposal = facts[0]
  if (proposal === undefined || proposal.kind !== 'proposed') {
    throw new ActivityResponsibilityError('invalid-history', 'Responsibility history must start with a proposal.')
  }
  for (let index = 0; index < facts.length; index += 1) {
    const current = facts[index]
    if (current === undefined || current.responsibilityId !== proposal.responsibilityId
      || current.activityId !== proposal.activityId || current.revision !== index + 1) {
      throw new ActivityResponsibilityError('invalid-history', 'Responsibility fact identities or revisions do not form one history.')
    }
    const predecessor = facts[index - 1]
    if ((index === 0 && current.previousFactId !== undefined)
      || (index > 0 && (predecessor === undefined || current.previousFactId !== predecessor.id))) {
      throw new ActivityResponsibilityError('invalid-history', 'Responsibility fact predecessor references are inconsistent.')
    }
  }
  return Object.freeze({
    id: proposal.responsibilityId,
    activityId: proposal.activityId,
    proposal: proposal as ActivityResponsibilityProposedFact,
    facts: Object.freeze(facts.map(freezeFact)),
  })
}

function freezeFact(fact: ActivityResponsibilityFact): ActivityResponsibilityFact {
  switch (fact.kind) {
    case 'proposed': return Object.freeze({ ...fact, proposal: freezeProposal(fact.proposal), source: Object.freeze({ ...fact.source }) })
    case 'confirmed': return Object.freeze({
      ...fact,
      proposal: freezeProposal(fact.proposal),
      actor: Object.freeze({ kind: 'authenticated-user' as const, principal: freezePrincipal(fact.actor.principal) }),
    })
    case 'dispatch-attempted':
    case 'dispatch-settled': return Object.freeze({ ...fact })
    case 'observed': return Object.freeze({
      ...fact,
      observation: Object.freeze(fact.observation.status === 'available'
        ? { ...fact.observation, pendingInput: Object.freeze([...fact.observation.pendingInput]) }
        : { ...fact.observation }),
    })
    case 'reported': return Object.freeze({ ...fact, sourceEventSeqs: Object.freeze([...fact.sourceEventSeqs]) })
    case 'verification-recorded': return Object.freeze({
      ...fact,
      actor: freezeActor(fact.actor),
      evidence: Object.freeze({ ...fact.evidence }),
    })
    case 'acceptance-recorded': return Object.freeze({
      ...fact,
      actor: Object.freeze({ kind: 'authenticated-user' as const, principal: freezePrincipal(fact.actor.principal) }),
    })
    /* v8 ignore next -- StorageDomain rejects unknown persisted fact tags before this closed-union copy switch. */
    default: return assertNever(fact)
  }
}

function freezeProposal(proposal: ActivityResponsibilityProposal): ActivityResponsibilityProposal {
  return Object.freeze({
    target: Object.freeze({ ...proposal.target }),
    task: proposal.task,
    inScope: Object.freeze([...proposal.inScope]),
    outOfScope: Object.freeze([...proposal.outOfScope]),
    expectedOutcome: proposal.expectedOutcome,
    prerequisites: Object.freeze([...proposal.prerequisites]),
    conflictingWork: Object.freeze([...proposal.conflictingWork]),
  })
}

function freezeActor(actor: ActivityResponsibilityActor): ActivityResponsibilityActor {
  return actor.kind === 'authenticated-user'
    ? Object.freeze({ kind: 'authenticated-user', principal: freezePrincipal(actor.principal) })
    : Object.freeze({ ...actor })
}

/** Freeze the local owner identity used for a durable user decision. */
function freezePrincipal(principal: ActivityResponsibilityPrincipal): ActivityResponsibilityPrincipal {
  return Object.freeze({ ...principal })
}

function invalidRequest(message: string): ActivityResponsibilityError {
  return new ActivityResponsibilityError('invalid-request', `Activity responsibility fact is invalid: ${message}`)
}

function requestIdReused(): ActivityResponsibilityError {
  return new ActivityResponsibilityError('request-id-reused', 'This request id was already used for different responsibility facts.')
}

/* v8 ignore next 3 -- This exhaustive-union backstop is reachable only if TypeScript or input validation fails. */
function assertNever(value: never): never {
  throw new Error(`Unknown Activity responsibility fact: ${JSON.stringify(value)}`)
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Durable Activity responsibility history and target-authored progress reports. */
    homeActivityResponsibilities: HomeActivityResponsibilityService
  }
}

/** Validate and brand one responsibility request UUID.
 * @param value - External request identifier to validate.
 * @returns Its responsibility request identity.
 * @throws {Error} when the input is not a UUID.
 */
export function activityResponsibilityRequestId(value: string): ActivityResponsibilityRequestId {
  return activityResponsibilityRequestIdSchema.parse(value)
}

/** Plugin identifier for the optional Activity responsibility domain. */
export const name = 'home-activity-responsibilities'
export default HomeActivityResponsibilityService
