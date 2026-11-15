/** User commands for discovering, linking, and unlinking Activity contexts.
 * @module @deepseek-ai/dsh-command-home-activity/association-command
 */

import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { ActivityId } from '@deepseek-ai/dsh-home-activity'
import {
  HomeActivityAssociationError,
  HomeActivityAssociationStorageError,
} from '@deepseek-ai/dsh-home-activity/associations'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { StorageError } from '@deepseek-ai/dsh-storage'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'

const ID = String.raw`\S+`
const ASSOCIATION_USAGE = 'Usage: /activity workspaces | sessions | link <activity-id> workspace <workspace-id> | link <activity-id> session <session-id> | unlink <activity-id> workspace <workspace-id> | unlink <activity-id> session <session-id>'
const activityIdSchema = z.uuid()
const workspaceIdSchema = z.uuid()
const sessionIdSchema = z.string().min(1).max(256).regex(/^\S+$/u)
const MAX_INPUT_BYTES = 16_384

type AssociationCommand =
  | { readonly kind: 'workspaces' }
  | { readonly kind: 'sessions' }
  | { readonly kind: 'link'; readonly activityId: string; readonly contextKind: 'workspace' | 'session'; readonly contextId: string }
  | { readonly kind: 'unlink'; readonly activityId: string; readonly contextKind: 'workspace' | 'session'; readonly contextId: string }
  | { readonly kind: 'invalid'; readonly message: string }

/**
 * Execute the `/activity` context commands.
 * @param ctx - Plugin context for Activity, Workspace, Session, and command services.
 * @param invocation - Parsed human command invocation.
 * @returns The command result, or `undefined` when another `/activity` verb owns the input.
 */
export async function executeAssociationCommand(ctx: Context, invocation: CommandInvocation): Promise<CommandResult | undefined> {
  const parsed = parseAssociationCommand(invocation.rawInput)
  if (parsed === undefined) return undefined
  if (parsed.kind === 'invalid') return { kind: 'error', text: parsed.message }
  if (parsed.kind === 'workspaces') return await listWorkspaces(ctx)
  if (parsed.kind === 'sessions') return await listSessions(ctx)
  if (parsed.kind === 'link') return await link(ctx, parsed)
  return await unlink(ctx, parsed)
}

/**
 * Render current independently authored links while opening a saved Activity.
 * @param ctx - Plugin context for Activity, Workspace, and Session services.
 * @param activityId - Stable identity of the Activity being opened.
 * @returns Read-only lines describing available and unavailable links.
 */
export async function renderActivityAssociations(ctx: Context, activityId: ReturnType<typeof ActivityId>): Promise<readonly string[]> {
  const associations = ctx.homeActivityAssociations.get(activityId)
  const lines = ['Workspace links (selected separately):']
  if (associations.workspaceIds.length === 0) lines.push('No Workspace links.')
  for (const id of associations.workspaceIds) {
    const workspace = ctx.workspaceRegistry.get(id)
    if (workspace === undefined) {
      lines.push(`Unavailable Workspace: ${id} (no matching Workspace registry record).`)
      continue
    }
    const status = await workspace.status()
    lines.push(`Workspace: ${workspace.title} — ${id}`)
    lines.push(`Directory: ${workspace.path}`)
    lines.push(status === 'ok' ? 'Directory status: available.' : 'Directory status: unavailable; the Workspace record remains linked.')
  }
  lines.push('DSH Session links (selected separately; these links do not assign Sessions to Workspaces):')
  if (associations.sessionIds.length === 0) lines.push('No DSH Session links.')
  for (const id of associations.sessionIds) {
    const snapshot = await ctx.sessionPersistence.stat(id)
    if (snapshot === undefined) {
      lines.push(`Unavailable DSH Session: ${id} (no matching stored Session record).`)
      continue
    }
    lines.push(`DSH Session: ${id}`)
    lines.push(`Created: ${new Date(snapshot.header.createdAt).toISOString()}`)
    if (snapshot.header.cwd !== undefined) lines.push(`Session working directory: ${snapshot.header.cwd}`)
  }
  return Object.freeze(lines)
}

