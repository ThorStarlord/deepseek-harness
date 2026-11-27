/** Durable user-supplied external handoffs for saved Home Activities. @module @deepseek-ai/dsh-home-activity/handoffs */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { homeActivityHandoffsDomain, activityHandoffSchema, MAX_HOME_ACTIVITY_HANDOFFS_PER_ACTIVITY } from './handoff-spec.ts'
import type { ActivityHandoff, ActivityHandoffId, CreateActivityHandoffRequest } from './handoff-types.ts'
import type { ActivityId } from './types.ts'
import { createActivityOperationQueue } from './operation-queue.ts'

export type { ActivityHandoff, ActivityHandoffArtifact, ActivityHandoffId, CreateActivityHandoffRequest } from './handoff-types.ts'
export {
  activityHandoffSchema,
  createActivityHandoffDetailsSchema,
  homeActivityHandoffsDomain,
  MAX_HOME_ACTIVITY_HANDOFFS_PER_ACTIVITY,
  MAX_HOME_ACTIVITY_HANDOFF_ARTIFACTS_PER_HANDOFF,
} from './handoff-spec.ts'

/** Stable rejection categories for an external handoff request. */
export type ActivityHandoffErrorCode = 'unknown-activity' | 'handoff-limit' | 'invalid-handoff'

/** Expected Activity ownership or handoff validation rejection. */
export class ActivityHandoffError extends Error {
  /** @param code - Stable rejection category. @param message - User-readable explanation. */
  constructor(readonly code: ActivityHandoffErrorCode, message: string) {
    super(message)
    this.name = 'ActivityHandoffError'
  }
}

/** External handoff persistence failed; no new record was confirmed. */
export class ActivityHandoffStorageError extends Error {
  /** @param cause - Underlying storage failure. */
  constructor(cause: unknown) {
    super('Home Activity handoff storage failed.', { cause })
    this.name = 'ActivityHandoffStorageError'
  }
}

/** Stores user-supplied external handoffs independently from execution records. */
export class HomeActivityHandoffService extends Service {
  static inject = ['storageDomain', 'homeActivities']

  private table?: KvTable<ActivityHandoffId, ActivityHandoff>
  private readonly enqueue = createActivityOperationQueue()

  constructor(ctx: Context) {
    super(ctx, 'homeActivityHandoffs')
  }

  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(homeActivityHandoffsDomain)
    this.ctx.effect(() => () => domain.close(), 'homeActivityHandoffs.domainClose')
    this.table = domain.table('handoffs')
  }

  /**
   * Record the user-supplied summary and references for work performed outside DSH.
   * @param request - Existing Activity, source, summary or references, and recording Session.
   * @returns The durable handoff explicitly attributed to user input.
   * @throws {ActivityHandoffError} when the Activity is missing or the handoff is invalid.
   * @throws {ActivityHandoffStorageError} when persistence cannot confirm the new record.
   */
  create(request: CreateActivityHandoffRequest): Promise<ActivityHandoff> {
    return this.enqueue(async () => {
      if (this.ctx.homeActivities.get(request.activityId) === undefined) {
        throw new ActivityHandoffError('unknown-activity', `No saved Activity has id ${request.activityId}.`)
      }
      let current: ActivityHandoff[]
      try {
        current = [...this.requireTable().entries()]
          .map(([, handoff]) => handoff)
          .filter(handoff => handoff.activityId === request.activityId)
      } catch (cause: unknown) {
        throw new ActivityHandoffStorageError(cause)
      }
      if (current.length >= MAX_HOME_ACTIVITY_HANDOFFS_PER_ACTIVITY) {
        throw new ActivityHandoffError('handoff-limit', `An Activity can have at most ${MAX_HOME_ACTIVITY_HANDOFFS_PER_ACTIVITY} external handoffs.`)
      }
      const parsed = activityHandoffSchema.safeParse({
        id: brandString<ActivityHandoffId>(randomUUID()),
        ...request,
        origin: 'user-supplied-external',
        recordedAt: new Date().toISOString(),
      })
      if (!parsed.success) {
        throw new ActivityHandoffError('invalid-handoff', `External handoff details are invalid: ${parsed.error.issues.map(issue => issue.message).join('; ')}`)
      }
      try {
        await this.requireTable().put(parsed.data.id, parsed.data)
      } catch (cause: unknown) {
        throw new ActivityHandoffStorageError(cause)
      }
      return freezeHandoff(parsed.data)
    })
  }

  /**
   * List user-supplied external handoffs for one Activity, newest first.
   * @param activityId - Stable Activity identity.
   * @returns Detached handoff records.
   * @throws {ActivityHandoffError} when the Activity does not exist.
   * @throws {ActivityHandoffStorageError} when handoff storage cannot be read.
   */
  list(activityId: ActivityId): readonly ActivityHandoff[] {
    if (this.ctx.homeActivities.get(activityId) === undefined) {
      throw new ActivityHandoffError('unknown-activity', `No saved Activity has id ${activityId}.`)
    }
    try {
      return Object.freeze([...this.requireTable().entries()]
        .map(([, handoff]) => handoff)
        .filter(handoff => handoff.activityId === activityId)
        .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt) || String(left.id).localeCompare(String(right.id)))
        .map(freezeHandoff))
    } catch (cause: unknown) {
      throw new ActivityHandoffStorageError(cause)
    }
  }

  private requireTable(): KvTable<ActivityHandoffId, ActivityHandoff> {
    if (this.table === undefined) throw new Error('Home Activity handoff storage is not ready')
    return this.table
  }
}

function freezeHandoff(handoff: ActivityHandoff): ActivityHandoff {
  return Object.freeze({
    ...handoff,
    artifacts: Object.freeze(handoff.artifacts.map(artifact => Object.freeze({ ...artifact }))),
  })
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** User-supplied external handoffs kept separate from native execution and artifact records. */
    homeActivityHandoffs: HomeActivityHandoffService
  }
}

/** Cordis registration name for user-supplied external Activity handoffs. */
export const name = 'home-activity-handoffs'
export default HomeActivityHandoffService
