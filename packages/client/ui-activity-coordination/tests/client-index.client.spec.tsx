// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ActivityId } from '@deepseek-ai/dsh-home-activity/activity-types'
import type { ActivityCoordinationCatalogItem, ActivityCoordinationSessionSnapshot } from '@deepseek-ai/dsh-home-activity/coordination-types'
import type { ActivityResponsibilityId } from '@deepseek-ai/dsh-home-activity/responsibility-types'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/types'
import type { ActivityCoordinationActionInjected, ActivityCoordinationInjected } from '../src/client/slots.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'
import { CoordinateResponsibilityAction } from '../src/client/CoordinateResponsibilityAction.tsx'
import { CoordinateDialog } from '../src/client/CoordinateDialog.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => vi.restoreAllMocks())

const session = (value: string): SessionId => brandString<SessionId>(value)
const message = (value: string): MessageId => brandString<MessageId>(value)
const activityId = brandString<ActivityId>('coordination-activity')
const workspaceId = brandString<WorkspaceId>('coordination-workspace')
const targetSessionId = session('coordination-target')
const coordinatingSessionId = session('root-command')

type RegisteredCommand = {
  readonly name: string
  readonly label?: () => string
  readonly description?: () => string
  readonly available: (session: never) => boolean
  readonly ui: { readonly kind: string; readonly run: (session: never) => void }
}

