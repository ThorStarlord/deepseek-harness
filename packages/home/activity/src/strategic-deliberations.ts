/** Durable, append-only reconsiderations of historical Activity Strategic Briefs.
 * @module @deepseek-ai/dsh-home-activity/strategic-deliberations
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { ActivityId } from './types.ts'
import {
  activityStrategicDeliberationRecordSchema,
  homeActivityStrategicDeliberationsDomain,
  MAX_HOME_ACTIVITY_STRATEGIC_DELIBERATIONS_PER_ACTIVITY,
  MAX_HOME_ACTIVITY_STRATEGIC_DELIBERATION_BYTES,
  recordActivityStrategicDeliberationRequestSchema,
} from './strategic-deliberation-spec.ts'
import type {
  ActivityStrategicDeliberation,
  ActivityStrategicDeliberationId,
  RecordActivityStrategicDeliberationRequest,
} from './strategic-deliberation-types.ts'
import type { ActivityStrategicEpisodeId } from './strategic-episode-types.ts'
import type {} from './index.ts'
import type {} from './strategic-episodes.ts'

export type {
  ActivityStrategicDeliberation,
  ActivityStrategicDeliberationId,
  ActivityStrategicEvidenceUse,
  ActivityStrategicNewUncertainty,
  ActivityStrategicUncertaintyReview,
  RecordActivityStrategicDeliberationRequest,
} from './strategic-deliberation-types.ts'
export {
  activityStrategicDeliberationConclusionSchema,
  activityStrategicDeliberationRecordSchema,
  homeActivityStrategicDeliberationsDomain,
  MAX_HOME_ACTIVITY_STRATEGIC_DELIBERATIONS_PER_ACTIVITY,
  MAX_HOME_ACTIVITY_STRATEGIC_DELIBERATION_BYTES,
  recordActivityStrategicDeliberationRequestSchema,
} from './strategic-deliberation-spec.ts'

/** Stable rejection categories for a deliberation request. */
export type ActivityStrategicDeliberationErrorCode =
  | 'unknown-activity'
  | 'unknown-source-episode'
  | 'invalid-deliberation'
  | 'deliberation-limit'

/** Expected Activity, source revision, validation, or capacity rejection. */
export class ActivityStrategicDeliberationError extends Error {
  /** @param code - Stable rejection category. @param message - User-readable reason. */
  constructor(readonly code: ActivityStrategicDeliberationErrorCode, message: string) {
    super(message)
    this.name = 'ActivityStrategicDeliberationError'
  }
}

/** Deliberation persistence failed; inspect the Activity history before retrying. */
export class ActivityStrategicDeliberationStorageError extends Error {
  /** @param cause - Underlying domain read or write failure. */
  constructor(cause: unknown) {
    super('Home Activity strategic deliberation storage failed.', { cause })
    this.name = 'ActivityStrategicDeliberationStorageError'
  }
}

/** Stores append-only agent deliberations separately from Activity briefs and owner decisions. */
export class HomeActivityStrategicDeliberationService extends Service {
  static inject = ['storageDomain', 'homeActivities', 'homeActivityStrategicEpisodes']

  private table?: KvTable<ActivityStrategicDeliberationId, ActivityStrategicDeliberation>
  private operationTail: Promise<void> = Promise.resolve()

