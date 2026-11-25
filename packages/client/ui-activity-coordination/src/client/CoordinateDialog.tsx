/** Activity selection, read-only Session preview, and explicit context sharing. */

import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ActivityCoordinationProps } from './slots.ts'
import { ActivityResponsibilityDialog } from './ActivityResponsibilityDialog.tsx'
import { ActivityResponsibilityHistory } from './ActivityResponsibilityHistory.tsx'
import css from './CoordinateDialog.module.css'

/** Render one Activity's linked Session selection and snapshot preview. */
export function CoordinateDialog({
  useCoordination, dismiss, selectActivity, toggleTarget, discover, addToConversation,
  selectProposalTarget, editProposalDraft, proposeResponsibility, confirmAndDispatch, reconcileResponsibility,
  addResponsibilityToConversation, t,
}: ActivityCoordinationProps) {
  const state = useCoordination(value => value)
  if (state.mode === 'responsibility') {
    return (
      <ActivityResponsibilityDialog
        state={state}
        dismiss={dismiss}
        selectActivity={selectActivity}
        selectProposalTarget={selectProposalTarget}
        editProposalDraft={editProposalDraft}
        proposeResponsibility={proposeResponsibility}
        confirmAndDispatch={confirmAndDispatch}
        reconcileResponsibility={reconcileResponsibility}
        addResponsibilityToConversation={addResponsibilityToConversation}
        t={t}
      />
    )
  }
  const selectedActivity = state.activities.find(item => item.activity.id === state.selectedActivityId)?.activity
  const selectedCount = state.selectedKeys.length
  const canPreview = state.phase === 'ready' && state.selectedActivityId !== null && selectedCount > 0
  const canAdd = state.phase === 'discovered' && state.snapshots.length > 0
  const busy = state.phase === 'loading' || state.phase === 'discovering' || state.phase === 'sending'
  const status = state.phase === 'loading'
    ? t('status.loading')
    : state.phase === 'discovering'
      ? t('preview.loading')
      : state.phase === 'sending'
        ? t('add.loading')
        : state.phase === 'sent'
          ? t('add.done')
          : state.failure === 'load'
            ? t('status.unavailable')
            : state.failure === 'discover'
              ? t('error.context')
              : state.failure === 'add'
                ? t('add.uncertain')
                : state.failure === 'history'
                  ? t('responsibility.error.history')
                  : state.failure === 'reconcile'
                    ? t('responsibility.error.reconcile')
                    : state.selectedActivityId === null
                      ? t('status.selectActivity')
                      : selectedCount === 0
                        ? t('status.selectTargets')
                        : state.snapshots.length === 0
                          ? t('status.noSnapshot')
                          : ''

  return (
    <Modal
      open={state.open}
      title={t('dialog.title')}
      description={t('dialog.description')}
      closeLabel={t('close')}
      onClose={dismiss}
      className={css.dialog as string}
      contentClassName={css.content as string}
      footer={(
        <div className={css.footer}>
          <Button variant="outline" disabled={busy} onClick={dismiss}>{t('cancel')}</Button>
          {canAdd ? (
            <Button variant="primary" disabled={busy} onClick={() => { void addToConversation() }}>
              {t('add.button')}
            </Button>
          ) : (
            <Button variant="primary" disabled={!canPreview || busy} onClick={() => { void discover() }}>
              {state.phase === 'discovering' ? t('preview.loading') : t('preview.button')}
            </Button>
          )}
        </div>
      )}
    >
      <div className={css.body}>
        <label className={css.activityField}>
          <span>{t('activity.label')}</span>
          <select
            value={state.selectedActivityId ?? ''}
            disabled={busy || state.activities.length === 0}
            onChange={(event) => { selectActivity(event.target.value) }}
          >
            <option value="" disabled>{t('status.selectActivity')}</option>
            {state.activities.map(({ activity }) => (
              <option key={activity.id} value={activity.id}>{t('activity.option', { name: activity.name, id: activity.id })}</option>
            ))}
          </select>
        </label>

        {state.activities.length === 0 && state.phase === 'ready' && state.failure === null && (
          <p className={css.empty}>{t('activity.empty')}</p>
        )}
        {selectedActivity !== undefined && (
          <section className={css.objective} aria-label={t('activity.objective')}>
            <h3>{t('activity.objective')}</h3>
            <p className={css.identity}>{t('activity.identity', { id: selectedActivity.id })}</p>
            <p>{selectedActivity.objective}</p>
          </section>
        )}

        {state.selectedActivityId !== null && (
          <fieldset className={css.targets} disabled={busy || state.phase === 'sent'}>
            <legend>{t('targets.label')}</legend>
            {state.candidates.length === 0 ? (
              <p className={css.empty}>{t('targets.empty')}</p>
            ) : (
              <div className={css.targetList}>
                {state.candidates.map((candidate) => {
                  const checked = state.selectedKeys.includes(candidate.key)
                  const atLimit = !checked && selectedCount >= 16
                  const label = t('target.checkbox', {
                    workspace: candidate.workspace.title,
                    session: candidate.target.sessionId,
                  })
                  return (
                    <label key={candidate.key} className={css.target}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={atLimit}
                        aria-label={label}
                        onChange={(event) => { toggleTarget(candidate.key, event.target.checked) }}
                      />
                      <span className={css.targetCopy}>
                        <span className={css.workspace}>{candidate.workspace.title}</span>
                        <span className={css.sessionId}>{candidate.workspace.workspaceId}</span>
                        <span className={css.sessionId}>{candidate.target.sessionId}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
            )}
            <p className={css.count} aria-live="polite">{t('targets.count', { selected: selectedCount })}</p>
            {selectedCount >= 16 && <p className={css.limit}>{t('status.limit')}</p>}
          </fieldset>
        )}

        {status !== '' && <p className={state.failure === null ? css.status : css.error} role={state.failure === null ? 'status' : 'alert'}>{status}</p>}

        {state.snapshots.length > 0 && (
          <section className={css.preview} aria-label={t('preview.heading')}>
            <h3>{t('preview.heading')}</h3>
            <p className={css.trust}>{t('preview.trust')}</p>
            <div className={css.previewList}>
              {state.snapshots.map(snapshot => (
                <details key={`${snapshot.workspaceId}:${snapshot.sessionId}`} className={css.snapshot} open>
                  <summary>
                    <span>{snapshot.workspaceTitle}</span>
                    <span className={css.sessionId}>{snapshot.sessionId}</span>
                  </summary>
                  <div className={css.metadata}>
                    <span>{t('preview.identities', { activity: snapshot.activityId, workspace: snapshot.workspaceId })}</span>
                    <span>{t('preview.observed', { time: new Date(snapshot.observedAt).toLocaleString() })}</span>
                    <span>{t('preview.cursor', { cursor: JSON.stringify(snapshot.cursor) })}</span>
                    <span>{t('preview.runtime', { runtime: snapshot.runtime })}</span>
                    <span>{t('preview.source', { source: snapshot.source })}</span>
                    <span>{t('preview.path', { path: snapshot.workspacePath })}</span>
                    <span>{t('preview.created', { time: new Date(snapshot.sessionCreatedAt).toLocaleString() })}</span>
                  </div>
                  {snapshot.recentMessages.length === 0
                    ? <p className={css.empty}>{t('preview.noMessages')}</p>
                    : (
                      <ol className={css.messages}>
                        {snapshot.recentMessages.map(message => (
                          <li key={`${message.eventSeq}:${message.role}`}>
                            <div className={css.messageMeta}>
                              <span>{t('preview.message', {
                                role: message.role,
                                seq: message.eventSeq,
                                time: new Date(message.time).toLocaleString(),
                              })}</span>
                              {message.provider !== undefined && message.model !== undefined && (
                                <span>{t('preview.provider', { provider: message.provider, model: message.model })}</span>
                              )}
                              {message.truncated && <span>{t('preview.truncated')}</span>}
                            </div>
                            <blockquote className={css.messageText}>{message.text}</blockquote>
                          </li>
                        ))}
                      </ol>
                    )}
                </details>
              ))}
            </div>
          </section>
        )}

        {state.phase === 'sent' && <p className={css.status} role="status">{t('add.done')}</p>}
        {state.selectedActivityId !== null && (
          <ActivityResponsibilityHistory
            state={state}
            t={t}
            reconcile={reconcileResponsibility}
            addToConversation={addResponsibilityToConversation}
          />
        )}
      </div>
    </Modal>
  )
}
