import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { LlmAdapter, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import * as SessionPersistenceJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import CommandRuntime, { CommandId } from '@deepseek-ai/dsh-commands'
import type { CommandInvocation } from '@deepseek-ai/dsh-commands'
import Storage, { StorageError } from '@deepseek-ai/dsh-storage'
import { NO_START_CAPABILITIES } from '@deepseek-ai/dsh-subagent'
import type {
  ResolvedSubagentStartRequest,
  SubagentActivation,
  SubagentActivationSpec,
  SubagentProvider,
  SubagentResult,
  SubagentRun,
} from '@deepseek-ai/dsh-subagent'
import { SubagentRunId } from '@deepseek-ai/dsh-subagent'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import HomeActivityService from '@deepseek-ai/dsh-home-activity'
import HomeActivityAssociationService from '@deepseek-ai/dsh-home-activity/associations'
import HomeActivityArtifactService from '@deepseek-ai/dsh-home-activity/artifacts'
import HomeActivityDelegations, { ActivityDelegationError } from '@deepseek-ai/dsh-home-activity/delegations'
import type { ActivityDelegation, ActivityDelegationUncertainty } from '@deepseek-ai/dsh-home-activity/delegations'
import * as commandHomeActivity from '../src/index.ts'
import { executeActivityDelegation, renderActivityDelegation } from '../src/delegation-command.ts'

const roots: string[] = []
const contexts: Context[] = []
const releaseChildren: (() => void)[] = []

afterEach(async () => {
  for (const release of releaseChildren.splice(0)) release()
  const disposed = await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  const failure = disposed.find(result => result.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
})

interface ScriptEntry {
  readonly chunks: readonly StreamChunk[]
  readonly gate?: Promise<undefined>
  readonly started?: () => void
  readonly error?: Error
}

/** Deterministic model transport used behind the production `spawn` provider. */
class DelegationAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly script: ScriptEntry[]) {
    super()
  }

  override providerRetryPolicy() {
    return resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'Home Activity delegation test')
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const entry = this.script.shift()
    if (entry === undefined) throw new Error('delegation test adapter script exhausted')
    entry.started?.()
    if (entry.gate !== undefined) await entry.gate
    if (entry.error !== undefined) throw entry.error
    for (const chunk of entry.chunks) yield chunk
  }
}

class TestSessionQuery extends SessionQueryEngine {
  override searchSessions(): Promise<never> {
    return Promise.reject(new Error('session search is not configured in this test'))
  }

  override searchEvents(): Promise<never> {
    return Promise.reject(new Error('event search is not configured in this test'))
  }
}

class FixtureWorkingDirectory extends Service {
  private readonly directories = new WeakMap<Session, string>()

  constructor(ctx: Context) {
    super(ctx, 'workingDirectory')
  }

  get(session: Session): string {
    return this.directories.get(session) ?? session.header.cwd ?? process.cwd()
  }

  async ensure(agent: Agent, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    return this.get(agent.session)
  }

  async set(agent: Agent, path: string, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    this.directories.set(agent.session, path)
    return path
  }
}

function textResponse(text: string, reason: 'stop' | 'max-tokens' = 'stop'): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: reason } },
  ]
}

async function harness(adapter: DelegationAdapter) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-delegation-e2e-')); roots.push(root)
  const ctx = new Context(); contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SessionPersistenceJsonl, { root: join(root, 'sessions'), compression: 'none' })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(FixtureWorkingDirectory)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'activity') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(HomeActivityService)
  await ctx.plugin(HomeActivityDelegations)
  ctx.provide('workspaceRegistry', { get: () => undefined, list: () => [] } as never)
  await ctx.plugin(HomeActivityAssociationService)
  await ctx.plugin(HomeActivityArtifactService)
  await ctx.plugin(commandHomeActivity)
  ctx.llm.registerAdapter(['mock'], adapter)
  const parent = await ctx.agentLoop.create(SessionId(`activity-parent-${randomUUID()}`), {
    provider: 'mock', model: 'mock',
  })
  return { ctx, parent, root }
}

async function run(ctx: Context, parent: Agent, input: string) {
  const execution = await ctx.commands.execute(parent, `/activity${input}`, [], new AbortController().signal)
  if (execution === undefined) throw new Error('/activity was not registered')
  return execution.result
}

async function waitForReported(ctx: Context, id: string): Promise<void> {
  await vi.waitFor(() => {
    const record = ctx.homeActivityDelegations.list(ctx.homeActivities.list()[0]!.id)
      .find(item => item.id === id)
    expect(record?.status).toBe('reported')
  }, { timeout: 10_000 })
}