function parseAssociationCommand(rawInput: string): AssociationCommand | undefined {
  if (Buffer.byteLength(rawInput, 'utf8') > MAX_INPUT_BYTES) {
    if (/^(?:workspaces|sessions|link|unlink)(?:\s|$)/u.test(rawInput.trim())) {
      return { kind: 'invalid', message: `Activity context command input must not exceed ${MAX_INPUT_BYTES} bytes. ${ASSOCIATION_USAGE}` }
    }
    return undefined
  }
  const input = rawInput.trim()
  if (input === 'workspaces') return { kind: 'workspaces' }
  if (input === 'sessions') return { kind: 'sessions' }
  const association = new RegExp(`^(link|unlink)\\s+(${ID})\\s+(workspace|session)\\s+(${ID})$`, 'u').exec(input)
  if (association?.[1] !== undefined && association[2] !== undefined && association[3] !== undefined && association[4] !== undefined) {
    return {
      kind: association[1] === 'link' ? 'link' : 'unlink',
      activityId: association[2],
      contextKind: association[3] === 'workspace' ? 'workspace' : 'session',
      contextId: association[4],
    }
  }
  if (/^(?:workspaces|sessions|link|unlink)(?:\s|$)/u.test(input)) {
    return { kind: 'invalid', message: ASSOCIATION_USAGE }
  }
  return undefined
}

async function listWorkspaces(ctx: Context): Promise<CommandResult> {
  try {
    const workspaces = ctx.workspaceRegistry.list()
    if (workspaces.length === 0) return { kind: 'success', text: `No Workspaces are registered. Create one through the Workspace controls, then run /activity workspaces. ${ASSOCIATION_USAGE}` }
    const lines = ['Available Workspaces (Workspace ids identify registered directories; no Git root is inferred):']
    for (const workspace of workspaces) {
      const status = await workspace.status()
      lines.push(`Workspace: ${workspace.title} — ${workspace.id}`)
      lines.push(`Directory: ${workspace.path}`)
      lines.push(status === 'ok' ? 'Directory status: available.' : 'Directory status: unavailable.')
    }
    lines.push('', 'Select an id with /activity link <activity-id> workspace <workspace-id>.')
    return { kind: 'success', text: lines.join('\n') }
  } catch (error: unknown) {
    ctx.logger.warn('command-home-activity: Workspace catalog read failed: %o', error)
    return { kind: 'error', text: 'The Workspace catalog could not be read; no available contexts were confirmed.' }
  }
}

async function listSessions(ctx: Context): Promise<CommandResult> {
  try {
    const sessions = await ctx.sessionPersistence.list()
    if (sessions.length === 0) return { kind: 'success', text: `No stored DSH Sessions are available. ${ASSOCIATION_USAGE}` }
    const lines = ['Available DSH Sessions (select each Session independently of any Workspace):']
    for (const { header } of sessions) {
      lines.push(`DSH Session: ${header.id} — created ${new Date(header.createdAt).toISOString()}`)
      if (header.cwd !== undefined) lines.push(`Session working directory: ${header.cwd}`)
    }
    lines.push('', 'Select an id with /activity link <activity-id> session <session-id>.')
    return { kind: 'success', text: lines.join('\n') }
  } catch (error: unknown) {
    ctx.logger.warn('command-home-activity: DSH Session catalog read failed: %o', error)
    return { kind: 'error', text: 'The DSH Session catalog could not be read; no available Sessions were confirmed.' }
  }
}

