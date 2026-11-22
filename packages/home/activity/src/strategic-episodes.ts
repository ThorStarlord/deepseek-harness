/** Durable, append-only Activity Strategic Briefs with source provenance. @module @deepseek-ai/dsh-home-activity/strategic-episodes */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { ActivityId } from './types.ts'
import {
  activityStrategicEpisodeRecordSchema,
  homeActivityStrategicEpisodesDomain,
  MAX_HOME_ACTIVITY_STRATEGIC_EPISODES_PER_ACTIVITY,
  MAX_HOME_ACTIVITY_STRATEGIC_EPISODE_BYTES,
  recordActivityStrategicEpisodeRequestSchema,
} from './strategic-episode-spec.ts'
import type { ActivityStrategicEpisode, ActivityStrategicEpisodeId, RecordActivityStrategicEpisodeRequest } from './strategic-episode-types.ts'
import type {} from './index.ts'

export type {
  ActivityStrategicAlternative,
  ActivityStrategicEpisode,
  ActivityStrategicEpisodeId,
  ActivityStrategicEvidenceReference,
  ActivityStrategicFinding,
  ActivityStrategicFindingKind,
  ActivityStrategicRecommendation,
  ActivityStrategicRepositoryObservation,
  ActivityStrategicUncertainty,
  RecordActivityStrategicEpisodeRequest,
} from './strategic-episode-types.ts'
export {
  activityStrategicEpisodeRecordSchema,
  homeActivityStrategicEpisodesDomain,
  MAX_HOME_ACTIVITY_STRATEGIC_EPISODES_PER_ACTIVITY,
  MAX_HOME_ACTIVITY_STRATEGIC_EPISODE_BYTES,
  recordActivityStrategicEpisodeRequestSchema,
} from './strategic-episode-spec.ts'

/** Stable rejection categories for a strategic episode request. */
export type ActivityStrategicEpisodeErrorCode = 'unknown-activity' | 'invalid-episode' | 'episode-limit'

/** Expected Activity ownership, validation, or capacity rejection. */
export class ActivityStrategicEpisodeError extends Error {
  /** @param code - Stable rejection category. @param message - User-readable reason. */
  constructor(readonly code: ActivityStrategicEpisodeErrorCode, message: string) {
    super(message)
    this.name = 'ActivityStrategicEpisodeError'
  }
}

/** Activity strategic episode persistence failed; inspect saved history before retrying. */
export class ActivityStrategicEpisodeStorageError extends Error {
  /** @param cause - Underlying domain read or write failure. */
  constructor(cause: unknown) {
    super('Home Activity strategic episode storage failed.', { cause })
    this.name = 'ActivityStrategicEpisodeStorageError'
  }
}

/** Stores append-only agent-authored strategic assessments independently from Activity intent and user notes. */
export class HomeActivityStrategicEpisodeService extends Service {
  static inject = ['storageDomain', 'homeActivities']

  private table?: KvTable<ActivityStrategicEpisodeId, ActivityStrategicEpisode>
  private operationTail: Promise<void> = Promise.resolve()

