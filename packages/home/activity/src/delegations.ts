/** Durable DSH-native execution facts for saved Home Activities. @module @deepseek-ai/dsh-home-activity/delegations */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { ActivityDelegationAdmission, ActivityDelegationReport } from './delegation-types.ts'
import type {
  ActivityDelegation,
  ActivityDelegationId,
  ActivityDelegationUncertainty,
  CreateActivityDelegationRequest,
} from './delegation-types.ts'
import { activityDelegationRecordSchema, homeActivityDelegationDomain } from './delegation-spec.ts'

export type {
  ActivityDelegation,
  ActivityDelegationAdmission,
  ActivityDelegationFailure,
  ActivityDelegationId,
  ActivityDelegationReport,
  ActivityDelegationRequest,
  ActivityDelegationStatus,
  ActivityDelegationUncertainty,
  CreateActivityDelegationRequest,
} from './delegation-types.ts'
export { activityDelegationRecordSchema, homeActivityDelegationDomain } from './delegation-spec.ts'

/** Stable delegation service rejection categories. */
export type ActivityDelegationErrorCode = 'activity-not-found' | 'invalid-transition' | 'invalid-request'

/** Expected validation, ownership, or lifecycle rejection from the service. */
export class ActivityDelegationError extends Error {
  /** @param code - Stable rejection category. @param message - User-readable explanation. */
  constructor(readonly code: ActivityDelegationErrorCode, message: string) {
    super(message)
    this.name = 'ActivityDelegationError'
  }
}

/** Durable request, DSH admission, and provider-report records mounted as `ctx.homeActivityDelegations`. */
export class HomeActivityDelegationService extends Service {
  static inject = ['storageDomain', 'homeActivities']

  private table?: KvTable<ActivityDelegationId, ActivityDelegation>
  private readonly volatileUncertainty = new Map<ActivityDelegationId, ActivityDelegation>()

