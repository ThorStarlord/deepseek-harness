/** Open a bounded responsibility proposal from one durable assistant message. */

import { IconPlusOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ActivityCoordinationActionProps } from './slots.ts'
import css from './CoordinateResponsibilityAction.module.css'

/** Render an explicit responsibility-proposal action for one root coordinator message.
 * @param props - message identity and the injected proposal action.
 * @returns one accessible action button, or nothing for a non-root Session.
 */
export function CoordinateResponsibilityAction({ messageId, available, openProposal, t }: ActivityCoordinationActionProps) {
  if (!available) return null
  const label = t('responsibility.action')
  return (
    <Tooltip label={label} side="bottom">
      <button type="button" className={css.action} aria-label={label} onClick={() => { openProposal(messageId) }}>
        <IconPlusOutlineRegular />
      </button>
    </Tooltip>
  )
}
