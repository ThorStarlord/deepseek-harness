/** Durable, separately authored links from Activities to existing Workspaces and Sessions.
 * @module @deepseek-ai/dsh-home-activity/associations
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-workspace'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { ActivityId } from './types.ts'
import type { HomeActivityAssociationRecord, HomeActivityAssociations } from './association-types.ts'
import {
  homeActivityAssociationsDomain,
  MAX_HOME_ACTIVITY_ASSOCIATIONS_PER_KIND,
} from './association-spec.ts'
import { createActivityOperationQueue } from './operation-queue.ts'

/** Stable rejection categories for association requests. */
export type HomeActivityAssociationErrorCode = 'unknown-activity' | 'unknown-workspace' | 'unknown-session' | 'association-limit'

/** An identity is unavailable or the Activity reached its reference limit. */
export class HomeActivityAssociationError extends Error {
  /** @param code - Stable rejection category. @param message - User-readable reason. */
  constructor(readonly code: HomeActivityAssociationErrorCode, message: string) {
    super(message)
    this.name = 'HomeActivityAssociationError'
  }
}

/** Association-domain reads or writes failed; no requested change was confirmed. */
export class HomeActivityAssociationStorageError extends Error {
  /** @param cause - Underlying domain read or write failure. */
  constructor(cause: unknown) {
    super('Home Activity association storage failed.', { cause })
    this.name = 'HomeActivityAssociationStorageError'
  }
}

/** Context references persisted separately from the strict Activity v1 record. */
export class HomeActivityAssociationService extends Service {
  static inject = ['storageDomain', 'homeActivities', 'workspaceRegistry', 'sessionPersistence']

  private table?: KvTable<ActivityId, HomeActivityAssociationRecord>
  private readonly enqueue = createActivityOperationQueue()

