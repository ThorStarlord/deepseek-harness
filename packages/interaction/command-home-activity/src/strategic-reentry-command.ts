/** Explicit, historical-only reconsideration of a saved Activity Strategic Brief.
 * @module @deepseek-ai/dsh-command-home-activity/strategic-reentry-command
 */

import { createHash, randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { ToolDefinition, ToolGuard } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-skill'
import type { ActivityId } from '@deepseek-ai/dsh-home-activity'
import {
  ActivityStrategicDeliberationError,
  ActivityStrategicDeliberationStorageError,
  activityStrategicDeliberationConclusionSchema,
} from '@deepseek-ai/dsh-home-activity/strategic-deliberations'
import type { ActivityStrategicEpisode } from '@deepseek-ai/dsh-home-activity/strategic-episodes'
import type { ActivityStrategicDeliberation } from '@deepseek-ai/dsh-home-activity/strategic-deliberations'
import { hasPendingActivityStrategicAssessment } from './strategic-command.ts'

const RECORD_TOOL = 'record_activity_strategic_deliberation'
const MAX_PENDING = 32
const REQUEST_TTL_MS = 45 * 60 * 1000
const MAX_REENTRY_CONTEXT_BYTES = 192 * 1024
const SENSEMAKING_SKILLS = ['using-sensemaking', 'strategic-repository-analysis'] as const
const REENTRY_MESSAGE_PREFIX = 'The user explicitly asked for an advisory reconsideration. Request ID: '

interface PendingDeliberation {
  readonly requestId: string
  readonly agentId: string
  readonly activityId: ActivityId
  readonly source: ActivityStrategicEpisode
  readonly decisionQuestion: string
  readonly skillDigests: readonly { readonly name: string; readonly provider: string; readonly digest: string }[]
  readonly requestedAt: string
  readonly expiresAt: number
  readonly messageId: string
  /** Removes the queued instruction when no turn has claimed it. */
  readonly removeMessage: () => void
  claimedTurn?: number
  cancelled: boolean
  saveStarted: boolean
  saved: boolean
  turnEnded: boolean
}

interface PreparingDeliberation {
  readonly agentId: string
  readonly controller: AbortController
}

interface DeliberationController {
  register(): () => void
  isActive(sessionId: string): boolean
  start(invocation: CommandInvocation, activityId: ActivityId, revision: number, question: string): Promise<CommandResult>
  cancel(invocation: CommandInvocation): CommandResult
}

/** Create command-local state for one Activity deliberation capability registration.
 * @param ctx - Host context providing Activity storage and the active Agent registry.
 * @returns The explicit start/cancel operations and registration lifecycle.
 */
export function createActivityStrategicDeliberationController(ctx: Context): DeliberationController {
  const pending = new Map<string, PendingDeliberation>()
  const preparing = new Map<string, PreparingDeliberation>()

  let disposeDrainedRegistration!: () => void
  const guard: ToolGuard = (execution) => {
    const agent = execution.agent
    if (agent === undefined) return undefined
    const sessionId = String(agent.session.id)
    const request = pending.get(sessionId)
    const setup = preparing.get(sessionId)
    if (request === undefined) {
      if (setup === undefined) return undefined
      return setup.agentId === String(agent.id)
        ? 'Activity Strategic Deliberation Skills are loading; model tool calls are blocked until setup completes or is canceled.'
        : 'An Activity Strategic Deliberation is active in this Session for another Agent; model tool calls are blocked until it ends.'
    }
    if (request.agentId !== String(agent.id)) {
      return 'An Activity Strategic Deliberation is active in this Session for another Agent; model tool calls are blocked until it ends.'
    }
    if (request.saved) return 'This Activity Strategic Deliberation is saved; no further model tool calls can run before the turn ends.'
    if (request.cancelled) return 'This Activity Strategic Deliberation was canceled or could not be confirmed; inspect saved decisions after the turn ends.'
    if (request.expiresAt <= Date.now() && !request.saveStarted) {
      request.cancelled = true
      return 'This Activity Strategic Deliberation request expired. Inspect saved decisions before starting a new request.'
    }
    return execution.name === RECORD_TOOL && !request.saveStarted ? undefined
      : 'Only the Activity Strategic Deliberation recorder is available during this explicit historical reconsideration; repository, provider, delegation, and other model tools are blocked.'
  }

  const tool = createRecorder(ctx, pending, () => disposeDrainedRegistration())
  let registeredDisposers: (() => void)[] = []
  let disposeRequested = false

  return {
    isActive: sessionId => pending.has(sessionId) || preparing.has(sessionId),
    register() {
      const disposeGuard = ctx.tools.guard(guard)
      const disposeTool = ctx.tools.register(tool, {
        when: ({ agent }) => {
          const request = pending.get(String(agent.session.id))
          return request !== undefined && request.agentId === String(agent.id)
            && request.expiresAt > Date.now() && !request.cancelled && !request.saved && !request.saveStarted
        },
      })
      const disposeEvents = ctx.root.on('session/event', (session, event) => {
        if (event.type !== 'turn/end') return
        const request = pending.get(String(session.id))
        if (request === undefined || request.claimedTurn !== event.data.turn) return
        request.turnEnded = true
        releaseSettledRequest(pending, String(session.id), request)
        disposeDrainedRegistration()
      })
      const removeStale = (agent: Agent): void => {
        if (pending.has(String(agent.session.id))) return
        for (const message of [...agent.inbox.nextStep, ...agent.inbox.nextTurn]) {
          if (message.content.some(block => block.type === 'text' && block.text.startsWith(REENTRY_MESSAGE_PREFIX)))
            agent.inbox.remove(message.id)
        }
      }
      const disposeClaimed = ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
        const request = pending.get(String(agent.session.id))
        if (request?.messageId === message.id) request.claimedTurn = turn
      })
      const disposeDiscarded = ctx.on('agent/inbox/discarded', ({ agent, message }) => {
        const sessionId = String(agent.session.id)
        const request = pending.get(sessionId)
        if (request?.messageId !== message.id) return
        request.cancelled = true
        if (request.saveStarted) return
        pending.delete(sessionId)
        disposeDrainedRegistration()
      })
      const disposeAgent = ctx.on('agent/disposed', ({ agent }) => {
        const sessionId = String(agent.session.id)
        const request = pending.get(sessionId)
        if (request === undefined) return
        request.cancelled = true
        request.turnEnded = true
        if (request.saveStarted) return
        request.removeMessage()
        pending.delete(sessionId)
        disposeDrainedRegistration()
      })
      for (const agent of ctx.agents.list()) removeStale(agent)
      const disposeCreated = ctx.on('agent/created', ({ agent }) => {
        removeStale(agent)
        return undefined
      })
      registeredDisposers = [disposeTool, disposeEvents, disposeGuard, disposeClaimed, disposeDiscarded, disposeAgent, disposeCreated]
      disposeDrainedRegistration = (): void => {
        if (!disposeRequested || pending.size > 0 || preparing.size > 0) return
        const disposers = registeredDisposers
        registeredDisposers = []
        for (const dispose of disposers) dispose()
        pending.clear()
      }
      return () => {
        disposeRequested = true
        for (const setup of preparing.values()) setup.controller.abort()
        for (const [sessionId, request] of pending) {
          if (request.saved || request.saveStarted) continue
          if (request.claimedTurn !== undefined) {
            request.cancelled = true
            continue
          }
          request.removeMessage()
          pending.delete(sessionId)
        }
        disposeDrainedRegistration()
      }
    },
    start: async (invocation, activityId, revision, question) => {
      const agent = invocation.agent
      if (ctx.agents.get(agent.id) !== agent) {
        return { kind: 'error', text: 'Strategic reconsideration requires the live requesting Agent.' }
      }
      const activity = ctx.homeActivities.get(activityId)
      if (activity === undefined) return { kind: 'error', text: `No saved Activity has id ${activityId}.` }
      const source = ctx.homeActivityStrategicEpisodes.list(activityId).find(episode => episode.revision === revision)
      if (source === undefined) return { kind: 'error', text: `Activity ${activityId} has no saved strategic brief revision ${revision}.` }
      const sessionId = String(agent.session.id)
      prune(pending, disposeDrainedRegistration)
      if (hasPendingActivityStrategicAssessment(ctx, sessionId)) {
        return { kind: 'error', text: 'This Session already has an unfinished Activity Strategic Brief assessment.' }
      }
      if (pending.has(sessionId) || preparing.has(sessionId)) {
        return { kind: 'error', text: 'This Session already has an unfinished Activity Strategic Deliberation.' }
      }
      if (pending.size + preparing.size >= MAX_PENDING) {
        return { kind: 'error', text: 'Too many Activity Strategic Deliberations are waiting for this application.' }
      }
      const skillRegistry = ctx.get('skills')
      if (skillRegistry === undefined) {
        return { kind: 'error', text: 'The DSH Skill registry is unavailable to this application profile. No reconsideration was started.' }
      }

      const setup: PreparingDeliberation = { agentId: String(agent.id), controller: new AbortController() }
      preparing.set(sessionId, setup)
      const signal = AbortSignal.any([invocation.signal, setup.controller.signal])
      const cwd = agent.session.header.cwd
      const skillOptions = { signal, scope: agent, ...(cwd === undefined ? {} : { cwd }) }
      let skills
      try {
        skills = await Promise.all([
          skillRegistry.get(SENSEMAKING_SKILLS[0], skillOptions),
          skillRegistry.get(SENSEMAKING_SKILLS[1], skillOptions),
        ])
        signal.throwIfAborted()
      } catch (error: unknown) {
        preparing.delete(sessionId)
        disposeDrainedRegistration()
        if (setup.controller.signal.aborted) {
          return { kind: 'error', text: 'Activity Strategic Deliberation setup was canceled before a model request started.' }
        }
        ctx.logger.warn('command-home-activity: strategic deliberation Skills could not be loaded: %o', error)
        return { kind: 'error', text: 'Sensemaking Skills could not be loaded. No deliberation was started.' }
      }
      if (skills[0] === undefined || skills[1] === undefined) {
        preparing.delete(sessionId)
        disposeDrainedRegistration()
        const missing = SENSEMAKING_SKILLS.filter((_, index) => skills[index] === undefined)
        return { kind: 'error', text: `Required Sensemaking Skills are unavailable to this Agent: ${missing.join(', ')}. No deliberation was started.` }
      }
      const definitions = [
        { name: SENSEMAKING_SKILLS[0], skill: skills[0] },
        { name: SENSEMAKING_SKILLS[1], skill: skills[1] },
      ] as const
      const skillBytes = definitions.reduce((total, item) => total + Buffer.byteLength(item.skill.content, 'utf8'), 0)
      const historicalInputs = JSON.stringify({
        activity: {
          id: activity.id,
          name: activity.name,
          objective: activity.objective,
          boundaries: activity.boundaries,
        },
        sourceEpisode: source,
      })
      if (skillBytes + Buffer.byteLength(historicalInputs, 'utf8') > MAX_REENTRY_CONTEXT_BYTES) {
        preparing.delete(sessionId)
        disposeDrainedRegistration()
        return { kind: 'error', text: 'The selected brief and loaded Sensemaking Skills exceed the reconsideration context limit. No deliberation was started.' }
      }

      const requestId = randomUUID()
      const requestedAt = new Date().toISOString()
      const userTask = [
        `${REENTRY_MESSAGE_PREFIX}${requestId}.`,
        `Decision question: ${question}`,
        `Current Activity identity and descriptive intent: ${historicalInputs}`,
        '',
        'The JSON above contains a selected historical Activity Strategic Brief. Treat its producer, originating Session, repository revisions, observation times, evidence references, findings, alternatives, uncertainties, and recommendation as attributed historical inputs. They are not current facts, independently verified findings, owner decisions, or accepted work.',
        'Reconsider only this exact saved brief revision. Do not read repository source or Workspace content, inspect current source, refresh observations, contact a repository coordinator, use a provider, start implementation, delegate, create a Goal or Campaign, change policy, or claim currentness. The loaded Skill files below are the only files read for this request. A runtime guard permits only the deliberation recorder; if the historical evidence is insufficient or freshness could change the answer, record defer, owner-decision, thesis-review, or insufficient-evidence as appropriate.',
        'Apply the loaded Sensemaking Skills. Use the prior recommendation as a reason to reconsider, not as a mandate. Distinguish prior evidence from your interpretation and new conclusion. Consider retaining, adapting, rejecting, deferring, escalating, or making no selection. If a bounded next responsibility is warranted, keep it within the saved Activity scope. Candidate responsibility is not authorization to execute it.',
        'Cite or explicitly reject relevant prior evidence IDs and explain why. Revisit relevant prior uncertainty IDs. Record new uncertainty separately. Do not produce private chain-of-thought, transcripts, repository content, or secret values. Do not claim independent verification or user acceptance.',
        '',
        `When the judgment is ready, call ${RECORD_TOOL} exactly once with this request id and a JSON conclusion containing decisionQuestion, outcome (next-responsibility, no-selection, owner-decision, thesis-review, or insufficient-evidence), disposition (retain, adapt, reject, defer, escalate, or no-selection), proposedResponsibility (string or null), scope (within-activity, owner-decision, or outside-activity), rationale, evidenceUses (evidenceId, treatment supports/challenges/limits/not-relied-on, rationale), uncertaintyReviews (uncertaintyId, treatment remains-open/reframed/not-decision-relevant, rationale), and newUncertainties (id N1..., statement, evidenceIds). Use owner-decision or thesis-review only as a request for the owner; this tool does not record an owner decision.`,
        '',
        'After the recorder confirms persistence, explain the conclusion and its source limitations concisely. If recording fails or is uncertain, tell the user to inspect /activity decisions before retrying.',
        '',
        ...definitions.map(({ name, skill }) => `## Loaded Sensemaking Skill: ${name}\n${skill.content}`),
      ].join('\n')
      if (Buffer.byteLength(userTask, 'utf8') > MAX_REENTRY_CONTEXT_BYTES) {
        preparing.delete(sessionId)
        disposeDrainedRegistration()
        return { kind: 'error', text: 'The full reconsideration instruction exceeds the context limit. No model request was started.' }
      }
      preparing.delete(sessionId)
      disposeDrainedRegistration()
      const message = createUserMessage({ content: [{ type: 'text', text: userTask }], source: { kind: 'user' } })
      const request: PendingDeliberation = {
        requestId,
        agentId: String(agent.id),
        activityId,
        source,
        decisionQuestion: question,
        skillDigests: Object.freeze(definitions.map(({ name, skill }) => Object.freeze({
          name,
          provider: skill.provider,
          digest: createHash('sha256').update(skill.content).digest('hex'),
        }))),
        requestedAt,
        expiresAt: Date.now() + REQUEST_TTL_MS,
        messageId: message.id,
        removeMessage: () => { agent.inbox.remove(message.id) },
        cancelled: false,
        saveStarted: false,
        saved: false,
        turnEnded: false,
      }
      pending.set(sessionId, request)
      try {
        agent.steer(message)
      } catch (error: unknown) {
        request.removeMessage()
        pending.delete(sessionId)
        disposeDrainedRegistration()
        ctx.logger.warn('command-home-activity: strategic deliberation could not be queued: %o', error)
        return { kind: 'error', text: 'Activity Strategic Deliberation was not queued. No repository read or execution was started.' }
      }
      return {
        kind: 'success',
        text: `Historical reconsideration queued for Activity ${activityId}, brief revision ${source.revision}. No repository source or registered Workspace content was read; the required Skill files were loaded into this Session, no fresh source state was checked, and no execution or delegation was started. The result will be an advisory record; use /activity decisions ${activityId} to inspect it.`,
      }
    },
    cancel: (invocation) => {
      const agent = invocation.agent
      if (ctx.agents.get(agent.id) !== agent) return { kind: 'error', text: 'Canceling strategic reconsideration requires the live requesting Agent.' }
      const sessionId = String(agent.session.id)
      const request = pending.get(sessionId)
      if (request !== undefined && request.agentId === String(agent.id)) {
        if (request.saved) {
          return { kind: 'success', text: 'This Activity Strategic Deliberation is already saved. Inspect /activity decisions; it cannot be canceled.' }
        }
        if (request.saveStarted) {
          return { kind: 'error', text: 'The deliberation save has started and cannot be canceled safely. Inspect /activity decisions before retrying.' }
        }
        if (request.claimedTurn === undefined) {
          request.removeMessage()
          pending.delete(sessionId)
          disposeDrainedRegistration()
          return { kind: 'success', text: 'Canceled the pending reconsideration before a turn claimed it. Its queued message was removed, no record will be saved, and no execution was started.' }
        }
        request.cancelled = true
        return { kind: 'success', text: 'Canceled the pending reconsideration record. An active model turn may still finish, but the recorder and execution tools remain blocked. No record will be saved and no execution was started.' }
      }
      const setup = preparing.get(sessionId)
      if (setup === undefined || setup.agentId !== String(agent.id)) {
        return { kind: 'success', text: 'No unfinished Activity Strategic Deliberation is waiting in this Session.' }
      }
      setup.controller.abort()
      return { kind: 'success', text: 'Canceled strategic reconsideration setup. No model request, repository read, or record was started.' }
    },
  }
}

