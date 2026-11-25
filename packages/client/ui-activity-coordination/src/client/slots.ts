/** Injected values and callbacks for the Activity coordination overlay. */

import type { InjectFace, PropsLocale, HostObservable, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { ActivityResponsibilityId } from '@deepseek-ai/dsh-home-activity/responsibility-types'
import type {} from './locales.ts'
import type { ActivityCoordinationState, ActivityResponsibilityDraft } from './surface.ts'

/** Business callbacks and observable state for one coordinator Session. */
export interface ActivityCoordinationInjected {
  /** The current state source; the renderer binds it as `useCoordination`. */
  hooks: { coordination: HostObservable<ActivityCoordinationState> }
  /** Close the panel. */
  dismiss: () => void
  /** Select one saved Activity. */
  selectActivity: (activityId: string) => void
  /** Toggle one authorized Workspace/Session candidate. */
  toggleTarget: (key: string, selected: boolean) => void
  /** Read the selected Sessions through the authenticated Host Remote. */
  discover: () => Promise<void>
  /** Add the reviewed snapshot to this coordinator Session as a user message. */
  addToConversation: () => Promise<void>
  /** Select the one target Session whose bounded responsibility will be proposed. */
  selectProposalTarget: (key: string) => void
  /** Edit a user-visible responsibility field before saving the proposal. */
  editProposalDraft: (draft: Partial<Omit<ActivityResponsibilityDraft, 'targetKey'>>) => void
  /** Save the advisory proposal attributed to the selected coordinator message. */
  proposeResponsibility: () => Promise<void>
  /** Confirm and send the exact immutable proposal through the authenticated Host route. */
  confirmAndDispatch: () => Promise<void>
  /** Passively observe and reconcile one saved responsibility. */
  reconcileResponsibility: (responsibilityId: ActivityResponsibilityId) => Promise<void>
  /** Add one selected historical responsibility to this coordinator Session as a user message. */
  addResponsibilityToConversation: (responsibilityId: ActivityResponsibilityId) => Promise<void>
}

/** Full props of the `conversation.input.overlay` entry. */
export type ActivityCoordinationProps = InjectFace<ActivityCoordinationInjected> & PropsLocale<'activityCoordination'>

/** Injected callback for one finalized coordinator assistant message. */
export interface ActivityCoordinationActionInjected {
  /** Open the proposal flow for this message only when it is model-authored and durably present. */
  openProposal: (messageId: MessageId) => void
  /** Whether this Session can act as a root coordinator. */
  available: boolean
}

/** Full props of one finalized assistant-message responsibility action. */
export type ActivityCoordinationActionProps =
  PropsRuntime<'conversation.chat.assistant-actions'>
  & InjectFace<ActivityCoordinationActionInjected>
  & PropsLocale<'activityCoordination'>
