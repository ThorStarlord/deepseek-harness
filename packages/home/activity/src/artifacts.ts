/** Durable user-linked artifact pointers for saved Home Activities. @module @deepseek-ai/dsh-home-activity/artifacts */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import {
  activityArtifactReferenceSchema,
  homeActivityArtifactsDomain,
  MAX_HOME_ACTIVITY_ARTIFACTS_PER_ACTIVITY,
} from './artifact-spec.ts'
import type { ActivityArtifactId, ActivityArtifactReference, CreateActivityArtifactRequest } from './artifact-types.ts'
import type { ActivityId } from './types.ts'
import type {} from './associations.ts'
import type {} from './delegations.ts'
import type {} from '@deepseek-ai/dsh-workspace'

export type { ActivityArtifactId, ActivityArtifactReference, CreateActivityArtifactRequest } from './artifact-types.ts'
export { activityArtifactReferenceSchema, homeActivityArtifactsDomain, MAX_HOME_ACTIVITY_ARTIFACTS_PER_ACTIVITY } from './artifact-spec.ts'

/** Stable rejection categories for an artifact pointer request. */
export type ActivityArtifactErrorCode =
  | 'unknown-activity'
  | 'unknown-delegation'
  | 'delegation-activity-mismatch'
  | 'workspace-not-linked'
  | 'unknown-workspace'
  | 'artifact-limit'
  | 'invalid-reference'

/** Expected ownership, association, or capacity rejection. */
export class ActivityArtifactError extends Error {
  /** @param code - Stable rejection category. @param message - User-readable explanation. */
  constructor(readonly code: ActivityArtifactErrorCode, message: string) {
    super(message)
    this.name = 'ActivityArtifactError'
  }
}

/** Artifact reference storage failed; no requested pointer was confirmed. */
export class ActivityArtifactStorageError extends Error {
  /** @param cause - Underlying domain read or write failure. */
  constructor(cause: unknown) {
    super('Home Activity artifact reference storage failed.', { cause })
    this.name = 'ActivityArtifactStorageError'
  }
}

/** Stores user-linked artifact pointers independently from delegation lifecycle facts. */
export class HomeActivityArtifactService extends Service {
  static inject = ['storageDomain', 'homeActivities', 'homeActivityDelegations', 'homeActivityAssociations', 'workspaceRegistry']

  private table?: KvTable<ActivityArtifactId, ActivityArtifactReference>
  private operationTail: Promise<void> = Promise.resolve()

  constructor(ctx: Context) {
    super(ctx, 'homeActivityArtifacts')
  }

  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(homeActivityArtifactsDomain)
    this.ctx.effect(() => () => domain.close(), 'homeActivityArtifacts.domainClose')
    this.table = domain.table('artifacts')
  }

  /**
 * Record a user-linked pointer after confirming its Activity, delegation, and selected Workspace references.
   * @param request - User-supplied label, location, optional revision, and selected identities.
 * @returns The durable pointer; this does not confirm its Workspace matches execution or who produced it.
   * @throws {ActivityArtifactError} when identities are missing, mismatched, or unlinked.
   * @throws {ActivityArtifactStorageError} when pointer persistence fails.
   */
  create(request: CreateActivityArtifactRequest): Promise<ActivityArtifactReference> {
    return this.enqueue(async () => {
      if (this.ctx.homeActivities.get(request.activityId) === undefined) {
        throw new ActivityArtifactError('unknown-activity', `No saved Activity has id ${request.activityId}.`)
      }
      const delegation = this.ctx.homeActivityDelegations.get(request.delegationId)
      if (delegation === undefined) {
        throw new ActivityArtifactError('unknown-delegation', `No saved delegation has id ${request.delegationId}.`)
      }
      if (delegation.activityId !== request.activityId) {
        throw new ActivityArtifactError('delegation-activity-mismatch', 'The selected delegation belongs to a different Activity.')
      }
      const associations = this.ctx.homeActivityAssociations.get(request.activityId)
      if (!associations.workspaceIds.includes(request.workspaceId)) {
        throw new ActivityArtifactError('workspace-not-linked', 'The selected Workspace is not linked to this Activity.')
      }
      if (this.ctx.workspaceRegistry.get(request.workspaceId) === undefined) {
        throw new ActivityArtifactError('unknown-workspace', `No Workspace has id ${request.workspaceId}.`)
      }
      const current = [...this.requireTable().entries()].filter(([, artifact]) => artifact.activityId === request.activityId)
      if (current.length >= MAX_HOME_ACTIVITY_ARTIFACTS_PER_ACTIVITY) {
        throw new ActivityArtifactError(
          'artifact-limit',
          `An Activity can have at most ${MAX_HOME_ACTIVITY_ARTIFACTS_PER_ACTIVITY} artifact references.`,
        )
      }
      const parsed = activityArtifactReferenceSchema.safeParse({
        id: brandString<ActivityArtifactId>(randomUUID()),
        activityId: request.activityId,
        delegationId: request.delegationId,
        workspaceId: request.workspaceId,
        label: request.label,
        location: request.location,
        ...(request.revision === undefined ? {} : { revision: request.revision }),
        source: 'user-command',
        recordedAt: new Date().toISOString(),
      })
      if (!parsed.success) {
        throw new ActivityArtifactError('invalid-reference', `Artifact reference is invalid: ${parsed.error.issues.map(issue => issue.message).join('; ')}`)
      }
      try {
        await this.requireTable().put(parsed.data.id, parsed.data)
      } catch (cause: unknown) {
        throw new ActivityArtifactStorageError(cause)
      }
      return freezeArtifact(parsed.data)
    })
  }

  /**
   * List user-linked pointers for one Activity, newest first.
   * @param activityId - Stable Activity identity.
   * @returns Detached pointers belonging to the Activity.
   * @throws {ActivityArtifactError} when the Activity does not exist.
   * @throws {ActivityArtifactStorageError} when artifact storage cannot be read.
   */
  list(activityId: ActivityId): readonly ActivityArtifactReference[] {
    if (this.ctx.homeActivities.get(activityId) === undefined) {
      throw new ActivityArtifactError('unknown-activity', `No saved Activity has id ${activityId}.`)
    }
    try {
      return Object.freeze([...this.requireTable().entries()]
        .map(([, artifact]) => artifact)
        .filter(artifact => artifact.activityId === activityId)
        .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt) || String(left.id).localeCompare(String(right.id)))
        .map(freezeArtifact))
    } catch (cause: unknown) {
      if (cause instanceof ActivityArtifactError) throw cause
      throw new ActivityArtifactStorageError(cause)
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(() => {}, () => {})
    return result
  }

  private requireTable(): KvTable<ActivityArtifactId, ActivityArtifactReference> {
    if (this.table === undefined) throw new Error('Home Activity artifact reference storage is not ready')
    return this.table
  }
}

function freezeArtifact(artifact: ActivityArtifactReference): ActivityArtifactReference {
  return Object.freeze({ ...artifact })
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** User-linked artifact pointers kept apart from provider-authored delegation facts. */
    homeActivityArtifacts: HomeActivityArtifactService
  }
}

/** Cordis registration name for the artifact pointer service. */
export const name = 'home-activity-artifacts'
export default HomeActivityArtifactService