async function link(ctx: Context, command: Extract<AssociationCommand, { kind: 'link' }>): Promise<CommandResult> {
  const activity = activityIdSchema.safeParse(command.activityId)
  if (!activity.success) return { kind: 'error', text: `Activity id must be a UUID. ${ASSOCIATION_USAGE}` }
  const contextId = command.contextKind === 'workspace'
    ? workspaceIdSchema.safeParse(command.contextId)
    : sessionIdSchema.safeParse(command.contextId)
  if (!contextId.success) return { kind: 'error', text: `${command.contextKind === 'workspace' ? 'Workspace id must be a UUID.' : 'Session id must be one non-whitespace token of at most 256 characters.'} ${ASSOCIATION_USAGE}` }
  try {
    const changed = command.contextKind === 'workspace'
      ? await ctx.homeActivityAssociations.linkWorkspace(ActivityId(activity.data), WorkspaceId(contextId.data))
      : await ctx.homeActivityAssociations.linkSession(ActivityId(activity.data), SessionId(contextId.data))
    const state = changed ? 'linked' : 'already linked'
    return { kind: 'success', text: `${command.contextKind === 'workspace' ? 'Workspace' : 'DSH Session'} ${command.contextId} ${state} to Activity ${activity.data}. This records a reference only; it does not start work or change permissions.` }
  } catch (error: unknown) {
    return associationFailure(ctx, error, activity.data, 'link')
  }
}

async function unlink(ctx: Context, command: Extract<AssociationCommand, { kind: 'unlink' }>): Promise<CommandResult> {
  const activity = activityIdSchema.safeParse(command.activityId)
  if (!activity.success) return { kind: 'error', text: `Activity id must be a UUID. ${ASSOCIATION_USAGE}` }
  const contextId = command.contextKind === 'workspace'
    ? workspaceIdSchema.safeParse(command.contextId)
    : sessionIdSchema.safeParse(command.contextId)
  if (!contextId.success) return { kind: 'error', text: `${command.contextKind === 'workspace' ? 'Workspace id must be a UUID.' : 'Session id must be one non-whitespace token of at most 256 characters.'} ${ASSOCIATION_USAGE}` }
  try {
    const changed = command.contextKind === 'workspace'
      ? await ctx.homeActivityAssociations.unlinkWorkspace(ActivityId(activity.data), WorkspaceId(contextId.data))
      : await ctx.homeActivityAssociations.unlinkSession(ActivityId(activity.data), SessionId(contextId.data))
    const target = command.contextKind === 'workspace' ? 'Workspace' : 'DSH Session'
    return {
      kind: 'success',
      text: changed
        ? `Removed ${target} link ${command.contextId} from Activity ${activity.data}. The Activity, ${target === 'Workspace' ? 'Workspace record' : 'Session log'} remain unchanged.`
        : `No ${target} link ${command.contextId} was saved for Activity ${activity.data}; no context was changed.`,
    }
  } catch (error: unknown) {
    return associationFailure(ctx, error, activity.data, 'unlink')
  }
}

function associationFailure(ctx: Context, error: unknown, activityId: string, operation: 'link' | 'unlink'): CommandResult {
  if (error instanceof HomeActivityAssociationError) {
    const recovery = error.code === 'unknown-activity'
      ? 'Run /activity list to choose a saved Activity id.'
      : error.code === 'unknown-workspace'
        ? 'Run /activity workspaces to choose a registered Workspace id.'
        : 'Run /activity sessions to choose a stored DSH Session id.'
    return { kind: 'error', text: error.message + ' ' + recovery }
  }
  ctx.logger.warn(`command-home-activity: ${operation} failed: %o`, error)
  if (error instanceof HomeActivityAssociationStorageError || error instanceof StorageError) {
    return {
      kind: 'error',
      text: `Activity association storage failed; no ${operation} change was confirmed. Run /activity open ${activityId} to inspect saved links before retrying.`,
    }
  }
  return {
    kind: 'error',
    text: `The selected context could not be verified; no ${operation} change was confirmed. Run /activity open ${activityId} to inspect saved links before retrying.`,
  }
}