function fakeActivation(
  ctx: Context,
  spec: SubagentActivationSpec,
  result: Promise<SubagentResult>,
  emitRunId: boolean,
): SubagentActivation {
  const childId = spec.childId ?? SessionId(`child-${randomUUID()}`)
  if (emitRunId) {
    const run = (id: string, parentSessionId: string, provider: string, runId: string) => {
      ctx.emit('subagent/start', {
        id: SessionId(id),
        parentSessionId: SessionId(parentSessionId),
        provider,
        runId: SubagentRunId(runId),
        local: true,
      })
    }
    run('different-child', spec.parent.session.id, 'spawn', 'ignored-child')
    run(childId, 'different-parent', 'spawn', 'ignored-parent')
    run(childId, spec.parent.session.id, 'other-provider', 'ignored-provider')
    run(childId, spec.parent.session.id, 'spawn', 'run-exact')
  }
  return { childId, name: spec.name ?? 'activity-test', result, dispose: async () => {} }
}

it('starts the real DSH spawn provider from `/activity`, then records success and failure as provider reports', async () => {
  const started = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  releaseChildren.push(() => { release.resolve(undefined) })
  const adapter = new DelegationAdapter([
    { chunks: textResponse('The migration section needs one upgrade command.'), gate: release.promise, started: () => { started.resolve(undefined) } },
    { chunks: [], error: new Error('deterministic provider failure') },
  ])
  const { ctx, parent } = await harness(adapter)
  const activity = await ctx.homeActivities.create({
    name: 'Release readiness',
    objective: 'Prepare the next release for review.',
    boundaries: { inScope: ['Review release notes.'], outOfScope: ['Do not publish.'] },
  })

  const admitted = await run(ctx, parent, ` delegate ${activity.id} spawn Review release notes for missing migration steps.`)

  expect(admitted.kind, admitted.text).toBe('success')
  expect(admitted.text).toContain('Delegation admitted: provider spawn')
  expect(admitted.text).toContain('Requested task: Review release notes for missing migration steps.')
  expect(admitted.text).toContain(`Requesting Session: ${parent.session.id}`)
  expect(admitted.text).toContain('Activity scope does not restrict child tools or permissions; DSH active runtime policy controls access.')
  expect(admitted.text).toContain('not yet available, verified, or accepted')
  await started.promise

  const initialRecord = ctx.homeActivityDelegations.list(activity.id)[0]
  expect(initialRecord).toMatchObject({ status: 'admitted', request: { provider: 'spawn' } })
  const initialAdmission = initialRecord?.admission
  if (initialAdmission === undefined || initialAdmission.provider === 'codex') {
    throw new Error('The spawn activation has no DSH child Session admission.')
  }
  expect(initialAdmission.childSessionId).toBeDefined()
  expect(initialAdmission.activationName).toMatch(/^activity-[a-f0-9]{8}$/u)
  expect(initialAdmission.runId).toBeDefined()
  const pending = await run(ctx, parent, ` open ${activity.id}`)
  expect(pending.text).toContain('Status: admitted; not verified or accepted.')
  expect(pending.text).toContain('Provider outcome is pending')
  expect(pending.text).toContain('Activity scope does not restrict child tools or permissions; DSH active runtime policy controls access.')

  release.resolve(undefined)
  await waitForReported(ctx, initialRecord!.id)
  const reportedSuccess = await run(ctx, parent, ` open ${activity.id}`)
  expect(reportedSuccess.text).toContain('Status: provider reported; not verified or accepted.')
  expect(reportedSuccess.text).toContain('Provider-reported output: The migration section needs one upgrade command.')
  expect(reportedSuccess.text).toContain(`Child Session: ${initialAdmission.childSessionId}`)
  expect(reportedSuccess.text).toContain(`Activation run: ${initialAdmission.runId}`)

  const failed = await run(ctx, parent, ` delegate ${activity.id} spawn Check the release checklist for missing verification.`)
  expect(failed.kind).toBe('success')
  const failureRequestId = /Delegation (?:admitted|admitted but not durably confirmed):/u.test(failed.text ?? '')
    ? ctx.homeActivityDelegations.list(activity.id)[0]!.id
    : undefined
  expect(failureRequestId).toBeDefined()
  await waitForReported(ctx, failureRequestId!)
  const reportedFailure = await run(ctx, parent, ` open ${activity.id}`)
  expect(reportedFailure.text).toContain('Provider stop reason: error')
  expect(reportedFailure.text).toContain('not verified or accepted')
  expect(adapter.requests).toHaveLength(2)
  expect(parent.session.snapshotEvents().filter(event => event.type === 'turn/start' || event.type === 'turn/end')).toEqual([])
  expect(parent.session.snapshotEvents().filter(event => event.type.startsWith('goal/'))).toEqual([])
})

