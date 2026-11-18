/** Exercise Home Activity annotation commands through the shipped headless Loader. */

import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import { createInboxStub, unsupportedModel } from '@deepseek-ai/dsh-agent-loop-testkit'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { SessionId } from '@deepseek-ai/dsh-session'
import { bootProductionProfile } from '../../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('Home Activity annotation Loader driver requires a config path')

const overlayPath = resolveConfigPath(configPath, undefined)
const contextOptions = {
  binName: 'home-activity-annotations-loader-e2e',
  profile: 'headless',
  overlayPaths: [overlayPath],
  prepare(ctx: Context) {
    ctx.provide('workspaceRegistry', { get: () => undefined, list: () => [] } as never)
  },
} as const

const firstContext = await bootProductionProfile(contextOptions)
const firstAgent = createAgent(firstContext)
let invalidInputKind = ''
const created = await execute(firstContext, firstAgent, '/activity create {"name":"Release review","objective":"Review the reported release state.","boundaries":{"inScope":["Compare current checks."],"outOfScope":["Do not release."]}}')
if (created.kind !== 'success' || created.text === undefined) throw new Error(`Activity create failed: ${created.text ?? created.kind}`)
const activityId = /ID: ([0-9a-f-]{36})/u.exec(created.text)?.[1]
if (activityId === undefined) throw new Error('Activity create did not return its stable id')

try {
  const initial = await execute(firstContext, firstAgent, `/activity annotate ${activityId} {"text":"The release appears ready based on the provider report."}`)
  if (initial.kind !== 'success') throw new Error(`Initial annotation failed: ${initial.text ?? initial.kind}`)
  const invalid = await execute(firstContext, firstAgent, `/activity annotate ${activityId} {"note":"wrong field"}`)
  if (invalid.kind !== 'error') throw new Error('Invalid annotation input was not rejected')
  invalidInputKind = invalid.kind
  const correction = await execute(firstContext, firstAgent, `/activity annotate ${activityId} {"text":"Correction: migration validation still blocks the release."}`)
  if (correction.kind !== 'success') throw new Error(`Annotation correction failed: ${correction.text ?? correction.kind}`)
  const savedHistory = firstContext.homeActivityAnnotations.list(firstContext.homeActivities.list()[0]!.id)
  if (savedHistory.length !== 2) throw new Error(`Expected two persisted revisions, found ${savedHistory.length}`)
  const firstSessionEvents = firstAgent.session.snapshotEvents()
  if (firstSessionEvents.some(event => event.type === 'turn/start' || event.type === 'turn/end')) {
    throw new Error('Direct annotation commands started model execution')
  }
} finally {
  await firstContext.fiber.dispose()
}

const reopenedContext = await bootProductionProfile(contextOptions)
try {
  const reopenedAgent = createAgent(reopenedContext)
  const opened = await execute(reopenedContext, reopenedAgent, `/activity open ${activityId}`)
  if (opened.kind !== 'success' || opened.text === undefined) throw new Error(`Activity reopen failed: ${opened.text ?? opened.kind}`)
  if (!opened.text.includes('Current annotation (revision 2): Correction: migration validation still blocks the release.')) {
    throw new Error('Restarted Loader did not recover the current annotation')
  }
  if (!opened.text.includes('The release appears ready based on the provider report.')) {
    throw new Error('Restarted Loader did not recover the earlier annotation')
  }
  if (reopenedContext.homeActivityAnnotations.list(reopenedContext.homeActivities.list()[0]!.id).length !== 2) {
    throw new Error('Restarted Loader did not retain both annotation revisions')
  }
  if (reopenedAgent.session.snapshotEvents().some(event => event.type === 'turn/start' || event.type === 'turn/end')) {
    throw new Error('Reopening an Activity started model execution')
  }
  process.stdout.write(`ANNOTATION_COMPOSITION_RESULT ${JSON.stringify({ activityId, revisions: 2, invalidInput: invalidInputKind, currentRevision: 2 })}\n`)
} finally {
  await reopenedContext.fiber.dispose()
}

function createAgent(ctx: Context): Agent {
  const session = ctx.sessions.create(SessionId(`annotation-loader-${randomUUID()}`))
  const inbox = createInboxStub()
  let status: AgentStatus = 'idle'
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    model: unsupportedModel(),
    inbox,
    ctx: new Context(),
    get status() { return status },
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject(input) { this.inbox.append('next-step', input) },
    cancel() { status = 'idle' },
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  ctx.agents.enter(agent)
  return agent
}

async function execute(ctx: Context, agent: Agent, line: string) {
  const result = await ctx.commands.execute(agent, line, [], new AbortController().signal)
  if (result === undefined) throw new Error(`Home Activity command did not resolve: ${line.split(' ', 2)[0]}`)
  return result.result
}