function createRecorder(
  ctx: Context,
  pending: Map<string, PendingDeliberation>,
  onSettled: () => void,
): ToolDefinition {
  return {
    name: RECORD_TOOL,
    description: 'Append the advisory reconsideration for the one explicit historical Activity brief request. This never authorizes or starts work.',
    parameters: {
      requestId: { type: 'string', required: true, description: 'Opaque id from the explicit /activity consider request.' },
      conclusionJson: { type: 'string', required: true, description: 'Structured advisory conclusion using only references from the selected historical brief.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false, required: ['saved', 'deliberationId', 'revision', 'recordedAt'],
        properties: {
          saved: { type: 'boolean' }, deliberationId: { type: 'string' }, revision: { type: 'integer' }, recordedAt: { type: 'string' },
        },
      },
      render: (_args, value) => {
        if (!isRecord(value) || value.saved !== true || typeof value.deliberationId !== 'string'
          || typeof value.revision !== 'number' || typeof value.recordedAt !== 'string') {
          return [{ type: 'text', text: 'Activity Strategic Deliberation result could not be confirmed. Inspect /activity decisions before relying on it.' }]
        }
        return [{
          type: 'text',
          text: `Saved advisory reconsideration ${value.deliberationId} (revision ${value.revision}) at ${value.recordedAt}. It is not an owner decision, independently verified, or accepted.`,
        }]
      },
    },
    async execute(rawArgs, execution) {
      const args = parseRecorderArguments(rawArgs)
      const agent = execution.agent
      if (agent === undefined || ctx.agents.get(agent.id) !== agent) {
        throw new Error('Activity Strategic Deliberation recording requires the live requesting Agent')
      }
      const sessionId = String(agent.session.id)
      const request = pending.get(sessionId)
      if (request === undefined || request.agentId !== String(agent.id) || request.requestId !== args.requestId
        || request.expiresAt <= Date.now() || request.cancelled || request.saved || request.saveStarted) {
        throw new Error('Activity Strategic Deliberation recording does not match a live explicit request')
      }
      if (Buffer.byteLength(args.conclusionJson, 'utf8') > 64 * 1024) {
        throw new Error('Activity Strategic Deliberation JSON exceeds the 64 KiB limit')
      }
      let decoded: unknown
      try {
        decoded = JSON.parse(args.conclusionJson)
      } catch (error: unknown) {
        void error
        throw new Error('Activity Strategic Deliberation must be valid JSON')
      }
      const conclusion = activityStrategicDeliberationConclusionSchema.safeParse(decoded)
      if (!conclusion.success) {
        throw new Error(`Activity Strategic Deliberation was not saved: ${conclusion.error.issues.map(issue => issue.message).join('; ')}`)
      }
      if (conclusion.data.decisionQuestion.trim() !== request.decisionQuestion.trim()) {
        throw new Error('Activity Strategic Deliberation must preserve the explicitly requested decision question')
      }
      request.saveStarted = true
      try {
        const saved = await ctx.homeActivityStrategicDeliberations.record({
          ...conclusion.data,
          activityId: request.activityId,
          originSessionId: String(agent.session.id),
          requestId: request.requestId,
          sourceEpisodeId: request.source.id,
          sourceEpisodeRevision: request.source.revision,
          skillDigests: request.skillDigests,
          requestedAt: request.requestedAt,
        })
        request.saved = true
        request.saveStarted = false
        releaseSettledRequest(pending, sessionId, request)
        onSettled()
        return { saved: true, deliberationId: saved.id, revision: saved.revision, recordedAt: saved.recordedAt }
      } catch (error: unknown) {
        request.saveStarted = false
        request.cancelled = true
        releaseSettledRequest(pending, sessionId, request)
        onSettled()
        if (error instanceof ActivityStrategicDeliberationError || error instanceof ActivityStrategicDeliberationStorageError) {
          throw new Error(`${error.message} Inspect /activity decisions before retrying.`)
        }
        ctx.logger.warn('command-home-activity: strategic deliberation save failed')
        throw new Error('Activity Strategic Deliberation could not be confirmed in storage. Inspect /activity decisions before retrying.')
      }
    },
  }
}

