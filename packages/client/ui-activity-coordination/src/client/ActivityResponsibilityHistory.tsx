/** Recovered advisory responsibility facts and explicit passive reconciliation. */

import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ActivityResponsibilityFact, ActivityResponsibilityHistory as ResponsibilityHistory } from '@deepseek-ai/dsh-home-activity/responsibility-types'
import type { ActivityCoordinationState } from './surface.ts'
import type { ActivityCoordinationProps } from './slots.ts'
import css from './CoordinateDialog.module.css'

/** Render append-only responsibility history without resuming or retrying target work.
 * @param props - recovered facts and an explicit passive reconcile action.
 * @returns the Activity history view, or nothing when no responsibility has been saved.
 */
export function ActivityResponsibilityHistory({
  state, t, reconcile, addToConversation,
}: Pick<ActivityCoordinationProps, 't'> & {
  readonly state: ActivityCoordinationState
  readonly reconcile: (responsibilityId: ResponsibilityHistory['id']) => Promise<void>
  readonly addToConversation: (responsibilityId: ResponsibilityHistory['id']) => Promise<void>
}) {
  if (state.historyLoading) return <p className={css.status} role="status">{t('responsibility.history.loading')}</p>
  if (state.failure === 'history') return <p className={css.error} role="alert">{t('responsibility.error.history')}</p>
  if (state.histories.length === 0) return null
  return (
    <section className={css.history} aria-label={t('responsibility.history.heading')}>
      <h3>{t('responsibility.history.heading')}</h3>
      <div className={css.historyList}>
        {state.histories.map(history => (
          <details key={history.id} className={css.historyItem}>
            <summary>
              <span>{history.proposal.proposal.task}</span>
              <span className={css.sessionId}>{history.id}</span>
            </summary>
            <div className={css.historyBody}>
              <p>{t('responsibility.history.target', {
                workspace: history.proposal.proposal.target.workspaceId,
                session: history.proposal.proposal.target.sessionId,
              })}</p>
              <p className={css.identity}>{t('responsibility.history.activity', { id: history.activityId })}</p>
              <ol className={css.facts}>
                {history.facts.map(fact => <HistoryFact key={fact.id} fact={fact} t={t} />)}
              </ol>
              <TargetStatusReports
                reports={state.statusReports.filter(report => report.responsibilityId === history.id)}
                t={t}
              />
              <ResponsibilityShareAction history={history} state={state} t={t} addToConversation={addToConversation} />
              {history.facts.some(fact => fact.kind === 'dispatch-attempted') && (
                <Button
                  variant="outline"
                  disabled={state.reconciling.includes(history.id)}
                  onClick={() => { void reconcile(history.id) }}
                >
                  {state.reconciling.includes(history.id) ? t('responsibility.reconcile.loading') : t('responsibility.reconcile.button')}
                </Button>
              )}
              <ReconcileStatus history={history} state={state} t={t} />
            </div>
          </details>
        ))}
      </div>
    </section>
  )
}

function TargetStatusReports({
  reports, t,
}: {
  readonly reports: NonNullable<ActivityCoordinationState['statusReports']>
  readonly t: ActivityCoordinationProps['t']
}) {
  if (reports.length === 0) return null
  return (
    <section className={css.facts} aria-label={t('responsibility.progress.heading')}>
      <h4>{t('responsibility.progress.heading')}</h4>
      <p>{t('responsibility.progress.notice')}</p>
      <ol>
        {reports.map(report => (
          <li key={report.id} className={css.fact}>
            <strong>{t(`responsibility.progress.${report.status}`)}</strong>
            <time dateTime={report.recordedAt}>{new Date(report.recordedAt).toLocaleString()}</time>
            <p>{t('responsibility.progress.source', { session: report.targetSessionId, event: String(report.sourceEventSeq) })}</p>
            <blockquote>{report.summary}</blockquote>
          </li>
        ))}
      </ol>
    </section>
  )
}

function ResponsibilityShareAction({
  history, state, t, addToConversation,
}: Pick<ActivityCoordinationProps, 't'> & {
  readonly history: ResponsibilityHistory
  readonly state: ActivityCoordinationState
  readonly addToConversation: (responsibilityId: ResponsibilityHistory['id']) => Promise<void>
}) {
  const share = state.historyShares.find(item => item.responsibilityId === history.id)
  const disabled = share !== undefined || state.historyShares.some(item => item.status === 'sending')
  const label = share?.status === 'sending'
    ? t('responsibility.history.share.loading')
    : t('responsibility.history.share.button')
  return (
    <>
      <Button variant="outline" disabled={disabled} onClick={() => { void addToConversation(history.id) }}>
        {label}
      </Button>
      {share !== undefined && share.status !== 'sending' && (
        <p className={share.status === 'uncertain' ? css.error : css.status} role={share.status === 'uncertain' ? 'alert' : 'status'}>
          {t(`responsibility.history.share.${share.status}`)}
        </p>
      )}
    </>
  )
}