  constructor(ctx: Context) {
    super(ctx, 'homeActivityAssociations')
  }

  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(homeActivityAssociationsDomain)
    this.ctx.effect(() => () => domain.close(), 'homeActivityAssociations.domainClose')
    this.table = domain.table('activities')
  }

  /**
   * Read separately authored Workspace and Session ids for one saved Activity.
   * @param activityId - Stable Activity identity.
   * @returns Detached ids; an Activity with no links returns two empty arrays.
   * @throws {HomeActivityAssociationError} when the Activity does not exist.
   */
  get(activityId: ActivityId): HomeActivityAssociations {
    this.requireActivity(activityId)
    const record = this.readRecord(activityId)
    return freezeAssociations(record)
  }

  /**
   * Add a selected existing Workspace reference; repeated links are idempotent.
   * @param activityId - Saved Activity receiving the reference.
   * @param workspaceId - Existing Workspace registry identity.
   * @returns `true` when a new durable link was written.
   * @throws {HomeActivityAssociationError} when the Activity or Workspace is unknown
   *   or the Activity already has the maximum number of Workspace references.
   */
  linkWorkspace(activityId: ActivityId, workspaceId: WorkspaceId): Promise<boolean> {
    return this.enqueue(async () => {
      this.requireActivity(activityId)
      if (this.ctx.workspaceRegistry.get(workspaceId) === undefined) {
        throw new HomeActivityAssociationError('unknown-workspace', `No Workspace has id ${workspaceId}.`)
      }
      return await this.add(activityId, 'workspaceIds', workspaceId)
    })
  }

  /**
   * Add a selected existing DSH Session reference; repeated links are idempotent.
   * @param activityId - Saved Activity receiving the reference.
   * @param sessionId - Existing DSH Session identity.
   * @returns `true` when a new durable link was written.
   * @throws {HomeActivityAssociationError} when the Activity or Session is unknown
   *   or the Activity already has the maximum number of Session references.
   */
  linkSession(activityId: ActivityId, sessionId: SessionId): Promise<boolean> {
    return this.enqueue(async () => {
      this.requireActivity(activityId)
      if (await this.ctx.sessionPersistence.stat(sessionId) === undefined) {
        throw new HomeActivityAssociationError('unknown-session', `No stored DSH Session has id ${sessionId}.`)
      }
      return await this.add(activityId, 'sessionIds', sessionId)
    })
  }

  /**
   * Remove a Workspace reference without mutating its Workspace record.
   * @param activityId - Saved Activity whose reference is removed.
   * @param workspaceId - Workspace identity, including an unavailable old identity.
   * @returns `true` when a durable link was removed.
   * @throws {HomeActivityAssociationError} when the Activity is unknown.
   */
  unlinkWorkspace(activityId: ActivityId, workspaceId: WorkspaceId): Promise<boolean> {
    return this.enqueue(async () => await this.remove(activityId, 'workspaceIds', workspaceId))
  }

  /**
   * Remove a DSH Session reference without mutating its Session log.
   * @param activityId - Saved Activity whose reference is removed.
   * @param sessionId - Session identity, including an unavailable old identity.
   * @returns `true` when a durable link was removed.
   * @throws {HomeActivityAssociationError} when the Activity is unknown.
   */
  unlinkSession(activityId: ActivityId, sessionId: SessionId): Promise<boolean> {
    return this.enqueue(async () => await this.remove(activityId, 'sessionIds', sessionId))
  }

  private requireActivity(activityId: ActivityId): void {
    if (this.ctx.homeActivities.get(activityId) === undefined) {
      throw new HomeActivityAssociationError('unknown-activity', `No saved Activity has id ${activityId}.`)
    }
  }

  private async add<K extends 'workspaceIds' | 'sessionIds'>(activityId: ActivityId, key: K, id: HomeActivityAssociationRecord[K][number]): Promise<boolean> {
    const current = this.readRecord(activityId)
    const ids = current?.[key] ?? []
    if (ids.some(existing => existing === id)) return false
    if (ids.length >= MAX_HOME_ACTIVITY_ASSOCIATIONS_PER_KIND) {
      const kind = key === 'workspaceIds' ? 'Workspace' : 'DSH Session'
      throw new HomeActivityAssociationError(
        'association-limit',
        `An Activity can have at most ${MAX_HOME_ACTIVITY_ASSOCIATIONS_PER_KIND} ${kind} references. Remove an existing ${kind} reference before adding another.`,
      )
    }
    const next = freezeRecord({
      activityId,
      workspaceIds: current?.workspaceIds ?? [],
      sessionIds: current?.sessionIds ?? [],
      [key]: [...ids, id],
      updatedAt: new Date().toISOString(),
    })
    await this.writeRecord(activityId, next)
    return true
  }

  private async remove<K extends 'workspaceIds' | 'sessionIds'>(activityId: ActivityId, key: K, id: HomeActivityAssociationRecord[K][number]): Promise<boolean> {
    this.requireActivity(activityId)
    const current = this.readRecord(activityId)
    if (current === undefined) return false
    const ids = current[key]
    if (!ids.some(existing => existing === id)) return false
    const remaining = ids.filter(existing => existing !== id)
    if (current.workspaceIds.length + current.sessionIds.length === 1) {
      try {
        await this.requireTable().delete(activityId)
      } catch (cause: unknown) {
        throw new HomeActivityAssociationStorageError(cause)
      }
      return true
    }
    await this.writeRecord(activityId, freezeRecord({
      ...current,
      [key]: remaining,
      updatedAt: new Date().toISOString(),
    }))
    return true
  }

  private readRecord(activityId: ActivityId): HomeActivityAssociationRecord | undefined {
    try {
      return this.requireTable().get(activityId)
    } catch (cause: unknown) {
      throw new HomeActivityAssociationStorageError(cause)
    }
  }

  private async writeRecord(activityId: ActivityId, record: HomeActivityAssociationRecord): Promise<void> {
    try {
      await this.requireTable().put(activityId, record)
    } catch (cause: unknown) {
      throw new HomeActivityAssociationStorageError(cause)
    }
  }

  private requireTable(): KvTable<ActivityId, HomeActivityAssociationRecord> {
    if (this.table === undefined) throw new Error('Home Activity association storage is not ready')
    return this.table
  }
}

function freezeAssociations(record: HomeActivityAssociationRecord | undefined): HomeActivityAssociations {
  return Object.freeze({
    workspaceIds: Object.freeze([...(record?.workspaceIds ?? [])]),
    sessionIds: Object.freeze([...(record?.sessionIds ?? [])]),
  })
}

function freezeRecord(record: HomeActivityAssociationRecord): HomeActivityAssociationRecord {
  return Object.freeze({
    ...record,
    workspaceIds: Object.freeze([...record.workspaceIds]),
    sessionIds: Object.freeze([...record.sessionIds]),
  })
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Durable Activity references to Workspace and DSH Session identities. */
    homeActivityAssociations: HomeActivityAssociationService
  }
}

export {
  homeActivityAssociationRecordSchema,
  homeActivityAssociationsDomain,
  MAX_HOME_ACTIVITY_ASSOCIATIONS_PER_KIND,
} from './association-spec.ts'
export type { HomeActivityAssociationRecord, HomeActivityAssociations } from './association-types.ts'
export const name = 'home-activity-associations'
export default HomeActivityAssociationService
