/** Durable user dispositions and user-supplied evidence for Activity delegations. @module @deepseek-ai/dsh-home-activity/reviews */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { ActivityDelegation, ActivityDelegationId } from './delegation-types.ts'
import type { ActivityId } from './types.ts'
import type { ActivityReview, ActivityReviewEvidence, RecordActivityReviewRequest } from './review-types.ts'
import { homeActivityReviewsDomain, MAX_HOME_ACTIVITY_REVIEW_EVIDENCE } from './review-spec.ts'
import type {} from './delegations.ts'

export type {
  ActivityReview,
  ActivityReviewDisposition,
  ActivityReviewEvidence,
  ActivityReviewEvidenceId,
  ActivityReviewEvidenceResult,
  RecordActivityReviewRequest,
} from './review-types.ts'
export { activityReviewRecordSchema, homeActivityReviewsDomain, MAX_HOME_ACTIVITY_REVIEW_EVIDENCE } from './review-spec.ts'

/** Stable rejection categories for a review request. */
export type ActivityReviewErrorCode =
  | 'unknown-activity'
  | 'unknown-delegation'
  | 'delegation-activity-mismatch'
  | 'provider-report-unavailable'
  | 'evidence-limit'

/** Expected ownership or review validation rejection. */
export class ActivityReviewError extends Error {
  /** @param code - Stable rejection category. @param message - User-readable reason. */
  constructor(readonly code: ActivityReviewErrorCode, message: string) {
    super(message)
    this.name = 'ActivityReviewError'
  }
}

/** Review-domain reads or writes failed; no requested review state was confirmed. */
export class ActivityReviewStorageError extends Error {
  /** @param cause - Underlying domain read or write failure. */
  constructor(cause: unknown) {
    super('Home Activity review storage failed.', { cause })
    this.name = 'ActivityReviewStorageError'
  }
}

/** User dispositions and verification evidence stored independently from delegation reports. */
export class HomeActivityReviewService extends Service {
  static inject = ['storageDomain', 'homeActivities', 'homeActivityDelegations']

  private table?: KvTable<ActivityDelegationId, ActivityReview>
  private operationTail: Promise<void> = Promise.resolve()

  constructor(ctx: Context) {
    super(ctx, 'homeActivityReviews')
  }

  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(homeActivityReviewsDomain)
    this.ctx.effect(() => () => domain.close(), 'homeActivityReviews.domainClose')
    this.table = domain.table('reviews')
  }

  /**
   * Record a user disposition and optionally append one user-supplied evidence entry.
   * @param request - Activity, owned delegation, disposition, and optional evidence.
   * @returns The durable review, without changing the delegation report.
   * @throws {ActivityReviewError} when an identity is invalid, no report is saved, or the evidence limit is reached.
   * @throws {ActivityReviewStorageError} when review persistence fails.
   */
  record(request: RecordActivityReviewRequest): Promise<ActivityReview> {
    return this.enqueue(async () => {
      const delegation = this.requireOwnedDelegation(request.activityId, request.delegationId)
      if (delegation.status !== 'reported' || delegation.report === undefined) {
        throw new ActivityReviewError('provider-report-unavailable', 'A provider report is required before recording a review.')
      }
      const current = this.readRecord(request.delegationId)
      if ((current?.evidence.length ?? 0) >= MAX_HOME_ACTIVITY_REVIEW_EVIDENCE && request.evidence !== undefined) {
        throw new ActivityReviewError(
          'evidence-limit',
          `A delegation review can retain at most ${MAX_HOME_ACTIVITY_REVIEW_EVIDENCE} evidence entries.`,
        )
      }
      const evidence: ActivityReviewEvidence | undefined = request.evidence === undefined
        ? undefined
        : {
          id: brandString<ActivityReviewEvidence['id']>(randomUUID()),
          ...request.evidence,
          recordedAt: new Date().toISOString(),
          origin: 'user-command',
        }
      const review: ActivityReview = {
        activityId: request.activityId,
        delegationId: request.delegationId,
        disposition: request.disposition,
        evidence: [...(current?.evidence ?? []), ...(evidence === undefined ? [] : [evidence])],
        updatedAt: new Date().toISOString(),
        source: 'user-command',
      }
      try {
        await this.requireTable().put(request.delegationId, review)
      } catch (cause: unknown) {
        throw new ActivityReviewStorageError(cause)
      }
      return freezeReview(review)
    })
  }

  /**
   * Read a review for one delegation, returning no row when its disposition is still pending.
   * @param activityId - Saved Activity that owns the delegation.
   * @param delegationId - Delegation identity selected for review.
   * @returns The saved review, or `undefined` when the user has not recorded one.
   * @throws {ActivityReviewError} when either identity is unavailable or mismatched.
   * @throws {ActivityReviewStorageError} when review storage cannot be read.
   */
  get(activityId: ActivityId, delegationId: ActivityDelegationId): ActivityReview | undefined {
    this.requireOwnedDelegation(activityId, delegationId)
    const review = this.readRecord(delegationId)
    return review === undefined ? undefined : freezeReview(review)
  }

  /**
   * List user reviews belonging to one saved Activity.
   * @param activityId - Stable Activity identity.
   * @returns Detached reviews, newest update first.
   * @throws {ActivityReviewError} when the Activity does not exist.
   * @throws {ActivityReviewStorageError} when review storage cannot be read.
   */
  list(activityId: ActivityId): readonly ActivityReview[] {
    this.requireActivity(activityId)
    try {
      return Object.freeze([...this.requireTable().entries()]
        .map(([, review]) => review)
        .filter(review => review.activityId === activityId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)
          || String(left.delegationId).localeCompare(String(right.delegationId)))
        .map(freezeReview))
    } catch (cause: unknown) {
      throw new ActivityReviewStorageError(cause)
    }
  }

  private requireActivity(activityId: ActivityId): void {
    if (this.ctx.homeActivities.get(activityId) === undefined) {
      throw new ActivityReviewError('unknown-activity', `No saved Activity has id ${activityId}.`)
    }
  }

  private requireOwnedDelegation(activityId: ActivityId, delegationId: ActivityDelegationId): ActivityDelegation {
    this.requireActivity(activityId)
    const delegation = this.ctx.homeActivityDelegations.get(delegationId)
    if (delegation === undefined) {
      throw new ActivityReviewError('unknown-delegation', `No saved delegation has id ${delegationId}.`)
    }
    if (delegation.activityId !== activityId) {
      throw new ActivityReviewError('delegation-activity-mismatch', 'The selected delegation belongs to a different Activity.')
    }
    return delegation
  }

  private readRecord(delegationId: ActivityDelegationId): ActivityReview | undefined {
    try {
      return this.requireTable().get(delegationId)
    } catch (cause: unknown) {
      throw new ActivityReviewStorageError(cause)
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(() => {}, () => {})
    return result
  }

  private requireTable(): KvTable<ActivityDelegationId, ActivityReview> {
    if (this.table === undefined) throw new Error('Home Activity review storage is not ready')
    return this.table
  }
}

function freezeReview(review: ActivityReview): ActivityReview {
  return Object.freeze({
    ...review,
    evidence: Object.freeze(review.evidence.map(entry => Object.freeze({ ...entry }))),
  })
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** User dispositions and user-supplied verification evidence for Activity delegations. */
    homeActivityReviews: HomeActivityReviewService
  }
}

/** Plugin identifier mounted by Activity command profiles. */
export const name = 'home-activity-reviews'
export default HomeActivityReviewService