function HistoryFact({ fact, t }: { readonly fact: ActivityResponsibilityFact; readonly t: ActivityCoordinationProps['t'] }) {
  return (
    <li className={css.fact}>
      <strong>{factLabel(fact, t)}</strong>
      <time dateTime={fact.recordedAt}>{new Date(fact.recordedAt).toLocaleString()}</time>
      {fact.kind === 'proposed' && <p>{t('responsibility.history.source', {
        session: fact.source.sessionId,
        event: fact.source.eventSeq === undefined ? t('responsibility.none') : String(fact.source.eventSeq),
      })}</p>}
      {fact.kind === 'confirmed' && <p>{t('responsibility.history.confirmed')}</p>}
      {fact.kind === 'dispatch-attempted' && <p>{t('responsibility.history.prompt', { id: fact.promptRequestId })}</p>}
      {fact.kind === 'dispatch-settled' && <p>{dispatchOutcome(fact.outcome, t)}</p>}
      {fact.kind === 'observed' && <p>{fact.observation.status === 'available'
        ? t('responsibility.history.observation', {
          active: String(fact.observation.active),
          running: String(fact.observation.running),
          cursor: String(fact.observation.cursor),
        })
        : t('responsibility.history.unavailable', { reason: fact.observation.reason })}</p>}
      {fact.kind === 'reported' && <>
        <p>{t('responsibility.history.reportSource', { target: fact.targetSessionId, events: fact.sourceEventSeqs.join(', ') })}</p>
        <blockquote>{fact.summary}</blockquote>
      </>}
      {fact.kind === 'verification-recorded' && <>
        <p>{t('responsibility.history.verification', { result: fact.evidence.result, source: fact.evidence.source })}</p>
        <blockquote>{fact.evidence.summary}</blockquote>
      </>}
      {fact.kind === 'acceptance-recorded' && <p>{acceptanceLabel(fact.disposition, t)}</p>}
    </li>
  )
}

function ReconcileStatus({
  history, state, t,
}: { readonly history: ResponsibilityHistory; readonly state: ActivityCoordinationState; readonly t: ActivityCoordinationProps['t'] }) {
  const result = state.reconcileResults.find(item => item.history.id === history.id)
  return result === undefined ? null : <p className={css.status} role="status">{reconcileLabel(result.reportState, t)}</p>
}

function factLabel(fact: ActivityResponsibilityFact, t: ActivityCoordinationProps['t']): string {
  switch (fact.kind) {
    case 'proposed': return t('responsibility.fact.proposed')
    case 'confirmed': return t('responsibility.fact.confirmed')
    case 'dispatch-attempted': return t('responsibility.fact.dispatch-attempted')
    case 'dispatch-settled': return t('responsibility.fact.dispatch-settled')
    case 'observed': return t('responsibility.fact.observed')
    case 'reported': return t('responsibility.fact.reported')
    case 'verification-recorded': return t('responsibility.fact.verification-recorded')
    case 'acceptance-recorded': return t('responsibility.fact.acceptance-recorded')
  }
}

function dispatchOutcome(outcome: 'accepted' | 'not-admitted' | 'uncertain', t: ActivityCoordinationProps['t']): string {
  switch (outcome) {
    case 'accepted': return t('responsibility.outcome.accepted')
    case 'not-admitted': return t('responsibility.outcome.not-admitted')
    case 'uncertain': return t('responsibility.outcome.uncertain')
  }
}

function acceptanceLabel(disposition: 'accepted' | 'declined' | 'requires-follow-up', t: ActivityCoordinationProps['t']): string {
  switch (disposition) {
    case 'accepted': return t('responsibility.acceptance.accepted')
    case 'declined': return t('responsibility.acceptance.declined')
    case 'requires-follow-up': return t('responsibility.acceptance.requires-follow-up')
  }
}

function reconcileLabel(
  state: 'no-dispatch' | 'awaiting-target-input' | 'awaiting-turn-end' | 'no-completed-response' | 'reported',
  t: ActivityCoordinationProps['t'],
): string {
  switch (state) {
    case 'no-dispatch': return t('responsibility.reconcile.no-dispatch')
    case 'awaiting-target-input': return t('responsibility.reconcile.awaiting-target-input')
    case 'awaiting-turn-end': return t('responsibility.reconcile.awaiting-turn-end')
    case 'no-completed-response': return t('responsibility.reconcile.no-completed-response')
    case 'reported': return t('responsibility.reconcile.reported')
  }
}