describe('Activity coordination plugin entrypoints', () => {
  it('keeps the Node entry inert', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })

  it('registers the root command and Session-scoped entries and disposes per-Session state', async () => {
    const ctx = new Context()
    const calls: string[] = []
    const activityItem: ActivityCoordinationCatalogItem = {
      activity: {
        id: activityId,
        name: 'Coordination test',
        objective: 'Inspect a bounded repository task.',
        boundaries: { inScope: ['Inspect the linked Session'], outOfScope: ['Do not change files'] },
        createdAt: '2026-11-24T12:00:00.000Z',
      },
      associations: { workspaceIds: [workspaceId], sessionIds: [coordinatingSessionId, targetSessionId] },
    }
    const workspace: WorkspaceView = {
      workspaceId,
      title: 'Coordination fixture',
      path: 'C:/Projects/Coordination fixture',
      sessionIds: [targetSessionId],
      createdAt: '2026-11-24T12:00:00.000Z',
      updatedAt: '2026-11-24T12:00:00.000Z',
    }
    const targetSnapshot: ActivityCoordinationSessionSnapshot = {
      activityId,
      workspaceId,
      workspaceTitle: workspace.title,
      workspacePath: workspace.path,
      sessionId: targetSessionId,
      sessionCwd: workspace.path,
      sessionCreatedAt: Date.parse('2026-11-24T12:00:00.000Z'),
      observedAt: Date.parse('2026-11-24T12:30:00.000Z'),
      source: 'live',
      cursor: -1,
      runtime: 'loaded',
      recentMessages: [],
    }
    const activityRemote = {
      activities: vi.fn(async () => ({ ok: true as const, value: [activityItem] })),
      discover: vi.fn(async () => ({ ok: true as const, value: [targetSnapshot] })),
      responsibilities: vi.fn(async () => ({ ok: true as const, value: { items: [] } })),
      propose: vi.fn(),
      dispatchConfirmed: vi.fn(),
      reconcileResponsibility: vi.fn(),
    }
    new TestRemote(ctx, { homeActivityCoordination: activityRemote })
    ctx.provide('locale', new LocaleRuntime(ctx))
    ctx.provide('workspaces', { list: { getSnapshot: () => ({ phase: 'ready', state: 'ready', items: [workspace] }) } } as never)
    const entries = new Map<SessionId, object>()
    const modelText = 'A bounded recommendation based on this Session.'
    const assistantMessage = message('assistant-message')
    const makeBinding = (kind: string, content: readonly object[], source: string = 'model') => ({
      session: {
        beginSubmission: vi.fn(async () => ({ ok: true as const, value: undefined })),
        prompt: vi.fn(async () => ({ ok: true as const, value: undefined })),
      },
      eventSource: { getSnapshot: () => ({ entries: [{ type: 'event', event: {
        type: kind,
        seq: 17,
        data: { message: { id: assistantMessage, source: { kind: source }, content } },
      } }] }) },
    })
    entries.set(session('root-a'), makeBinding('assistant/message', [{ type: 'text', text: modelText }]))
    entries.set(session('root-long'), makeBinding('assistant/message', [{ type: 'text', text: 'a'.repeat(4_001) }]))
    entries.set(session('root-user'), makeBinding('assistant/message', [{ type: 'text', text: modelText }], 'user'))
    entries.set(session('root-empty'), makeBinding('assistant/message', [{ type: 'image', image: 'hidden' }]))
    entries.set(session('root-event'), makeBinding('user/message', [{ type: 'text', text: modelText }]))
    entries.set(coordinatingSessionId, makeBinding('assistant/message', [{ type: 'text', text: modelText }]))
    entries.set(targetSessionId, makeBinding('assistant/message', [{ type: 'text', text: 'Target Session' }]))
    ctx.provide('sessions', {
      binding: (id: SessionId) => entries.get(id),
      subagentAddress: (id: SessionId) => id === session('subagent') ? 'parent' : undefined,
    } as never)
    let command: RegisteredCommand | undefined
    ctx.provide('commandUi', {
      register: (value: RegisteredCommand) => {
        calls.push(value.name)
        command = value as never
        return () => { calls.push(`disposed:${value.name}`) }
      },
    } as never)
    await ctx.plugin(SlotRegistry).await()
    ctx.slots.register({
      name: 'root',
      children: {
        'conversation.input.overlay': { kind: 'list', scope: 'session' },
        'conversation.chat.assistant-actions': { kind: 'list', scope: 'session' },
      },
    } as never, () => null)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(calls).toEqual(['coordinate'])
    expect(command?.label?.()).toBe(en['command.label'])
    expect(command?.description?.()).toBe(en['command.description'])
    expect(command?.available({ sessionId: session('root-a') } as never)).toBe(true)
    expect(command?.available({ sessionId: session('subagent') } as never)).toBe(false)

    const actionEntry = requiredEntry(ctx.slots.entries('conversation.chat.assistant-actions'), CoordinateResponsibilityAction)
    const dialogEntry = requiredEntry(ctx.slots.entries('conversation.input.overlay'), CoordinateDialog)
    expect(actionEntry?.options).toMatchObject({ id: 'activity-coordination-proposal', order: 8 })
    expect(dialogEntry?.options).toMatchObject({ id: 'activity-coordination', order: 1 })
    const action = injectedValue(actionEntry, session('root-a'), isActionInjected)
    const rootAction = action
    expect(rootAction.available).toBe(true)
    const subagentAction = injectedValue(actionEntry, session('subagent'), isActionInjected)
    expect(subagentAction.available).toBe(false)

    const rootDialog = injectedValue(dialogEntry, session('root-a'), isCoordinationInjected)
    const beforeOpen = rootDialog.hooks.coordination.getSnapshot()
    rootAction.openProposal(assistantMessage)
    await vi.waitFor(() => expect(rootDialog.hooks.coordination.getSnapshot().phase).toBe('ready'))
    expect(rootDialog.hooks.coordination.getSnapshot().sourceMessage).toEqual({
      id: assistantMessage, eventSeq: 17, text: modelText, truncated: false,
    })
    expect(beforeOpen).not.toBe(rootDialog.hooks.coordination.getSnapshot())
    expect(activityRemote.activities).toHaveBeenCalledTimes(1)

    const longDialog = injectedValue(dialogEntry, session('root-long'), isCoordinationInjected)
    injectedValue(actionEntry, session('root-long'), isActionInjected).openProposal(assistantMessage)
    await vi.waitFor(() => expect(longDialog.hooks.coordination.getSnapshot().phase).toBe('ready'))
    expect(longDialog.hooks.coordination.getSnapshot().sourceMessage?.text).toHaveLength(4_000)
    expect(longDialog.hooks.coordination.getSnapshot().sourceMessage?.truncated).toBe(true)

    for (const invalidSession of ['root-user', 'root-empty', 'root-event', 'root-missing']) {
      const entry = injectedValue(dialogEntry, session(invalidSession), isCoordinationInjected)
      injectedValue(actionEntry, session(invalidSession), isActionInjected).openProposal(assistantMessage)
      await vi.waitFor(() => expect(entry.hooks.coordination.getSnapshot().failure).toBe('source'))
      expect(entry.hooks.coordination.getSnapshot().sourceMessage).toBeNull()
    }

    command?.ui.run({ sessionId: session('root-command') } as never)
    const commandDialog = injectedValue(dialogEntry, session('root-command'), isCoordinationInjected)
    await vi.waitFor(() => expect(commandDialog.hooks.coordination.getSnapshot().phase).toBe('ready'))
    expect(commandDialog.hooks.coordination.getSnapshot().mode).toBe('context')
    commandDialog.selectActivity(activityId)
    const candidate = commandDialog.hooks.coordination.getSnapshot().candidates[0]
    expect(candidate?.target.sessionId).toBe(targetSessionId)
    commandDialog.toggleTarget(candidate!.key, true)
    await commandDialog.discover()
    await commandDialog.addToConversation()
    expect(commandDialog.hooks.coordination.getSnapshot().phase).toBe('sent')
    commandDialog.selectProposalTarget(candidate!.key)
    commandDialog.editProposalDraft({ task: 'Inspect the linked Session.' })
    await commandDialog.proposeResponsibility()
    await commandDialog.confirmAndDispatch()
    const responsibilityId = brandString<ActivityResponsibilityId>('missing-responsibility')
    await commandDialog.reconcileResponsibility(responsibilityId)
    await commandDialog.addResponsibilityToConversation(responsibilityId)
    commandDialog.dismiss()
    await fiber.dispose()
    expect(ctx.slots.entries('conversation.input.overlay')).toHaveLength(0)
    expect(ctx.slots.entries('conversation.chat.assistant-actions')).toHaveLength(0)
    expect(calls).toContain('disposed:coordinate')
    await ctx.fiber.dispose()
  })
})