it('rejects malformed delegation commands before saving or starting work', async () => {
  const adapter = new DelegationAdapter([])
  const { ctx, parent } = await harness(adapter)
  const activity = await ctx.homeActivities.create({
    name: 'Command validation',
    objective: 'Validate delegation command inputs.',
    boundaries: { inScope: ['Check command parsing.'], outOfScope: ['Start work.'] },
  })
  const start = vi.spyOn(ctx.subagents, 'startActivation')
  const malformed = await run(ctx, parent, ' delegate')
  const invalidId = await run(ctx, parent, ' delegate nope spawn inspect the checklist')
  const unsupportedProvider = await run(ctx, parent, ` delegate ${activity.id} external inspect the checklist`)
  const invocation: CommandInvocation = {
    commandId: CommandId('delegation-test'),
    agent: parent,
    rawInput: '',
    attachments: [],
    signal: new AbortController().signal,
  }
  const invalidGrammar = await executeActivityDelegation(ctx, invocation, 'spawn')
  const emptyTask = await executeActivityDelegation(ctx, invocation, `${activity.id} spawn   `)
  const oversizedUtf8 = await run(ctx, parent, ` delegate ${activity.id} spawn ${'€'.repeat(1_400)}`)
  const missingActivity = await run(ctx, parent, ' delegate 00000000-0000-4000-8000-000000000099 spawn inspect the checklist')

  expect(malformed.text).toContain('Usage: /activity create <JSON>')
  expect(invalidGrammar.text).toContain('Usage: /activity delegate')
  expect(invalidId.text).toContain('Activity id must be a UUID')
  expect(unsupportedProvider.text).toContain('Choose spawn or codex')
  expect(emptyTask.text).toContain('Delegated task is invalid')
  expect(oversizedUtf8.text).toContain('UTF-8 bytes')
  expect(missingActivity.text).toContain('No saved Activity')
  expect(start).not.toHaveBeenCalled()
  expect(ctx.homeActivityDelegations.list(activity.id)).toEqual([])
})

it('runs Codex through the external provider seam and records a one-shot report without a DSH Session', async () => {
  const { ctx, parent } = await harness(new DelegationAdapter([]))
  const result = Promise.withResolvers<SubagentResult>()
  const providerRequests: ResolvedSubagentStartRequest[] = []
  const provider: SubagentProvider = {
    name: 'codex',
    capabilities: NO_START_CAPABILITIES,
    inheritsParentContext: false,
    async start(request): Promise<SubagentRun> {
      providerRequests.push(request)
      return {
        id: SessionId('codex-provider-run-1'),
        result: result.promise,
        dispose: async () => {},
      }
    },
  }
  ctx.subagents.registerProvider(provider)
  const start = vi.spyOn(ctx.subagents, 'startActivation')
  const warnings = vi.spyOn(ctx.logger, 'warn')
  const activity = await ctx.homeActivities.create({
    name: 'Codex one-shot review',
    objective: 'Receive a bounded Codex report.',
    boundaries: { inScope: ['Review a checklist.'], outOfScope: ['Do not publish.'] },
  })

  const admitted = await run(ctx, parent, ` delegate ${activity.id} codex Review the release checklist once.`)
  expect(admitted.kind, warnings.mock.calls.map(call => String(call[0])).join('\n')).toBe('success')
  expect(admitted.text).toContain('provider codex (native Codex, external one-shot)')
  expect(admitted.text).toContain('Codex provider run id (not a DSH Session or native Codex conversation id): codex-provider-run-1')
  expect(admitted.text).not.toContain('Child Session:')
  expect(admitted.text).toContain('native Codex configuration and its configured permission mode govern this execution')
  expect(admitted.text).toContain('Activity does not expose transcript inspection, continuation, resume, or rollback.')

  const spec = start.mock.calls[0]?.[0]
  expect(spec).toMatchObject({ provider: 'codex', delivery: 'caller' })
  expect(spec?.childId).toBeUndefined()
  expect(spec?.name).toBeUndefined()
  expect(spec?.agentOptions).toBeUndefined()
  expect(spec?.prompt).toEqual([{ type: 'text', text: 'Review the release checklist once.' }])
  expect(providerRequests).toHaveLength(1)
  expect(providerRequests[0]?.prompt).toEqual([{ type: 'text', text: 'Review the release checklist once.' }])
  const request = ctx.homeActivityDelegations.list(activity.id)[0]
  expect(request?.request).toMatchObject({ provider: 'codex', task: 'Review the release checklist once.' })
  expect(request?.request).not.toHaveProperty('requestedChildSessionId')
  expect(request?.admission).toMatchObject({
    provider: 'codex',
    providerRunId: 'codex-provider-run-1',
  })
  expect(request?.admission).not.toHaveProperty('childSessionId')

  const pending = await run(ctx, parent, ` open ${activity.id}`)
  expect(pending.text).toContain('Status: admitted; not verified or accepted.')
  expect(pending.text).toContain('Codex outcome is pending.')
  expect(pending.text).not.toContain('Child Session: codex-provider-run-1')
  result.resolve({
    stopReason: 'completed',
    output: [{ type: 'text', text: 'The checklist is missing a migration step.' }],
  })
  await waitForReported(ctx, request!.id)
  const reported = await run(ctx, parent, ` open ${activity.id}`)
  expect(reported.text).toContain('Status: Codex reported; not verified or accepted.')
  expect(reported.text).toContain('Codex-reported output: The checklist is missing a migration step.')
  expect(reported.text).toContain('Codex provider run id (not a DSH Session or native Codex conversation id): codex-provider-run-1')
  expect(reported.text).not.toContain('Child Session: codex-provider-run-1')
  expect(start).toHaveBeenCalledTimes(1)
  expect(parent.session.snapshotEvents().filter(event => event.type === 'turn/start' || event.type === 'turn/end')).toEqual([])
  expect(parent.session.snapshotEvents().filter(event => event.type.startsWith('goal/'))).toEqual([])
})

