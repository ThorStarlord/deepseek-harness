/** Activity responsibility proposal, exact confirmation, and dispatch view. */

import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ActivityCoordinationProps } from './slots.ts'
import type { ActivityCoordinationState } from './surface.ts'
import { ActivityResponsibilityHistory } from './ActivityResponsibilityHistory.tsx'
import css from './CoordinateDialog.module.css'

/** Render one selected assistant recommendation as an editable proposal and exact confirmation.
 * @param props - current coordination state and explicit proposal/dispatch actions.
 * @returns the Activity-scoped responsibility modal.
 */
export function ActivityResponsibilityDialog({
  state, dismiss, selectActivity, selectProposalTarget, editProposalDraft, proposeResponsibility,
  confirmAndDispatch, reconcileResponsibility, addResponsibilityToConversation, t,
}: Pick<ActivityCoordinationProps,
  'dismiss' | 'selectActivity' | 'selectProposalTarget' | 'editProposalDraft' | 'proposeResponsibility' | 'confirmAndDispatch' | 'reconcileResponsibility' | 'addResponsibilityToConversation' | 't'
> & { readonly state: ActivityCoordinationState }) {
  const activity = state.activities.find(item => item.activity.id === state.selectedActivityId)
  const selectedTarget = state.candidates.find(candidate => candidate.key === state.responsibilityDraft.targetKey)
  const proposal = state.proposalFact?.proposal
  const busy = state.phase === 'loading' || state.responsibilityPhase === 'saving' || state.responsibilityPhase === 'dispatching'
  const canSave = state.responsibilityPhase === 'draft'
    && state.sourceMessage !== null
    && activity !== undefined
    && selectedTarget !== undefined
    && validDraft(state)
  const addFailure = state.failure === 'proposal'
    ? t('responsibility.error.proposal')
    : state.failure === 'coordinator-unlinked'
      ? t('responsibility.error.coordinator')
      : state.failure === 'dispatch'
        ? t('responsibility.error.dispatch')
        : state.failure === 'source'
          ? t('responsibility.error.source')
          : state.failure === 'history'
            ? t('responsibility.error.history')
            : state.failure === 'reconcile'
              ? t('responsibility.error.reconcile')
              : ''

  return (
    <Modal
      open={state.open && state.mode === 'responsibility'}
      title={t('responsibility.dialog.title')}
      description={state.responsibilityPhase === 'confirm'
        ? t('responsibility.confirm.dialog-description')
        : t('responsibility.dialog.description')}
      closeLabel={t('close')}
      onClose={dismiss}
      className={css.dialog as string}
      contentClassName={css.content as string}
      footer={(
        <div className={css.footer}>
          <Button variant="outline" disabled={busy} onClick={dismiss}>{t('cancel')}</Button>
          {state.responsibilityPhase === 'draft' && (
            <Button variant="primary" disabled={!canSave || busy} onClick={() => { void proposeResponsibility() }}>
              {busy ? t('responsibility.proposal.saving') : t('responsibility.proposal.save')}
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
            disabled={busy || state.responsibilityPhase !== 'draft' || state.activities.length === 0}
            onChange={(event) => { selectActivity(event.target.value) }}
          >
            <option value="" disabled>{t('status.selectActivity')}</option>
            {state.activities.map(({ activity: item }) => (
              <option key={item.id} value={item.id}>{t('activity.option', { name: item.name, id: item.id })}</option>
            ))}
          </select>
        </label>

        {state.phase === 'loading' && <p className={css.status} role="status">{t('status.loading')}</p>}
        {state.phase === 'ready' && state.failure === 'load' && <p className={css.error} role="alert">{t('status.unavailable')}</p>}
        {activity !== undefined && (
          <section className={css.objective} aria-label={t('activity.objective')}>
            <h3>{t('activity.objective')}</h3>
            <p className={css.identity}>{t('activity.identity', { id: activity.activity.id })}</p>
            <p>{activity.activity.objective}</p>
          </section>
        )}

        {state.sourceMessage !== null && (
          <section className={css.source} aria-label={t('responsibility.source.heading')}>
            <h3>{t('responsibility.source.heading')}</h3>
            <p className={css.sessionId}>{t('responsibility.source.identity', {
              id: state.sourceMessage.id,
              seq: state.sourceMessage.eventSeq,
            })}</p>
            {state.sourceMessage.truncated && <p className={css.status}>{t('preview.truncated')}</p>}
            <p className={css.trust}>{t('responsibility.source.trust')}</p>
            <blockquote className={css.messageText}>{state.sourceMessage.text}</blockquote>
          </section>
        )}

        {state.selectedActivityId !== null && state.responsibilityPhase === 'draft' && (
          <fieldset className={css.targets} disabled={busy}>
            <legend>{t('responsibility.target.label')}</legend>
            {state.candidates.length === 0 ? (
              <p className={css.empty}>{t('targets.empty')}</p>
            ) : (
              <div className={css.targetList}>
                {state.candidates.map(candidate => (
                  <label key={candidate.key} className={css.target}>
                    <input
                      type="radio"
                      name="activity-responsibility-target"
                      checked={state.responsibilityDraft.targetKey === candidate.key}
                      aria-label={t('target.checkbox', { workspace: candidate.workspace.title, session: candidate.target.sessionId })}
                      onChange={() => { selectProposalTarget(candidate.key) }}
                    />
                    <span className={css.targetCopy}>
                      <span className={css.workspace}>{candidate.workspace.title}</span>
                      <span className={css.sessionId}>{candidate.target.workspaceId}</span>
                      <span className={css.sessionId}>{candidate.target.sessionId}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        )}

        {state.responsibilityPhase === 'draft' && (
          <section className={css.form} aria-label={t('responsibility.proposal.heading')}>
            <h3>{t('responsibility.proposal.heading')}</h3>
            <label className={css.field}>
              <span>{t('responsibility.field.task')}</span>
              <input
                maxLength={4_000}
                value={state.responsibilityDraft.task}
                onChange={(event) => { editProposalDraft({ task: event.target.value }) }}
              />
            </label>
            <label className={css.field}>
              <span>{t('responsibility.field.inScope')}</span>
              <textarea
                rows={3}
                maxLength={32_100}
                value={state.responsibilityDraft.inScopeText}
                onChange={(event) => { editProposalDraft({ inScopeText: event.target.value }) }}
              />
            </label>
            <label className={css.field}>
              <span>{t('responsibility.field.outOfScope')}</span>
              <textarea
                rows={2}
                maxLength={32_100}
                value={state.responsibilityDraft.outOfScopeText}
                onChange={(event) => { editProposalDraft({ outOfScopeText: event.target.value }) }}
              />
            </label>
            <label className={css.field}>
              <span>{t('responsibility.field.expected')}</span>
              <input
                maxLength={2_000}
                value={state.responsibilityDraft.expectedOutcome}
                onChange={(event) => { editProposalDraft({ expectedOutcome: event.target.value }) }}
              />
            </label>
            <label className={css.field}>
              <span>{t('responsibility.field.prerequisites')}</span>
              <textarea
                rows={2}
                maxLength={32_100}
                value={state.responsibilityDraft.prerequisitesText}
                onChange={(event) => { editProposalDraft({ prerequisitesText: event.target.value }) }}
              />
            </label>
            <label className={css.field}>
              <span>{t('responsibility.field.conflicts')}</span>
              <textarea
                rows={2}
                maxLength={32_100}
                value={state.responsibilityDraft.conflictingWorkText}
                onChange={(event) => { editProposalDraft({ conflictingWorkText: event.target.value }) }}
              />
            </label>
          </section>
        )}

        {state.responsibilityPhase === 'saving' && <p className={css.status} role="status">{t('responsibility.proposal.saving')}</p>}
        {state.responsibilityPhase === 'confirm' && proposal !== undefined && state.proposalFact !== null && (
          <ProposalConfirmation
            proposal={proposal}
            activityId={state.proposalFact.activityId}
            responsibilityId={state.proposalFact.responsibilityId}
            targetTitle={selectedTarget?.workspace.title}
            confirmAndDispatch={confirmAndDispatch}
            t={t}
          />
        )}
        {state.responsibilityPhase === 'dispatching' && <p className={css.status} role="status">{t('responsibility.dispatching')}</p>}
        {state.responsibilityPhase === 'dispatched' && state.dispatchResult !== null && (
          <p className={css.status} role="status">
            {state.dispatchResult.outcome === 'accepted'
              ? t('responsibility.outcome.accepted')
              : t('responsibility.outcome.not-admitted')}
          </p>
        )}
        {state.responsibilityPhase === 'uncertain' && (
          <p className={css.error} role="alert">
            {state.dispatchResult?.recorded === false
              ? t('responsibility.outcome.history-unconfirmed')
              : t('responsibility.outcome.uncertain')}
          </p>
        )}
        {addFailure !== '' && <p className={css.error} role="alert">{addFailure}</p>}
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

function ProposalConfirmation({
  proposal, activityId, responsibilityId, targetTitle, confirmAndDispatch, t,
}: Pick<ActivityCoordinationProps, 'confirmAndDispatch' | 't'> & {
  readonly proposal: NonNullable<ActivityCoordinationState['proposalFact']>['proposal']
  readonly activityId: ActivityCoordinationState['selectedActivityId']
  readonly responsibilityId: NonNullable<ActivityCoordinationState['proposalFact']>['responsibilityId']
  readonly targetTitle: string | undefined
}) {
  return (
    <section className={css.confirmation} aria-label={t('responsibility.confirm.heading')}>
      <h3>{t('responsibility.confirm.heading')}</h3>
      <p className={css.trust}>{t('responsibility.confirm.notice')}</p>
      <p className={css.identity}>{t('responsibility.confirm.identity', { activity: activityId, responsibility: responsibilityId })}</p>
      <p>{t('responsibility.confirm.target', {
        workspace: proposal.target.workspaceId,
        workspaceTitle: targetTitle ?? proposal.target.workspaceId,
        session: proposal.target.sessionId,
      })}</p>
      <dl className={css.proposalDetails}>
        <dt>{t('responsibility.field.task')}</dt><dd>{proposal.task}</dd>
        <dt>{t('responsibility.field.inScope')}</dt><dd>{proposal.inScope.join('\n')}</dd>
        <dt>{t('responsibility.field.outOfScope')}</dt><dd>{proposal.outOfScope.length === 0 ? t('responsibility.none') : proposal.outOfScope.join('\n')}</dd>
        <dt>{t('responsibility.field.expected')}</dt><dd>{proposal.expectedOutcome}</dd>
        <dt>{t('responsibility.field.prerequisites')}</dt><dd>{proposal.prerequisites.length === 0 ? t('responsibility.none') : proposal.prerequisites.join('\n')}</dd>
        <dt>{t('responsibility.field.conflicts')}</dt><dd>{proposal.conflictingWork.length === 0 ? t('responsibility.none') : proposal.conflictingWork.join('\n')}</dd>
      </dl>
      <div className={css.confirmationActions}>
        <Button variant="primary" onClick={() => { void confirmAndDispatch() }}>
          {t('responsibility.confirm.button')}
        </Button>
      </div>
    </section>
  )
}

function validDraft(state: ActivityCoordinationState): boolean {
  const lines = (value: string): string[] => value.split(/\r?\n/u).map(line => line.trim()).filter(Boolean)
  const task = state.responsibilityDraft.task.trim()
  const expected = state.responsibilityDraft.expectedOutcome.trim()
  const scope = lines(state.responsibilityDraft.inScopeText)
  const outOfScope = lines(state.responsibilityDraft.outOfScopeText)
  const prerequisites = lines(state.responsibilityDraft.prerequisitesText)
  const conflicts = lines(state.responsibilityDraft.conflictingWorkText)
  return task.length > 0 && task.length <= 4_000
    && expected.length > 0 && expected.length <= 2_000
    && scope.length > 0 && scope.length <= 32 && scope.every(line => line.length <= 1_000)
    && outOfScope.length <= 32 && outOfScope.every(line => line.length <= 1_000)
    && prerequisites.length <= 32 && prerequisites.every(line => line.length <= 1_000)
    && conflicts.length <= 32 && conflicts.every(line => line.length <= 1_000)
}