function requiredEntry(entries: readonly StoredEntry[], component: unknown): StoredEntry {
  const entry = entries.find(value => value.component === component)
  if (entry === undefined || entry.inject === undefined) throw new Error('The expected Activity coordination slot was not registered.')
  return entry
}

function injectedValue<T extends object>(
  entry: StoredEntry,
  sessionId: SessionId,
  isValue: (value: unknown) => value is T,
): T {
  const injectEntry = entry.inject
  if (injectEntry === undefined) throw new Error('The Activity coordination slot has no injection factory.')
  const value: unknown = Reflect.apply(injectEntry, undefined, [sessionId])
  if (!isValue(value)) throw new Error('The Activity coordination slot returned an invalid injected value.')
  return value
}

function isActionInjected(value: unknown): value is ActivityCoordinationActionInjected {
  return typeof value === 'object' && value !== null
    && 'available' in value && typeof value.available === 'boolean'
    && 'openProposal' in value && typeof value.openProposal === 'function'
}

function isCoordinationInjected(value: unknown): value is ActivityCoordinationInjected {
  return typeof value === 'object' && value !== null
    && 'hooks' in value && typeof value.hooks === 'object' && value.hooks !== null
    && 'coordination' in value.hooks && typeof value.hooks.coordination === 'object' && value.hooks.coordination !== null
    && 'getSnapshot' in value.hooks.coordination && typeof value.hooks.coordination.getSnapshot === 'function'
    && 'dismiss' in value && typeof value.dismiss === 'function'
    && 'selectActivity' in value && typeof value.selectActivity === 'function'
    && 'toggleTarget' in value && typeof value.toggleTarget === 'function'
    && 'discover' in value && typeof value.discover === 'function'
    && 'addToConversation' in value && typeof value.addToConversation === 'function'
    && 'selectProposalTarget' in value && typeof value.selectProposalTarget === 'function'
    && 'editProposalDraft' in value && typeof value.editProposalDraft === 'function'
    && 'proposeResponsibility' in value && typeof value.proposeResponsibility === 'function'
    && 'confirmAndDispatch' in value && typeof value.confirmAndDispatch === 'function'
    && 'reconcileResponsibility' in value && typeof value.reconcileResponsibility === 'function'
    && 'addResponsibilityToConversation' in value && typeof value.addResponsibilityToConversation === 'function'
}