it('reports a missing native Codex provider without admitting or retrying work', async () => {
  const { ctx, parent } = await harness(new DelegationAdapter([]))
  const activity = await ctx.homeActivities.create({
    name: 'Unavailable Codex route',
    objective: 'Report a missing provider without execution.',
    boundaries: { inScope: ['Show the provider error.'], outOfScope: ['Start another provider.'] },
  })
  const start = vi.spyOn(ctx.subagents, 'startActivation')

  const rejected = await run(ctx, parent, ` delegate ${activity.id} codex Review the release checklist.`)

  expect(rejected).toMatchObject({ kind: 'error' })
  expect(rejected.text).toContain('The Codex provider is unavailable; DSH did not attempt activation.')
  expect(ctx.homeActivityDelegations.list(activity.id)[0]).toMatchObject({
    status: 'not-admitted',
    request: { provider: 'codex' },
    failure: { message: 'The Codex provider is unavailable; DSH did not attempt activation.' },
  })
  expect(start).not.toHaveBeenCalled()
  const reopened = await run(ctx, parent, ` open ${activity.id}`)
  expect(reopened.text).toContain('Status: not admitted.')
  expect(reopened.text).toContain('The Codex provider is unavailable; DSH did not attempt activation.')
})

it('records a Codex provider replacement before dispatch as not admitted', async () => {
  const { ctx, parent } = await harness(new DelegationAdapter([]))
  let originalStarts = 0
  let replacementStarts = 0
  const unregister = ctx.subagents.registerProvider({
    name: 'codex',
    capabilities: NO_START_CAPABILITIES,
    inheritsParentContext: false,
    async start(): Promise<SubagentRun> {
      originalStarts += 1
      throw new Error('provider start must not be called after replacement')
    },
  })
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const ensure = ctx.workingDirectory.ensure.bind(ctx.workingDirectory)
  const directory = vi.spyOn(ctx.workingDirectory, 'ensure').mockImplementation(async (...args) => {
    entered.resolve(undefined)
    await release.promise
    return ensure(...args)
  })
  const start = vi.spyOn(ctx.subagents, 'startActivation')
  const activity = await ctx.homeActivities.create({
    name: 'Codex provider replacement',
    objective: 'Report that no task was dispatched when the provider changes.',
    boundaries: { inScope: ['Record the pre-dispatch failure.'], outOfScope: ['Retry automatically.'] },
  })
  const pending = run(ctx, parent, ` delegate ${activity.id} codex Review the release checklist once.`)

  try {
    await entered.promise
    unregister()
    ctx.subagents.registerProvider({
      name: 'codex',
      capabilities: NO_START_CAPABILITIES,
      inheritsParentContext: false,
      async start(): Promise<SubagentRun> {
        replacementStarts += 1
        throw new Error('replacement provider start must not be called')
      },
    })
    release.resolve(undefined)
    const rejected = await pending
    expect(rejected.kind).toBe('error')
    expect(rejected.text).toContain('The Codex provider changed before dispatch, so DSH did not start this task.')
    expect(rejected.text).not.toContain('do not repeat this task')
    const saved = ctx.homeActivityDelegations.list(activity.id)[0]
    expect(saved).toMatchObject({ status: 'not-admitted', request: { provider: 'codex' } })
    expect(saved?.failure?.message).toContain('DSH did not start this task.')
    const reopened = await run(ctx, parent, ` open ${activity.id}`)
    expect(reopened.text).toContain('Status: not admitted.')
    expect(reopened.text).not.toContain('do not repeat this task')
    expect(originalStarts).toBe(0)
    expect(replacementStarts).toBe(0)
    expect(start).toHaveBeenCalledTimes(1)
  } finally {
    release.resolve(undefined)
    await Promise.allSettled([pending])
    directory.mockRestore()
  }
})

it('records Codex startup preparation failure before provider invocation as not admitted', async () => {
  const { ctx, parent } = await harness(new DelegationAdapter([]))
  let providerStarts = 0
  ctx.subagents.registerProvider({
    name: 'codex',
    capabilities: NO_START_CAPABILITIES,
    inheritsParentContext: false,
    async start(): Promise<SubagentRun> {
      providerStarts += 1
      throw new Error('provider must not be called')
    },
  })
  vi.spyOn(ctx.workingDirectory, 'ensure').mockRejectedValue(new Error('directory unavailable'))
  const activity = await ctx.homeActivities.create({
    name: 'Codex startup preparation failure',
    objective: 'Record that DSH did not call the provider when setup failed.',
    boundaries: { inScope: ['Keep the result safe to retry explicitly.'], outOfScope: ['Retry automatically.'] },
  })

  const rejected = await run(ctx, parent, ` delegate ${activity.id} codex Review the release checklist once.`)
  expect(rejected.kind).toBe('error')
  expect(rejected.text).toContain('DSH could not complete startup preparation and did not call the Codex provider.')
  expect(rejected.text).toContain('Check the DSH runtime, current Session, Activity, and provider')
  expect(rejected.text).not.toContain('do not repeat this task')
  const saved = ctx.homeActivityDelegations.list(activity.id)[0]
  expect(saved).toMatchObject({ status: 'not-admitted', request: { provider: 'codex' } })
  expect(saved?.failure?.message).toContain('did not call the Codex provider')
  expect(providerStarts).toBe(0)

  const reopened = await run(ctx, parent, ` open ${activity.id}`)
  expect(reopened.text).toContain('Status: not admitted.')
  expect(reopened.text).toContain('did not call the Codex provider')
  expect(providerStarts).toBe(0)
})