  constructor(ctx: Context) {
    super(ctx, 'homeActivityStrategicDeliberations')
  }

  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(homeActivityStrategicDeliberationsDomain)
    this.ctx.effect(() => () => domain.close(), 'homeActivityStrategicDeliberations.domainClose')
    this.table = domain.table('deliberations')
  }

  /** Append an advisory conclusion against one exact saved brief revision.
   * @param request - Activity, source brief, Session, Skill, and conclusion data.
   * @returns The saved deliberation, or the prior record for a repeated request id.
   * @throws {ActivityStrategicDeliberationError} when identities, cited evidence, or conclusion data are invalid.
   * @throws {ActivityStrategicDeliberationStorageError} when storage cannot confirm a read or write.
   */
  record(request: RecordActivityStrategicDeliberationRequest): Promise<ActivityStrategicDeliberation> {
    return this.enqueue(async () => {
      if (this.ctx.homeActivities.get(request.activityId) === undefined) {
        throw new ActivityStrategicDeliberationError('unknown-activity', `No saved Activity has id ${request.activityId}.`)
      }
      const prior = this.list(request.activityId)
      const duplicate = prior.find(item => item.requestId === request.requestId)
      if (duplicate !== undefined) return duplicate

      const source = this.ctx.homeActivityStrategicEpisodes.list(request.activityId).find(episode =>
        episode.id === request.sourceEpisodeId && episode.revision === request.sourceEpisodeRevision)
      if (source === undefined) {
        throw new ActivityStrategicDeliberationError(
          'unknown-source-episode',
          `Activity ${request.activityId} has no saved strategic brief ${request.sourceEpisodeId} at revision ${request.sourceEpisodeRevision}.`,
        )
      }
      if (prior.length >= MAX_HOME_ACTIVITY_STRATEGIC_DELIBERATIONS_PER_ACTIVITY) {
        throw new ActivityStrategicDeliberationError(
          'deliberation-limit',
          `An Activity can have at most ${MAX_HOME_ACTIVITY_STRATEGIC_DELIBERATIONS_PER_ACTIVITY} strategic deliberations.`,
        )
      }
      const parsed = recordActivityStrategicDeliberationRequestSchema.safeParse(request)
      if (!parsed.success) {
        throw new ActivityStrategicDeliberationError(
          'invalid-deliberation',
          `Activity Strategic Deliberation is invalid: ${parsed.error.issues.map(issue => issue.message).join('; ')}`,
        )
      }
      const evidenceIds = new Set(source.evidence.map(item => item.id))
      const uncertaintyIds = new Set(source.uncertainties.map(item => item.id))
      if (parsed.data.evidenceUses.some(item => !evidenceIds.has(item.evidenceId))
        || parsed.data.uncertaintyReviews.some(item => !uncertaintyIds.has(item.uncertaintyId))
        || parsed.data.newUncertainties.some(item => item.evidenceIds.some(id => !evidenceIds.has(id)))) {
        throw new ActivityStrategicDeliberationError(
          'invalid-deliberation',
          'A deliberation may cite only evidence and uncertainty identifiers from its selected historical brief.',
        )
      }

      const current = prior.at(-1)
      const deliberation = activityStrategicDeliberationRecordSchema.safeParse({
        ...parsed.data,
        id: brandString<ActivityStrategicDeliberationId>(randomUUID()),
        activityId: request.activityId,
        revision: prior.length + 1,
        ...(current === undefined ? {} : { supersedes: current.id }),
        originSessionId: request.originSessionId,
        producer: 'dsh-active-agent',
        requestId: request.requestId,
        sourceEpisodeId: source.id as ActivityStrategicEpisodeId,
        sourceEpisodeRevision: source.revision,
        sourceEpisodeRecordedAt: source.recordedAt,
        sourceEpisodeSessionId: source.originSessionId,
        status: 'complete',
        recordedAt: new Date().toISOString(),
      })
      if (!deliberation.success) {
        throw new ActivityStrategicDeliberationError(
          'invalid-deliberation',
          `Activity Strategic Deliberation is invalid: ${deliberation.error.issues.map(issue => issue.message).join('; ')}`,
        )
      }
      if (Buffer.byteLength(JSON.stringify(deliberation.data), 'utf8') > MAX_HOME_ACTIVITY_STRATEGIC_DELIBERATION_BYTES) {
        throw new ActivityStrategicDeliberationError('invalid-deliberation', 'Activity Strategic Deliberation exceeds the 64 KiB storage limit.')
      }
      try {
        await this.requireTable().put(deliberation.data.id, deliberation.data)
      } catch (cause: unknown) {
        throw new ActivityStrategicDeliberationStorageError(cause)
      }
      return freezeDeliberation(deliberation.data)
    })
  }

  /** List advisory reconsiderations without inspecting repositories or starting execution.
   * @param activityId - Stable Activity identity.
   * @returns Detached records in append order.
   * @throws {ActivityStrategicDeliberationError} when the Activity does not exist.
   * @throws {ActivityStrategicDeliberationStorageError} when history cannot be read.
   */
  list(activityId: ActivityId): readonly ActivityStrategicDeliberation[] {
    if (this.ctx.homeActivities.get(activityId) === undefined) {
      throw new ActivityStrategicDeliberationError('unknown-activity', `No saved Activity has id ${activityId}.`)
    }
    try {
      return Object.freeze([...this.requireTable().entries()]
        .map(([, deliberation]) => deliberation)
        .filter(deliberation => deliberation.activityId === activityId)
        .sort((left, right) => left.revision - right.revision || String(left.id).localeCompare(String(right.id)))
        .map(freezeDeliberation))
    } catch (cause: unknown) {
      if (cause instanceof ActivityStrategicDeliberationError) throw cause
      throw new ActivityStrategicDeliberationStorageError(cause)
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(() => {}, () => {})
    return result
  }

  private requireTable(): KvTable<ActivityStrategicDeliberationId, ActivityStrategicDeliberation> {
    if (this.table === undefined) throw new Error('Home Activity strategic deliberation storage is not ready')
    return this.table
  }
}

function freezeDeliberation(deliberation: ActivityStrategicDeliberation): ActivityStrategicDeliberation {
  return Object.freeze({
    ...deliberation,
    skillDigests: Object.freeze(deliberation.skillDigests.map(item => Object.freeze({ ...item }))),
    evidenceUses: Object.freeze(deliberation.evidenceUses.map(item => Object.freeze({ ...item }))),
    uncertaintyReviews: Object.freeze(deliberation.uncertaintyReviews.map(item => Object.freeze({ ...item }))),
    newUncertainties: Object.freeze(deliberation.newUncertainties.map(item => Object.freeze({
      ...item,
      evidenceIds: Object.freeze([...item.evidenceIds]),
    }))),
  })
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Append-only advisory reconsiderations of saved Activity Strategic Briefs. */
    homeActivityStrategicDeliberations: HomeActivityStrategicDeliberationService
  }
}

/** Cordis registration name for Activity Strategic Deliberation persistence. */
export const name = 'home-activity-strategic-deliberations'
export default HomeActivityStrategicDeliberationService