  constructor(ctx: Context) {
    super(ctx, 'homeActivityDelegations')
  }

  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(homeActivityDelegationDomain)
    this.ctx.effect(() => () => domain.close(), 'homeActivityDelegations.domainClose')
    this.table = domain.table('delegations')
    for (const [id, record] of this.table.entries()) {
      if (record.status !== 'requested' && record.status !== 'admitted') continue
      const reason = record.status === 'requested'
        ? 'restart-before-admission-recorded'
        : 'restart-before-report-recorded'
      await this.table.update(id, current => freezeDelegation({
        id: current.id,
        activityId: current.activityId,
        request: current.request,
        status: 'unconfirmed',
        ...(current.admission === undefined ? {} : { admission: current.admission }),
        uncertainty: { reason, observedAt: new Date().toISOString() },
      }))
    }
  }

  /** Persist a user request before starting any provider work.
   * @param request - Activity, task, provider, and owning Session.
   * @returns The saved request record.
  */
  async createRequest(request: CreateActivityDelegationRequest): Promise<ActivityDelegation> {
    if (this.ctx.homeActivities.get(request.activityId) === undefined) {
      throw new ActivityDelegationError('activity-not-found', `No saved Activity has id ${request.activityId}.`)
    }
    const parsed = activityDelegationRecordSchema.safeParse({
      id: brandString<ActivityDelegationId>(randomUUID()),
      activityId: request.activityId,
      request: {
        provider: request.provider,
        task: request.task,
        parentSessionId: request.parentSessionId,
        requestedChildSessionId: brandString<SessionId>(randomUUID()),
        requestedAt: new Date().toISOString(),
        source: 'user-command',
      },
      status: 'requested',
    })
    if (!parsed.success) {
      const details = parsed.error.issues.map(issue => issue.message).join('; ')
      throw new ActivityDelegationError('invalid-request', `Delegation request is invalid: ${details}`)
    }
    await this.requireTable().put(parsed.data.id, parsed.data)
    return freezeDelegation(parsed.data)
  }

  /** List this Activity's delegation facts newest first.
   * @param activityId - Owning Activity identity.
   * @returns Detached records sorted by request time.
  */
  list(activityId: ActivityDelegation['activityId']): readonly ActivityDelegation[] {
    const records = new Map([...this.requireTable().entries()]
      .filter(([, record]) => record.activityId === activityId))
    for (const [id, record] of this.volatileUncertainty) {
      if (record.activityId === activityId) records.set(id, record)
    }
    return Object.freeze([...records.values()]
      .map(freezeDelegation)
      .sort((left, right) => right.request.requestedAt.localeCompare(left.request.requestedAt)
        || String(left.id).localeCompare(String(right.id))))
  }

  /** Read one delegation by stable identity.
   * @param id - Stable delegation identity.
   * @returns Its latest saved or in-process uncertainty record, or `undefined`.
  */
  get(id: ActivityDelegationId): ActivityDelegation | undefined {
    const saved = this.requireTable().get(id)
    return this.volatileUncertainty.get(id) ?? (saved === undefined ? undefined : freezeDelegation(saved))
  }

  /** Record a startup rejection that occurred before DSH published an activation.
   * @param id - Saved request identity.
   * @param message - Safe user-facing startup explanation.
   * @returns The rejected request record.
  */
  async markNotAdmitted(id: ActivityDelegationId, message: string): Promise<ActivityDelegation> {
    return this.transition(id, (current) => {
      if (current.status !== 'requested') throw invalidTransition(current.status, 'not-admitted')
      return {
        id: current.id,
        activityId: current.activityId,
        request: current.request,
        status: 'not-admitted',
        failure: { message, source: 'subagents.startActivation' },
      }
    })
  }

  /** Persist the admission returned by `startActivation`.
   * @param id - Saved request identity.
   * @param admission - Child Session and activation references.
   * @returns The admitted record.
  */
  async recordAdmitted(id: ActivityDelegationId, admission: ActivityDelegationAdmission): Promise<ActivityDelegation> {
    const fallback = this.withUncertainty(id, admission, 'admission-write-failed')
    try {
      return await this.transition(id, (current) => {
        if (current.status !== 'requested') throw invalidTransition(current.status, 'admitted')
        return {
          id: current.id,
          activityId: current.activityId,
          request: current.request,
          status: 'admitted',
          admission,
        }
      })
    } catch (error: unknown) {
      if (!(error instanceof ActivityDelegationError)) this.volatileUncertainty.set(id, fallback)
      throw error
    }
  }

  /** Persist the managed activation's result separately from its admission.
   * @param id - Saved request identity.
   * @param admission - Accepted activation references.
   * @param report - Provider-reported result.
   * @returns The completed fact record.
  */
  async recordReported(
    id: ActivityDelegationId,
    admission: ActivityDelegationAdmission,
    report: ActivityDelegationReport,
  ): Promise<ActivityDelegation> {
    const fallback = this.withUncertainty(id, admission, 'report-write-failed')
    try {
      return await this.transition(id, (current) => {
        if (current.status !== 'requested' && current.status !== 'admitted' && current.status !== 'unconfirmed') {
          throw invalidTransition(current.status, 'reported')
        }
        return {
          id: current.id,
          activityId: current.activityId,
          request: current.request,
          status: 'reported',
          admission,
          report,
        }
      })
    } catch (error: unknown) {
      if (!(error instanceof ActivityDelegationError)) this.volatileUncertainty.set(id, fallback)
      throw error
    }
  }

  /** Record a result that the activation API could not return as a provider report.
   * @param id - Saved request identity.
   * @param admission - Accepted activation references.
   * @param reason - Why its result is unknown.
   * @returns The unconfirmed record.
  */
  async markUnconfirmed(
    id: ActivityDelegationId,
    admission: ActivityDelegationAdmission,
    reason: ActivityDelegationUncertainty['reason'],
  ): Promise<ActivityDelegation> {
    const uncertain = this.withUncertainty(id, admission, reason)
    try {
      return await this.transition(id, (current) => {
        if (current.status === 'reported' || current.status === 'not-admitted') {
          throw invalidTransition(current.status, 'unconfirmed')
        }
        return uncertain
      })
    } catch (error: unknown) {
      if (!(error instanceof ActivityDelegationError)) this.volatileUncertainty.set(id, uncertain)
      throw error
    }
  }

  private async transition(
    id: ActivityDelegationId,
    change: (current: ActivityDelegation) => ActivityDelegation,
  ): Promise<ActivityDelegation> {
    const next = await this.requireTable().update(id, current => freezeDelegation(change(current)))
    this.volatileUncertainty.delete(id)
    return freezeDelegation(next)
  }

  private withUncertainty(
    id: ActivityDelegationId,
    admission: ActivityDelegationAdmission,
    reason: ActivityDelegationUncertainty['reason'],
  ): ActivityDelegation {
    const current = this.volatileUncertainty.get(id) ?? this.requireTable().get(id)
    if (current === undefined) throw new ActivityDelegationError('invalid-transition', `No delegation has id ${id}.`)
    return freezeDelegation({
      id: current.id,
      activityId: current.activityId,
      request: current.request,
      status: 'unconfirmed',
      admission,
      uncertainty: { reason, observedAt: new Date().toISOString() },
    })
  }

  private requireTable(): KvTable<ActivityDelegationId, ActivityDelegation> {
    if (this.table === undefined) throw new Error('Home Activity delegation storage is not ready')
    return this.table
  }
}

/** Brand a UUID after its parser has validated the external string.
 * @param value - Validated UUID.
 * @returns The same string branded as a delegation identity.
 */
export function activityDelegationId(value: string): ActivityDelegationId {
  return brandString<ActivityDelegationId>(value)
}

/** Copy nested lifecycle records so callers cannot mutate domain-owned state. */
function freezeDelegation(record: ActivityDelegation): ActivityDelegation {
  return Object.freeze({
    ...record,
    request: Object.freeze({ ...record.request }),
    ...(record.admission === undefined ? {} : { admission: Object.freeze({ ...record.admission }) }),
    ...(record.report === undefined ? {} : {
      report: Object.freeze({ ...record.report, nonTextBlockTypes: Object.freeze([...record.report.nonTextBlockTypes]) }),
    }),
    ...(record.failure === undefined ? {} : { failure: Object.freeze({ ...record.failure }) }),
    ...(record.uncertainty === undefined ? {} : { uncertainty: Object.freeze({ ...record.uncertainty }) }),
  })
}

/** Describe a rejected lifecycle transition without exposing persistence internals. */
function invalidTransition(current: ActivityDelegation['status'], next: ActivityDelegation['status']): ActivityDelegationError {
  return new ActivityDelegationError('invalid-transition', `Cannot move delegation from ${current} to ${next}.`)
}

export const name = 'home-activity-delegations'

export default HomeActivityDelegationService
