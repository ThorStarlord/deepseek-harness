/** Durable user-directed Activities, independent of Session and Goal lifecycle. @module @deepseek-ai/dsh-home-activity */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { createActivityRequestSchema, homeActivityDomain } from './spec.ts'
import type { Activity, ActivityId as ActivityIdBrand, CreateActivityRequest } from './types.ts'

export type { Activity, ActivityBoundaries, CreateActivityRequest } from './types.ts'
/** Stable identity assigned to a saved Activity. */
export type ActivityId = ActivityIdBrand
export { createActivityRequestSchema, activityRecordSchema, homeActivityDomain } from './spec.ts'

/** Stable error categories returned by the Activity service. */
export type ActivityErrorCode = 'invalid-request'

/** Expected Activity service rejection. */
export class ActivityError extends Error {
  /** @param code - Stable rejection category. @param message - User-readable reason. */
  constructor(readonly code: ActivityErrorCode, message: string) {
    super(message)
    this.name = 'ActivityError'
  }
}

/** Durable Activity catalog mounted as `ctx.homeActivities`. */
export class HomeActivityService extends Service {
  static inject = ['storageDomain']

  private table?: KvTable<ActivityId, Activity>

  constructor(ctx: Context) {
    super(ctx, 'homeActivities')
  }

  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(homeActivityDomain)
    this.ctx.effect(() => () => domain.close(), 'homeActivities.domainClose')
    this.table = domain.table('activities')
  }

  /**
   * Save a new Activity without creating a Session, Goal, or execution.
   * @param request - Name, objective, and descriptive scope statements.
   * @returns the saved record with its stable identity and creation time.
   */
  async create(request: CreateActivityRequest): Promise<Activity> {
    const parsed = createActivityRequestSchema.safeParse(request)
    if (!parsed.success) {
      const details = parsed.error.issues.map(issue => issue.message).join('; ')
      throw new ActivityError('invalid-request', `Activity details are invalid: ${details}`)
    }
    const activity: Activity = freezeActivity({
      id: ActivityId(randomUUID()),
      ...parsed.data,
      createdAt: new Date().toISOString(),
    })
    await this.requireTable().put(activity.id, activity)
    return activity
  }

  /**
   * List saved Activities newest first. This read does not activate execution.
   * @returns a detached snapshot of the saved records.
   */
  list(): readonly Activity[] {
    return Object.freeze([...this.requireTable().entries()]
      .map(([, activity]) => freezeActivity(activity))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || String(left.id).localeCompare(String(right.id))))
  }

  /**
   * Read one saved Activity by stable identity.
   * @param id - Stable Activity identity.
   * @returns a detached record, or `undefined` when no such Activity exists.
   */
  get(id: ActivityId): Activity | undefined {
    const activity = this.requireTable().get(id)
    return activity === undefined ? undefined : freezeActivity(activity)
  }

  private requireTable(): KvTable<ActivityId, Activity> {
    if (this.table === undefined) throw new Error('Home Activity storage is not ready')
    return this.table
  }
}

/** Brand a UUID after its parser has validated the external string.
 * @param value - Validated Activity UUID.
 * @returns The same value branded as an Activity identity.
 */
export function ActivityId(value: string): ActivityId {
  return brandString<ActivityId>(value)
}

/** Copy and freeze a saved value so callers cannot mutate domain-owned records. */
function freezeActivity(activity: Activity): Activity {
  return Object.freeze({
    ...activity,
    boundaries: Object.freeze({
      inScope: Object.freeze([...activity.boundaries.inScope]),
      outOfScope: Object.freeze([...activity.boundaries.outOfScope]),
    }),
  })
}

export const name = 'home-activity'

export default HomeActivityService