it('keeps a possibly-started Codex rejection unconfirmed and never retries on reopen', async () => {
  const { ctx, parent } = await harness(new DelegationAdapter([]))
  const activity = await ctx.homeActivities.create({
    name: 'Codex startup uncertainty',
    objective: 'Keep an ambiguous external start from being retried.',
    boundaries: { inScope: ['Record whether startup is confirmed.'], outOfScope: ['Retry external work.'] },
  })
  let providerStartedTask = false
  ctx.subagents.registerProvider({
    name: 'codex',
    capabilities: NO_START_CAPABILITIES,
    inheritsParentContext: false,
    async start(): Promise<SubagentRun> {
      providerStartedTask = true
      throw new Error('simulated transport loss after turn/start')
    },
  })

  const rejected = await run(ctx, parent, ` delegate ${activity.id} codex Review the checklist once.`)
  expect(rejected.kind).toBe('error')
  expect(providerStartedTask).toBe(true)
  expect(rejected.text).toContain('DSH could not confirm whether Codex started.')
  expect(rejected.text).toContain('It may have started; do not repeat this task unless you have independently confirmed it did not start.')
  const saved = ctx.homeActivityDelegations.list(activity.id)[0]
  expect(saved).toMatchObject({
    status: 'unconfirmed',
    request: { provider: 'codex' },
    uncertainty: { reason: 'codex-start-outcome-unknown' },
  })
  expect(saved?.admission).toBeUndefined()
  expect(saved?.failure).toBeUndefined()

  const reopened = await run(ctx, parent, ` open ${activity.id}`)
  expect(reopened.text).toContain('Status: unconfirmed; saved facts do not establish whether the external Codex run started.')
  expect(reopened.text).toContain('No Codex execution id was saved.')
  expect(reopened.text).toContain('do not repeat the task unless you independently confirm it did not start')
  expect(reopened.text).toContain('Reason: DSH did not confirm whether the external Codex run started.')
  expect(providerStartedTask).toBe(true)
})

it('stops before provider startup when a request cannot be durably saved', async () => {
  const { ctx, parent } = await harness(new DelegationAdapter([]))
  const activity = await ctx.homeActivities.create({
    name: 'Request persistence',
    objective: 'Keep request persistence ahead of execution.',
    boundaries: { inScope: ['Save the request.'], outOfScope: ['Start the provider on failure.'] },
  })
  const start = vi.spyOn(ctx.subagents, 'startActivation')
  vi.spyOn(ctx.homeActivityDelegations, 'createRequest').mockRejectedValueOnce(
    new ActivityDelegationError('invalid-request', 'specific delegation validation failure'),
  )
  await expect(run(ctx, parent, ` delegate ${activity.id} spawn inspect the checklist`))
    .resolves.toEqual({ kind: 'error', text: 'specific delegation validation failure' })
  vi.spyOn(ctx.homeActivityDelegations, 'createRequest').mockRejectedValueOnce(new StorageError('unknown-state', 'private storage location'))
  await expect(run(ctx, parent, ` delegate ${activity.id} spawn inspect the checklist`))
    .resolves.toEqual({ kind: 'error', text: 'Delegation request could not be saved; no provider start was attempted.' })
  vi.spyOn(ctx.homeActivityDelegations, 'createRequest').mockRejectedValueOnce(new Error('private storage location'))
  await expect(run(ctx, parent, ` delegate ${activity.id} spawn inspect the checklist`))
    .resolves.toEqual({ kind: 'error', text: 'Delegation request could not be saved; no provider start was attempted.' })
  expect(start).not.toHaveBeenCalled()
})

it('records admission rejection truthfully, including failure to save its final state', async () => {
  const { ctx, parent } = await harness(new DelegationAdapter([]))
  const activity = await ctx.homeActivities.create({
    name: 'Startup rejection',
    objective: 'Distinguish a rejected start from an accepted child.',
    boundaries: { inScope: ['Record the DSH startup decision.'], outOfScope: ['Retry automatically.'] },
  })
  vi.spyOn(ctx.subagents, 'startActivation')
    .mockRejectedValueOnce(new Error('private backend details'))
    .mockRejectedValueOnce(new Error('private backend details'))
  const rejected = await run(ctx, parent, ` delegate ${activity.id} spawn inspect one checklist`)
  expect(rejected.kind).toBe('error')
  expect(rejected.text).toContain('did not admit this task; no activation was published.')
  expect(ctx.homeActivityDelegations.list(activity.id)[0]).toMatchObject({ status: 'not-admitted' })

  vi.spyOn(ctx.homeActivityDelegations, 'markNotAdmitted').mockRejectedValueOnce(new Error('private storage details'))
  const uncertain = await run(ctx, parent, ` delegate ${activity.id} spawn inspect another checklist`)
  expect(uncertain.kind).toBe('error')
  expect(uncertain.text).toContain('rejected the request before activation')
  expect(uncertain.text).toContain('may show an unconfirmed request')
  expect(ctx.homeActivityDelegations.list(activity.id)).toHaveLength(2)
})

