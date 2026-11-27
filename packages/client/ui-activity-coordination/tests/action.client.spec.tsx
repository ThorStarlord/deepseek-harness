// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ActivityCoordinationActionProps } from '../src/client/slots.ts'
import { CoordinateResponsibilityAction } from '../src/client/CoordinateResponsibilityAction.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(en, commonEn)
const messageId = brandString<MessageId>('model-message-1')
const unused = (): never => { throw new Error('The action does not read standard Session props.') }
const standardProps = {
  useSession: unused,
  sessionId: brandString<SessionId>('coordinator-session'),
  useProjection: unused,
  useAccess: () => false,
  useConversation: unused,
  useInput: unused,
  inputActions: {
    insertQuote: unused,
    captureInsertion: unused,
    insertText: unused,
    setDraft: unused,
    persistDraft: unused,
    addAttachments: unused,
    removeAttachment: unused,
    pruneAttachments: unused,
    submit: unused,
  },
  useChat: unused,
  useTrajectory: unused,
  useSessions: unused,
  useSessionStatus: unused,
  useSessionRetainInfo: unused,
  useSessionAccess: () => false,
  useRemoteAccess: () => false,
  useWorkspaces: unused,
  useWorkspaceAccess: () => false,
  useResource: unused,
  useContextMenu: unused,
  usePanelInfo: unused,
} satisfies Omit<ActivityCoordinationActionProps, 'available' | 'messageId' | 'openProposal' | 't'>

describe('CoordinateResponsibilityAction', () => {
  it('omits the action for a non-root Session', () => {
    const openProposal = vi.fn()
    const ui = render(
      <CoordinateResponsibilityAction
        {...standardProps}
        available={false}
        messageId={messageId}
        openProposal={openProposal}
        t={t}
      />,
    )
    expect(ui.container.firstChild).toBeNull()
    expect(openProposal).not.toHaveBeenCalled()
  })

  it('opens a proposal for the exact assistant message when available', () => {
    const openProposal = vi.fn()
    const ui = render(
      <CoordinateResponsibilityAction
        {...standardProps}
        available
        messageId={messageId}
        openProposal={openProposal}
        t={t}
      />,
    )
    const button = ui.getByRole('button', { name: en['responsibility.action'] })
    fireEvent.click(button)
    expect(openProposal).toHaveBeenCalledExactlyOnceWith(messageId)
  })
})