  constructor(ctx: Context) {
    super(ctx, 'homeActivityStrategicEpisodes')
  }

  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(homeActivityStrategicEpisodesDomain)
    this.ctx.effect(() => () => domain.close(), 'homeActivityStrategicEpisodes.domainClose')
    this.table = domain.table('episodes')
  }

  /** Append a completed or explicitly incomplete agent-authored brief.
   * @param request - Activity, Session, request, Skills, repository observations, and report content.
   * @returns The saved episode, or the prior episode for a repeated request id.
   * @throws {ActivityStrategicEpisodeError} when the Activity is unknown, report content is invalid, or the episode limit is reached.
   * @throws {ActivityStrategicEpisodeStorageError} when episode storage cannot confirm the read or write.
   */
  record(request: RecordActivityStrategicEpisodeRequest): Promise<ActivityStrategicEpisode> {
    return this.enqueue(async () => {
      const activity = this.ctx.homeActivities.get(request.activityId)
      if (activity === undefined) {
        throw new ActivityStrategicEpisodeError('unknown-activity', `No saved Activity has id ${request.activityId}.`)
      }
      const prior = this.list(request.activityId)
      const duplicate = prior.find(episode => episode.requestId === request.requestId)
      if (duplicate !== undefined) return duplicate
      const parsed = recordActivityStrategicEpisodeRequestSchema.safeParse({
        status: request.status,
        repositories: request.repositories,
        evidence: request.evidence,
        findings: request.findings,
        alternatives: request.alternatives,
        uncertainties: request.uncertainties,
        recommendation: request.recommendation,
      })
      if (!parsed.success) {
        throw new ActivityStrategicEpisodeError(
          'invalid-episode',
          `Activity Strategic Brief is invalid: ${parsed.error.issues.map(issue => issue.message).join('; ')}`,
        )
      }
      if (prior.length >= MAX_HOME_ACTIVITY_STRATEGIC_EPISODES_PER_ACTIVITY) {
        throw new ActivityStrategicEpisodeError(
          'episode-limit',
          `An Activity can have at most ${MAX_HOME_ACTIVITY_STRATEGIC_EPISODES_PER_ACTIVITY} strategic episodes.`,
        )
      }
      const current = prior.at(-1)
      const recordedAt = new Date().toISOString()
      const episode = activityStrategicEpisodeRecordSchema.safeParse({
        id: brandString<ActivityStrategicEpisodeId>(randomUUID()),
        activityId: request.activityId,
        revision: prior.length + 1,
        ...(current === undefined ? {} : { supersedes: current.id }),
        originSessionId: request.originSessionId,
        producer: 'dsh-active-agent',
        requestId: request.requestId,
        objective: activity.objective,
        ...parsed.data,
        skillDigests: request.skillDigests,
        requestedAt: request.requestedAt,
        recordedAt,
      })
      if (!episode.success) {
        throw new ActivityStrategicEpisodeError(
          'invalid-episode',
          `Activity Strategic Brief is invalid: ${episode.error.issues.map(issue => issue.message).join('; ')}`,
        )
      }
      if (Buffer.byteLength(JSON.stringify(episode.data), 'utf8') > MAX_HOME_ACTIVITY_STRATEGIC_EPISODE_BYTES) {
        throw new ActivityStrategicEpisodeError('invalid-episode', 'Activity Strategic Brief exceeds the 64 KiB storage limit.')
      }
      try {
        await this.requireTable().put(episode.data.id, episode.data)
      } catch (cause: unknown) {
        throw new ActivityStrategicEpisodeStorageError(cause)
      }
      return freezeEpisode(episode.data)
    })
  }

  /** List historical assessments without checking repositories or starting work.
   * @param activityId - Stable Activity identity.
   * @returns Detached episodes for the Activity, oldest first.
   * @throws {ActivityStrategicEpisodeError} when the Activity does not exist.
   * @throws {ActivityStrategicEpisodeStorageError} when episode storage cannot be read.
   */
  list(activityId: ActivityId): readonly ActivityStrategicEpisode[] {
    if (this.ctx.homeActivities.get(activityId) === undefined) {
      throw new ActivityStrategicEpisodeError('unknown-activity', `No saved Activity has id ${activityId}.`)
    }
    try {
      return Object.freeze([...this.requireTable().entries()]
        .map(([, episode]) => episode)
        .filter(episode => episode.activityId === activityId)
        .sort((left, right) => left.revision - right.revision || String(left.id).localeCompare(String(right.id)))
        .map(freezeEpisode))
    } catch (cause: unknown) {
      if (cause instanceof ActivityStrategicEpisodeError) throw cause
      throw new ActivityStrategicEpisodeStorageError(cause)
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(() => {}, () => {})
    return result
  }

  private requireTable(): KvTable<ActivityStrategicEpisodeId, ActivityStrategicEpisode> {
    if (this.table === undefined) throw new Error('Home Activity strategic episode storage is not ready')
    return this.table
  }
}

function freezeEpisode(episode: ActivityStrategicEpisode): ActivityStrategicEpisode {
  return Object.freeze({
    ...episode,
    repositories: Object.freeze(episode.repositories.map(item => Object.freeze({ ...item }))),
    skillDigests: Object.freeze(episode.skillDigests.map(item => Object.freeze({ ...item }))),
    evidence: Object.freeze(episode.evidence.map(item => Object.freeze({ ...item }))),
    findings: Object.freeze(episode.findings.map(item => Object.freeze({
      ...item,
      evidenceIds: Object.freeze([...item.evidenceIds]),
    }))),
    alternatives: Object.freeze(episode.alternatives.map(item => Object.freeze({
      ...item,
      evidenceIds: Object.freeze([...item.evidenceIds]),
      uncertaintyIds: Object.freeze([...item.uncertaintyIds]),
    }))),
    uncertainties: Object.freeze(episode.uncertainties.map(item => Object.freeze({
      ...item,
      evidenceIds: Object.freeze([...item.evidenceIds]),
    }))),
    recommendation: Object.freeze({
      ...episode.recommendation,
      evidenceIds: Object.freeze([...episode.recommendation.evidenceIds]),
      uncertaintyIds: Object.freeze([...episode.recommendation.uncertaintyIds]),
    }),
  })
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Durable advisory Activity Strategic Brief episodes. */
    homeActivityStrategicEpisodes: HomeActivityStrategicEpisodeService
  }
}

/** Cordis registration name for the Activity Strategic Brief persistence service. */
export const name = 'home-activity-strategic-episodes'
export default HomeActivityStrategicEpisodeService
