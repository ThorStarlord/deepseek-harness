/** Activity-scoped Session discovery and explicit context sharing in the Web client. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { CommandUiContract } from '@deepseek-ai/dsh-client-ui-commands/client'
import { IconDataOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only imports assemble the Client Context and Conversation slot faces.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import { CoordinateDialog } from './CoordinateDialog.tsx'
import type { ActivityCoordinationActionInjected, ActivityCoordinationInjected } from './slots.ts'
import { CoordinateResponsibilityAction } from './CoordinateResponsibilityAction.tsx'
import { ActivityCoordinationSurface } from './surface.ts'
import { en, es, fr, de, ja, pt, ru, zh } from './locales.ts'

export type { ActivityCoordinationActionInjected, ActivityCoordinationActionProps, ActivityCoordinationInjected, ActivityCoordinationProps } from './slots.ts'
export type {
  ActivityCoordinationCandidate, ActivityCoordinationRemote, ActivityCoordinationSourceMessage, ActivityCoordinationState,
  ActivityResponsibilityDraft,
  ActivityCoordinationSurfaceOptions,
} from './surface.ts'
export type { ActivityCoordinationKey } from './locales.ts'

/** Localized command and dialog dictionary namespace. */
const NS = 'activityCoordination'

/** Services required by the Web surface and message action. */
export const inject = [
  'commandUi', 'locale', 'remote', 'remote.homeActivityCoordination', 'sessions', 'slots', 'workspaces',
]

/** Register `/coordinate`, the Activity modal, and proposal actions on model messages.
 * @param ctx - Client root context with authenticated coordination remotes.
 * @returns nothing; registrations follow the Client context lifetime.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-activity-coordination: dictionaries')
  const translate = ctx.locale.bind(NS)
  const surfaces = new Map<SessionId, ActivityCoordinationSurface>()

  const surfaceFor = (sessionId: SessionId): ActivityCoordinationSurface => {
    let surface = surfaces.get(sessionId)
    if (surface === undefined) {
      surface = new ActivityCoordinationSurface({
        remote: ctx.remote.homeActivityCoordination,
        workspaces: ctx.workspaces.list,
        coordinatorSession: () => ctx.sessions.binding(sessionId)?.session,
        coordinatorSessionId: sessionId,
        responsibilityHistoryPreamble: translate('responsibility.history.reentryContext'),
        sourceMessage: messageId => sourceMessageFrom(ctx.sessions.binding(sessionId), messageId),
      })
      surfaces.set(sessionId, surface)
    }
    return surface
  }

  ctx.effect(() => () => {
    for (const surface of surfaces.values()) surface.dispose()
    surfaces.clear()
  }, 'ui-activity-coordination: per-session surfaces')

  ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
    name: 'conversation.input.overlay',
    id: 'activity-coordination',
    order: 1,
    locale: NS,
    inject: (sessionId): ActivityCoordinationInjected => {
      const surface = surfaceFor(sessionId)
      return {
        hooks: { coordination: surface.state },
        dismiss: () => { surface.dismiss() },
        selectActivity: (activityId) => { surface.selectActivity(activityId) },
        toggleTarget: (key, selected) => { surface.toggleTarget(key, selected) },
        discover: () => surface.discover(),
        addToConversation: () => surface.addToConversation(),
        selectProposalTarget: (key) => { surface.selectProposalTarget(key) },
        editProposalDraft: (draft) => { surface.editProposalDraft(draft) },
        proposeResponsibility: () => surface.proposeResponsibility(),
        confirmAndDispatch: () => surface.confirmAndDispatch(),
        reconcileResponsibility: responsibilityId => surface.reconcileResponsibility(responsibilityId),
        addResponsibilityToConversation: responsibilityId => surface.addResponsibilityToConversation(responsibilityId),
      }
    },
  }, CoordinateDialog))

  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions',
    id: 'activity-coordination-proposal',
    order: 8,
    locale: NS,
    inject: (sessionId): ActivityCoordinationActionInjected => ({
      available: ctx.sessions.subagentAddress(sessionId) === undefined,
      openProposal: (messageId) => { void surfaceFor(sessionId).openProposalFromMessage(messageId) },
    }),
  }, CoordinateResponsibilityAction))

  ctx.inject(['commandUi'], (scope: ClientContext) => {
    const command = scope.get('commandUi') as CommandUiContract
    scope.effect(() => command.register({
      name: 'coordinate',
      label: () => translate('command.label'),
      description: () => translate('command.description'),
      icon: IconDataOutlineRegular,
      available: session => ctx.sessions.subagentAddress(session.sessionId) === undefined,
      ui: {
        kind: 'action',
        run: (session) => { void surfaceFor(session.sessionId).open() },
      },
    }), 'ui-activity-coordination: /coordinate command')
  })
}

/** Resolve one model-authored message from the selected Session's loaded event window.
 * @param binding - current coordinator Session binding, when it still exists.
 * @param messageId - durable assistant-message identity supplied by the action row.
 * @returns source sequence and bounded text, or undefined when the message is not in the window.
 */
function sourceMessageFrom(binding: SessionBinding | undefined, messageId: MessageId) {
  const entry = binding?.eventSource.getSnapshot().entries.find((item) => {
    if (item.type !== 'event' || item.event.type !== 'assistant/message') return false
    return item.event.data.message.id === messageId && item.event.data.message.source.kind === 'model'
  })
  if (entry?.type !== 'event' || entry.event.type !== 'assistant/message') return undefined
  const text = entry.event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
  if (text.trim().length === 0) return undefined
  const characters = Array.from(text)
  return {
    id: messageId,
    eventSeq: entry.event.seq,
    text: characters.slice(0, 4_000).join(''),
    truncated: characters.length > 4_000,
  }
}
