import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChatViewSlotProps, CommandRowOwnerProps } from '../contract/slots.ts'
import { DisclosureRow, IconApiOutlineRegular, IconChevronDownOutlineRegular, TextShimmer } from '@deepseek-ai/dsh-client-ui-primitives'
import a11yCss from './accessibility.module.css'
import css from './GenericCommandCard.module.css'

type CommandRowState = 'running' | 'ok' | 'error'

const COMMAND_ICON = <IconApiOutlineRegular size={14} />

/** Node state → row state semantic (running while unsettled; outcome kind after). */
function stateOf(outcome: CommandRowOwnerProps['node']['outcome']): CommandRowState {
  if (outcome === null) return 'running'
  return outcome.kind === 'error' ? 'error' : 'ok'
}

/** Card props: the owner payload plus the render site's locale seat (plain prop). */
export interface GenericCommandCardProps extends CommandRowOwnerProps {
  t: ChatViewSlotProps['t']
  /** Command-specific running copy; absent uses the generic command label. */
  runningSummary?: string | undefined
}

/**
 * Render a command summary and its lazily mounted multiline output.
 * @param props - command, locale, and optional running label.
 * @returns the command disclosure.
 */
export const GenericCommandCard = memo(function GenericCommandCard({ node, t, runningSummary }: GenericCommandCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [canScrollDown, setCanScrollDown] = useState(false)
  const bodyRef = useRef<HTMLPreElement>(null)
  const text = node.outcome?.text
  const summary = node.outcome === null
    ? runningSummary ?? t('command.running')
    : text ?? (node.outcome.kind === 'error' ? t('command.failed') : t('command.done'))
  // The summary already carries the settlement text, so the title is the bare
  // command name.
  const title = node.name ?? t('command.title')
  const state = stateOf(node.outcome)
  const running = state === 'running'
  const body = text !== undefined && text.includes('\n') ? text : null
  const open = expanded && body !== null
  const toggle = useCallback(() => { setExpanded(value => !value) }, [])
  useLayoutEffect(() => {
    const element = bodyRef.current
    if (!open || element === null) {
      setCanScrollDown(false)
      return
    }
    const update = (): void => {
      const next = element.scrollTop + element.clientHeight < element.scrollHeight - 1
      setCanScrollDown(previous => previous === next ? previous : next)
    }
    update()
    element.addEventListener('scroll', update)
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update)
    observer?.observe(element)
    return () => {
      element.removeEventListener('scroll', update)
      observer?.disconnect()
    }
  }, [body, open])
  const collapsedContent = useMemo(() => (
    <>
      <span className={css.separator} data-shimmer-decoration aria-hidden />
      <span className={css.summary} data-error={state === 'error' || undefined}>
        <TextShimmer>{summary}</TextShimmer>
      </span>
    </>
  ), [running, state, summary])
  const content = useMemo(() => open
    ? <div className={css.bodyWrap}>
      <pre ref={bodyRef} className={css.body} data-error={state === 'error' || undefined}
        tabIndex={0} aria-label={t('command.scrollForMore')}>{body}</pre>
      {canScrollDown && <div className={css.scrollCue} aria-hidden="true">
        <IconChevronDownOutlineRegular size={14} />
        <span>{t('command.scrollForMore')}</span>
      </div>}
    </div>
    : undefined, [body, canScrollDown, open, state, t])
  return (
    <div className={css.root} data-variant="others" data-state={state}>
      {state === 'running' && <span className={a11yCss.visuallyHidden}>{t('row.running')}</span>}
      {state === 'error' && <span className={a11yCss.visuallyHidden}>{t('row.failed')}</span>}
      <DisclosureRow
        leadingClassName={css.leading}
        titleClassName={css.title}
        icon={COMMAND_ICON}
        title={title}
        running={running}
        open={open}
        expandable={body !== null}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={toggle}
        collapsedContent={collapsedContent}
      >
        {content}
      </DisclosureRow>
    </div>
  )
})