function releaseSettledRequest(
  pending: Map<string, PendingDeliberation>,
  sessionId: string,
  request: PendingDeliberation,
): void {
  if (request.turnEnded && !request.saveStarted && pending.get(sessionId) === request) pending.delete(sessionId)
}

function prune(pending: Map<string, PendingDeliberation>, onSettled: () => void): void {
  const now = Date.now()
  for (const [sessionId, request] of pending) {
    if (request.expiresAt > now || request.saveStarted || request.saved) continue
    if (request.claimedTurn !== undefined) {
      request.cancelled = true
      continue
    }
    request.removeMessage()
    pending.delete(sessionId)
  }
  onSettled()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseRecorderArguments(value: unknown): { readonly requestId: string; readonly conclusionJson: string } {
  if (!isRecord(value)) throw new Error('Activity Strategic Deliberation arguments must be an object')
  const { requestId, conclusionJson } = value
  if (Object.keys(value).length !== 2 || typeof requestId !== 'string' || typeof conclusionJson !== 'string') {
    throw new Error('Activity Strategic Deliberation arguments require only string requestId and conclusionJson fields')
  }
  return { requestId, conclusionJson }
}

/** Render a saved deliberation with its exact source episode and historical limits.
 * @param deliberation - Saved agent-authored advisory decision.
 * @param source - Exact source episode, if it remains readable.
 * @returns User-visible lines for the recovered decision.
 */
export function renderActivityStrategicDeliberation(
  deliberation: ActivityStrategicDeliberation,
  source: ActivityStrategicEpisode | undefined,
): string[] {
  const sourceCommand = `/activity brief ${deliberation.activityId} ${deliberation.sourceEpisodeRevision}`
  const sourceStatus = source === undefined
    ? `The original brief is unavailable; stored source brief ${deliberation.sourceEpisodeId}, revision ${deliberation.sourceEpisodeRevision}, remains recorded.`
    : `Source brief ${source.id}, revision ${source.revision}; recorded ${source.recordedAt}; source Session ${source.originSessionId}. Repository state has not been re-read.`
  const requested = deliberation.outcome === 'owner-decision' || deliberation.outcome === 'thesis-review' ? ' requested' : ''
  return [
    `Activity Strategic Deliberation ${deliberation.revision} (agent-authored advisory; not an owner decision, independently verified, or accepted):`,
    `Recorded ${deliberation.recordedAt}; requesting Session ${deliberation.originSessionId}.`,
    'Authority: this is advice only; it does not authorize or start work, change Activity scope, or grant permissions.',
    sourceStatus,
    `Decision question: ${deliberation.decisionQuestion}`,
    `Outcome: ${deliberation.outcome}${requested}; prior recommendation disposition: ${deliberation.disposition}.`,
    `Proposed responsibility: ${deliberation.proposedResponsibility ?? 'none selected'} (${deliberation.scope}).`,
    `Rationale: ${deliberation.rationale}`,
    'Historical evidence considered:',
    ...(deliberation.evidenceUses.length === 0 ? ['- No prior evidence identifier was cited.'] : deliberation.evidenceUses.map((use) => {
      const reference = source?.evidence.find(item => item.id === use.evidenceId)
      return `- ${use.evidenceId} (${use.treatment}): ${use.rationale}${reference === undefined ? '' : ` — ${reference.workspaceId}@${reference.revision} ${reference.path}${reference.lineStart === undefined ? '' : `:${reference.lineStart}`} — ${reference.note}`}`
    })),
    'Prior uncertainties:',
    ...(deliberation.uncertaintyReviews.length === 0 ? ['- No prior uncertainty was revisited.'] : deliberation.uncertaintyReviews.map((review) => {
      const uncertainty = source?.uncertainties.find(item => item.id === review.uncertaintyId)
      return `- ${review.uncertaintyId} (${review.treatment}): ${review.rationale}${uncertainty === undefined ? '' : ` — ${uncertainty.statement}`}`
    })),
    'New uncertainties:',
    ...(deliberation.newUncertainties.length === 0
      ? ['- None recorded.']
      : deliberation.newUncertainties.map(item => `- ${item.id}: ${item.statement} [Historical evidence: ${item.evidenceIds.join(', ') || 'none'}]`)),
    `Freshness: this reconsideration used the saved brief only. Current repositories, source files, and changed observations were not checked. Retrieve the original brief with ${sourceCommand}.`,
  ]
}