it('renders every saved delegation state with the right uncertainty and fact references', async () => {
  const { ctx, parent } = await harness(new DelegationAdapter([]))
  const activity = await ctx.homeActivities.create({
    name: 'Delegation states',
    objective: 'Show request, admission, and report as separate facts.',
    boundaries: { inScope: ['Inspect recorded delegation facts.'], outOfScope: ['Call Activity scope an authorization.'] },
  })
  const requested = await ctx.homeActivityDelegations.createRequest({
    activityId: activity.id,
    provider: 'spawn',
    task: 'Review the proposed release checklist.',
    parentSessionId: parent.session.id,
  })
  if (requested.request.provider !== 'spawn') throw new Error('This rendering case must use a DSH spawn request.')
  const requestedChildSessionId = requested.request.requestedChildSessionId
  const requestedText = renderActivityDelegation(requested).join('\n')
  expect(requestedText).toContain('request saved; provider admission has not been confirmed')
  expect(requestedText).toContain(`Requested child Session id (not admission evidence): ${requestedChildSessionId}`)

  const notAdmitted = await ctx.homeActivityDelegations.createRequest({
    activityId: activity.id,
    provider: 'spawn',
    task: 'Check the provider startup state.',
    parentSessionId: parent.session.id,
  })
  const failed = await ctx.homeActivityDelegations.markNotAdmitted(notAdmitted.id, 'The provider did not publish a child.')
  expect(renderActivityDelegation(failed).join('\n')).toContain('Status: not admitted. The provider did not publish a child.')
  expect(renderActivityDelegation({ ...failed, failure: undefined }).join('\n'))
    .toContain('The DSH API did not publish an activation.')

  const admission = {
    childSessionId: SessionId('child-state-session'),
    activationName: 'activity-state',
    admittedAt: new Date().toISOString(),
    source: 'subagents.startActivation' as const,
  }
  const admittedRequest = await ctx.homeActivityDelegations.createRequest({
    activityId: activity.id,
    provider: 'spawn',
    task: 'Wait for the child report.',
    parentSessionId: parent.session.id,
  })
  const admitted = await ctx.homeActivityDelegations.recordAdmitted(admittedRequest.id, admission)
  expect(renderActivityDelegation(admitted).join('\n')).toContain('Provider outcome is pending')

  const missingAdmission: ActivityDelegation = {
    ...requested,
    status: 'reported',
    report: {
      stopReason: 'stop',
      outputText: '',
      nonTextBlockTypes: [],
      outputTruncated: false,
      reportedAt: new Date().toISOString(),
      source: 'subagent-activation-result',
    },
  }
  expect(renderActivityDelegation(missingAdmission).join('\n')).toContain('Activation reference is unavailable.')

  const noAdmissionUncertainty: ActivityDelegation = {
    ...requested,
    status: 'unconfirmed',
    uncertainty: { reason: 'restart-before-admission-recorded', observedAt: new Date().toISOString() },
  }
  const noAdmissionText = renderActivityDelegation(noAdmissionUncertainty).join('\n')
  expect(noAdmissionText).toContain('saved facts do not establish whether DSH admitted the request')
  expect(noAdmissionText).toContain(`Requested child Session id (not admission evidence): ${requestedChildSessionId}`)
  expect(noAdmissionText).toContain('Check /activity sessions for this exact id and its summary metadata before deciding whether to retry.')
  expect(noAdmissionText).toContain('A missing Session record does not confirm that admission failed.')
  const missingReason = renderActivityDelegation({ ...noAdmissionUncertainty, uncertainty: undefined }).join('\n')
  expect(missingReason).toContain('The persisted lifecycle state is incomplete.')

  const reasons: readonly ActivityDelegationUncertainty['reason'][] = [
    'restart-before-admission-recorded',
    'restart-before-report-recorded',
    'admission-write-failed',
    'report-write-failed',
    'startup-result-rejected',
  ]
  const reasonLines = reasons.map(reason => renderActivityDelegation({
    ...requested,
    status: 'unconfirmed',
    admission,
    uncertainty: { reason, observedAt: new Date().toISOString() },
  }).join('\n'))
  expect(reasonLines[0]).toContain('application restarted before the provider admission was saved')
  expect(reasonLines[1]).toContain('application restarted before the provider report was saved')
  expect(reasonLines[2]).toContain('child was accepted, but saving its admission reference failed')
  expect(reasonLines[3]).toContain('Saving the provider report failed after the child Session was admitted')
  expect(reasonLines[4]).toContain('accepted activation did not provide a usable report')
})

