/** Durable user-owned Activity annotation history, separate from provider facts. @module @deepseek-ai/dsh-home-activity/annotations */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { ActivityId } from './types.ts'
import {
  correctActivityAnnotationRequestSchema,
  homeActivityAnnotationsDomain,
  MAX_HOME_ACTIVITY_ANNOTATIONS_PER_ACTIVITY,
} from './annotation-spec.ts'
import type { ActivityAnnotation, ActivityAnnotationId, CorrectActivityAnnotationRequest } from './annotation-types.ts'
import type {} from './index.ts'
import { createActivityOperationQueue } from './operation-queue.ts'

export type { ActivityAnnotation, ActivityAnnotationId, CorrectActivityAnnotationRequest } from './annotation-types.ts'
export {
  activityAnnotationRecordSchema,
  correctActivityAnnotationRequestSchema,
  homeActivityAnnotationsDomain,
  MAX_HOME_ACTIVITY_ANNOTATIONS_PER_ACTIVITY,
} from './annotation-spec.ts'

/** Stable rejection categories for an annotation request. */
export type ActivityAnnotationErrorCode = 'unknown-activity' | 'invalid-annotation' | 'annotation-limit'

/** Expected Activity ownership, note validation, or capacity rejection. */
export class ActivityAnnotationError extends Error {
  /** @param code - Stable rejection category. @param message - User-readable reason. */
  constructor(readonly code: ActivityAnnotationErrorCode, message: string) {
    super(message)
    this.name = 'ActivityAnnotationError'
  }
}

/** Annotation persistence failed; no requested correction was confirmed. */
export class ActivityAnnotationStorageError extends Error {
  /** @param cause - Underlying domain read or write failure. */
  constructor(cause: unknown) {
    super('Home Activity annotation storage failed.', { cause })
    this.name = 'ActivityAnnotationStorageError'
  }
}

/** Stores append-only user corrections independently from Activity and execution records. */
export class HomeActivityAnnotationService extends Service {
  static inject = ['storageDomain', 'homeActivities']

  private table?: KvTable<ActivityAnnotationId, ActivityAnnotation>
  private readonly enqueue = createActivityOperationQueue()

  constructor(ctx: Context) {
    super(ctx, 'homeActivityAnnotations')
  }

  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(homeActivityAnnotationsDomain)
    this.ctx.effect(() => () => domain.close(), 'homeActivityAnnotations.domainClose')
    this.table = domain.table('annotations')
  }

  /**
   * Append a new current-note revision while retaining each earlier user annotation.
   * @param request - Saved Activity identity and replacement note text.
   * @returns The saved revision with its predecessor and source attribution.
   * @throws {ActivityAnnotationError} when the Activity is unknown, the note is invalid, or history is full.
   * @throws {ActivityAnnotationStorageError} when annotation persistence fails.
   */
  correct(request: CorrectActivityAnnotationRequest): Promise<ActivityAnnotation> {
    return this.enqueue(async () => {
      if (this.ctx.homeActivities.get(request.activityId) === undefined) {
        throw new ActivityAnnotationError('unknown-activity', `No saved Activity has id ${request.activityId}.`)
      }
      const prior = this.list(request.activityId)
      const current = prior.at(-1)
      if (prior.length >= MAX_HOME_ACTIVITY_ANNOTATIONS_PER_ACTIVITY) {
        throw new ActivityAnnotationError(
          'annotation-limit',
          `An Activity can have at most ${MAX_HOME_ACTIVITY_ANNOTATIONS_PER_ACTIVITY} annotation revisions.`,
        )
      }
      const parsed = correctActivityAnnotationRequestSchema.safeParse(request)
      if (!parsed.success) {
        throw new ActivityAnnotationError(
          'invalid-annotation',
          `Activity annotation is invalid: ${parsed.error.issues.map(issue => issue.message).join('; ')}`,
        )
      }
      const annotation: ActivityAnnotation = {
        id: brandString<ActivityAnnotationId>(randomUUID()),
        activityId: parsed.data.activityId,
        revision: prior.length + 1,
        text: parsed.data.text,
        ...(current === undefined ? {} : { supersedes: current.id }),
        source: 'user-command',
        recordedAt: new Date().toISOString(),
      }
      try {
        await this.requireTable().put(annotation.id, annotation)
      } catch (cause: unknown) {
        throw new ActivityAnnotationStorageError(cause)
      }
      return freezeAnnotation(annotation)
    })
  }

  /**
   * List user-authored annotation revisions in original order.
   * @param activityId - Stable Activity identity.
   * @returns Detached revisions for the Activity, oldest first.
   * @throws {ActivityAnnotationError} when the Activity does not exist.
   * @throws {ActivityAnnotationStorageError} when annotation storage cannot be read.
   */
  list(activityId: ActivityId): readonly ActivityAnnotation[] {
    if (this.ctx.homeActivities.get(activityId) === undefined) {
      throw new ActivityAnnotationError('unknown-activity', `No saved Activity has id ${activityId}.`)
    }
    try {
      return Object.freeze([...this.requireTable().entries()]
        .map(([, annotation]) => annotation)
        .filter(annotation => annotation.activityId === activityId)
        .sort((left, right) => left.revision - right.revision || String(left.id).localeCompare(String(right.id)))
        .map(freezeAnnotation))
    } catch (cause: unknown) {
      throw new ActivityAnnotationStorageError(cause)
    }
  }

  private requireTable(): KvTable<ActivityAnnotationId, ActivityAnnotation> {
    if (this.table === undefined) throw new Error('Home Activity annotation storage is not ready')
    return this.table
  }
}

function freezeAnnotation(annotation: ActivityAnnotation): ActivityAnnotation {
  return Object.freeze({ ...annotation })
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Append-only user corrections to Home Activity coordination notes. */
    homeActivityAnnotations: HomeActivityAnnotationService
  }
}

/** Cordis registration name for the Activity annotation service. */
export const name = 'home-activity-annotations'
export default HomeActivityAnnotationService