it('records child and run references and clips a separately attributed provider report', async () => {
  const { ctx, parent } = await harness(new DelegationAdapter([]))
  const activity = await ctx.homeActivities.create({
    name: 'Provider report rendering',
    objective: 'Record only what the child provider reported.',
    boundaries: { inScope: ['Inspect a report.'], outOfScope: ['Verify or accept it.'] },
  })
  const report = Promise.withResolvers<SubagentResult>()
  vi.spyOn(ctx.subagents, 'startActivation').mockImplementation(async spec => fakeActivation(ctx, spec, report.promise, true))
  const admitted = await run(ctx, parent, ` delegate ${activity.id} spawn inspect the release checklist`)
  expect(admitted.kind).toBe('success')
  expect(admitted.text).toContain('Activation run: run-exact')
  const record = ctx.homeActivityDelegations.list(activity.id)[0]!
  expect(record.status).toBe('admitted')

  report.resolve({
    stopReason: 'error',
    output: [{ type: 'text', text: `${'a'.repeat(16_383)}💩` }, { type: 'reasoning', text: 'private reasoning block' }],
    diagnostic: 'Provider-authored diagnostic.',
  })
  await waitForReported(ctx, record.id)
  const opened = await run(ctx, parent, ` open ${activity.id}`)
  expect(opened.text).toContain('Provider stop reason: error')
  expect(opened.text).toContain(`Provider-reported output: ${'a'.repeat(16_383)}`)
  expect(opened.text).toContain('Additional provider output blocks: reasoning')
  expect(opened.text).toContain('Provider-reported text was clipped at 16384 UTF-8 bytes.')
  expect(opened.text).toContain('Provider diagnostic: Provider-authored diagnostic.')
  expect(opened.text).toContain('not verified or accepted')
})

it('renders admitted results without a run id and leaves restart recovery unconfirmed', async () => {
  const { ctx, parent } = await harness(new DelegationAdapter([]))
  const activity = await ctx.homeActivities.create({
    name: 'Missing run id',
    objective: 'Allow runtimes that do not supply a run identity.',
    boundaries: { inScope: ['Record the available references.'], outOfScope: ['Invent a run id.'] },
  })
  const result = Promise.withResolvers<SubagentResult>()
  vi.spyOn(ctx.subagents, 'startActivation').mockImplementation(async spec => fakeActivation(ctx, spec, result.promise, false))
  const admitted = await run(ctx, parent, ` delegate ${activity.id} spawn inspect the checklist`)
  expect(admitted.kind).toBe('success')
  expect(admitted.text).toMatch(/Child Session: [0-9a-f-]{36}/u)
  expect(admitted.text).not.toContain('Activation run:')
  result.resolve({ stopReason: 'completed', output: [] })
  const requestId = ctx.homeActivityDelegations.list(activity.id)[0]!.id
  await waitForReported(ctx, requestId)
  const opened = await run(ctx, parent, ` open ${activity.id}`)
  expect(opened.text).toContain('Provider-reported output: (no text output)')
})

it('keeps an admitted child explicit when admission persistence fails', async () => {
  const { ctx, parent } = await harness(new DelegationAdapter([]))
  const activity = await ctx.homeActivities.create({
    name: 'Admission persistence',
    objective: 'Keep runtime acceptance distinct from record durability.',
    boundaries: { inScope: ['Record the accepted activation.'], outOfScope: ['Report a failed start.'] },
  })
  const result = Promise.withResolvers<SubagentResult>()
  vi.spyOn(ctx.subagents, 'startActivation').mockImplementation(async spec => fakeActivation(ctx, spec, result.promise, false))
  vi.spyOn(ctx.homeActivityDelegations, 'recordAdmitted').mockRejectedValueOnce(new Error('private persistence detail'))
  const admitted = await run(ctx, parent, ` delegate ${activity.id} spawn inspect the checklist`)
  expect(admitted.kind).toBe('success')
  expect(admitted.text).toContain('Execution was accepted by DSH')
  expect(admitted.text).toContain('admission record could not be confirmed')
  expect(admitted.text).toMatch(/Child Session: [0-9a-f-]{36}/u)
  expect(admitted.text).not.toContain('no execution claim')
  result.resolve({ stopReason: 'completed', output: [] })
  const requestId = ctx.homeActivityDelegations.list(activity.id)[0]!.id
  await waitForReported(ctx, requestId)
})

it('records an unknown settled result and contains persistence and observer failures', async () => {
  const { ctx, parent } = await harness(new DelegationAdapter([]))
  const warnings = vi.spyOn(ctx.logger, 'warn')
  const activity = await ctx.homeActivities.create({
    name: 'Unknown provider outcome',
    objective: 'Make unknown outcomes visible without claiming a report.',
    boundaries: { inScope: ['Record uncertainty.'], outOfScope: ['Retry automatically.'] },
  })
  const rejectedResult = Promise.withResolvers<SubagentResult>()
  vi.spyOn(ctx.subagents, 'startActivation')
    .mockImplementationOnce(async spec => fakeActivation(ctx, spec, rejectedResult.promise, false))
  const admitted = await run(ctx, parent, ` delegate ${activity.id} spawn inspect one checklist`)
  expect(admitted.kind).toBe('success')
  rejectedResult.reject(new Error('private activation fault'))
  await vi.waitFor(() => {
    expect(ctx.homeActivityDelegations.list(activity.id)[0]?.status).toBe('unconfirmed')
  })
  await vi.waitFor(() => {
    expect(warnings.mock.calls.some(call => String(call[0]).includes('admitted activation result was rejected'))).toBe(true)
  })
  let opened = await run(ctx, parent, ` open ${activity.id}`)
  expect(opened.text).toContain('accepted activation did not provide a usable report')
  expect(opened.text).toContain('The provider report is not verified or accepted.')

  const failingResult = Promise.withResolvers<SubagentResult>()
  vi.spyOn(ctx.subagents, 'startActivation')
    .mockImplementationOnce(async spec => fakeActivation(ctx, spec, failingResult.promise, false))
  const second = await run(ctx, parent, ` delegate ${activity.id} spawn inspect another checklist`)
  expect(second.kind).toBe('success')
  vi.spyOn(ctx.homeActivityDelegations, 'markUnconfirmed').mockRejectedValueOnce(new Error('private persistence detail'))
  failingResult.reject(new Error('private activation fault'))
  const secondId = ctx.homeActivityDelegations.list(activity.id)[0]!.id
  await vi.waitFor(() => {
    expect(warnings.mock.calls.some(call => String(call[0]).includes('unknown activation result could not be saved'))).toBe(true)
  })
  expect(ctx.homeActivityDelegations.get(secondId)?.status).toBe('admitted')

  const reported = Promise.withResolvers<SubagentResult>()
  vi.spyOn(ctx.subagents, 'startActivation')
    .mockImplementationOnce(async spec => fakeActivation(ctx, spec, reported.promise, false))
  const third = await run(ctx, parent, ` delegate ${activity.id} spawn inspect a third checklist`)
  expect(third.kind).toBe('success')
  const thirdId = ctx.homeActivityDelegations.list(activity.id)[0]!.id
  vi.spyOn(ctx.homeActivityDelegations, 'recordReported').mockRejectedValueOnce(new Error('private persistence detail'))
  reported.resolve({ stopReason: 'completed', output: [] })
  await vi.waitFor(() => {
    expect(warnings.mock.calls.some(call => String(call[0]).includes('provider report could not be persisted'))).toBe(true)
  })
  expect(ctx.homeActivityDelegations.get(thirdId)?.status).toBe('admitted')

  const malformed = Promise.withResolvers<SubagentResult>()
  vi.spyOn(ctx.subagents, 'startActivation')
    .mockImplementationOnce(async spec => fakeActivation(ctx, spec, malformed.promise, false))
  const fourth = await run(ctx, parent, ` delegate ${activity.id} spawn inspect a fourth checklist`)
  expect(fourth.kind).toBe('success')
  const fourthId = ctx.homeActivityDelegations.list(activity.id)[0]!.id
  const invalidResult: SubagentResult = {
    get output(): never { throw new Error('invalid provider result object') },
    stopReason: 'completed',
  }
  malformed.resolve(invalidResult)
  await vi.waitFor(() => {
    expect(ctx.homeActivityDelegations.get(fourthId)?.status).toBe('unconfirmed')
  })
  await vi.waitFor(() => {
    expect(warnings.mock.calls.some(call =>
      String(call[0]).includes('settled activation result could not be read'),
    )).toBe(true)
  })
  opened = await run(ctx, parent, ` open ${activity.id}`)
  const openedText = opened.text
  if (openedText === undefined) throw new Error('Reopened Activity did not return its detail text.')
  const malformedRecord = openedText.split(`Delegation ${fourthId}: provider spawn`)[1]?.split('\n\nDelegation ')[0] ?? ''
  expect(malformedRecord).toContain('accepted activation did not provide a usable report')
  expect(malformedRecord).not.toContain('Provider outcome is pending')

  const malformedObserver = Promise.withResolvers<SubagentResult>()
  vi.spyOn(ctx.subagents, 'startActivation')
    .mockImplementationOnce(async spec => fakeActivation(ctx, spec, malformedObserver.promise, false))
  vi.spyOn(ctx.homeActivityDelegations, 'markUnconfirmed').mockRejectedValueOnce(new Error('private persistence detail'))
  warnings.mockImplementationOnce(() => { throw new Error('logger failure') })
  const fifth = await run(ctx, parent, ` delegate ${activity.id} spawn inspect a fifth checklist`)
  expect(fifth.kind).toBe('success')
  const fifthId = ctx.homeActivityDelegations.list(activity.id)[0]!.id
  malformedObserver.resolve(invalidResult)
  await vi.waitFor(() => {
    expect(warnings.mock.calls.some(call =>
      String(call[0]).includes('result observer failed'),
    )).toBe(true)
  })
  expect(ctx.homeActivityDelegations.get(fifthId)?.status).toBe('admitted')
})
