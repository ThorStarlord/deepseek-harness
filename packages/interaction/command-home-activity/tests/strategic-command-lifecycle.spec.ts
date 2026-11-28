import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolGuard, ToolRegistrationOptions } from '@deepseek-ai/dsh-tools'
import { ActivityId } from '@deepseek-ai/dsh-home-activity'
import { ActivityStrategicEpisodeError, ActivityStrategicEpisodeStorageError } from '@deepseek-ai/dsh-home-activity/strategic-episodes'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { Workspace } from '@deepseek-ai/dsh-workspace/types'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import {
  cancelActivityStrategicAssessment,
  executeActivityStrategicAssessment,
  registerActivityStrategicBriefTool,
} from '../src/strategic-command.ts'

const contexts: Context[] = []
const workspaceIds = [
  WorkspaceId('00000000-0000-4000-8000-000000000011'),
  WorkspaceId('00000000-0000-4000-8000-000000000012'),
] as const
const activityId = ActivityId('00000000-0000-4000-8000-000000000021')

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

it('clears failed Skill preparation and delays plugin cleanup until an active request settles', async () => {
  let shouldFail = true
  const setup = createHarness(async (name) => {
    if (shouldFail) throw new Error(`Unavailable Skill: ${name}`)
    return skill(name)
  })

  const failed = await assess(setup)
  expect(failed).toMatchObject({ kind: 'error' })
  expect(failed.text).toContain('Sensemaking Skills could not be loaded')
  expect(setup.guards[0]?.({ name: 'shell', agent: setup.agent } as never)).toBeUndefined()
  expect(setup.agent.steer).not.toHaveBeenCalled()

  shouldFail = false
  const started = await assess(setup)
  expect(started).toMatchObject({ kind: 'success' })
  expect(setup.guards[0]?.({ name: 'shell', agent: setup.agent } as never)).toContain('Activity Strategic Brief is active')

  setup.dispose()
  setup.dispose()
  expect(setup.toolsByName.has('record_activity_strategic_brief')).toBe(false)
  expect(setup.guards[0]?.({ name: 'shell', agent: setup.agent } as never)).toContain('was canceled')

  setup.ctx.emit('session/event', setup.agent.session as never, {
    type: 'turn/end',
    data: { turn: 1, reason: { kind: 'completed' } },
  } as never)
  expect(setup.guards).toHaveLength(0)
})

it('reports uncertain persistence failure without releasing the active turn guard', async () => {
  const record = vi.fn(async () => { throw new Error('storage connection ended during write') })
  const setup = createHarness(async name => skill(name), record)
  expect(await assess(setup)).toMatchObject({ kind: 'success' })
  const requestId = /Request ID: ([0-9a-f-]{36})/u.exec(setup.steeredText())?.[1]
  if (requestId === undefined) throw new Error('The assessment request id was not included in its instruction')

  emitCoordinatorResult(setup)
  const recorder = setup.toolsByName.get('record_activity_strategic_brief')?.definition
  if (recorder?.execute === undefined) throw new Error('The explicit assessment recorder was not registered')

  await expect(recorder.execute({ requestId, briefJson: JSON.stringify(brief()) }, {
    agent: setup.agent,
    callId: ToolCallId('strategic-record-failure'),
    signal: new AbortController().signal,
  } as never)).rejects.toThrow('could not be confirmed in storage. Open the Activity before retrying.')

  expect(record).toHaveBeenCalledTimes(1)
  expect(setup.guards[0]?.({ name: 'shell', agent: setup.agent } as never)).toContain('Activity Strategic Brief is active')
  expect(setup.toolsByName.get('record_activity_strategic_brief')?.options.when?.({ agent: setup.agent } as never)).toBe(true)

  setup.ctx.emit('session/event', setup.agent.session as never, {
    type: 'turn/end',
    data: { turn: 1, reason: { kind: 'completed' } },
  } as never)
  expect(setup.guards[0]?.({ name: 'shell', agent: setup.agent } as never)).toBeUndefined()
})

it('does not queue duplicate work in one Session and handles a synchronous steer failure', async () => {
  const loadSkill = vi.fn(async name => skill(name))
  const setup = createHarness(loadSkill)
  expect(await assess(setup)).toMatchObject({ kind: 'success' })
  await expect(assess(setup)).resolves.toMatchObject({ kind: 'error', text: expect.stringContaining('already has an unfinished') })
  expect(loadSkill).toHaveBeenCalledTimes(2)

  const queueFailure = createHarness(async name => skill(name))
  queueFailure.agent.steer.mockImplementation(() => { throw new Error('turn ended before enqueue') })
  const result = await assess(queueFailure)
  expect(result).toMatchObject({ kind: 'error', text: expect.stringContaining('was not queued') })
  expect(queueFailure.guards[0]?.({ name: 'shell', agent: queueFailure.agent } as never)).toBeUndefined()
})

it('rejects missing assessment prerequisites before reading sources', async () => {
  const unavailableActivity = createHarness(async name => skill(name), undefined, { activityAvailable: false })
  await expect(assess(unavailableActivity)).resolves.toMatchObject({ kind: 'error', text: expect.stringContaining('No saved Activity') })

  const duplicateWorkspace = createHarness(async name => skill(name))
  await expect(executeActivityStrategicAssessment(
    duplicateWorkspace.ctx,
    { agent: duplicateWorkspace.agent, signal: new AbortController().signal } as never,
    activityId,
    [workspaceIds[0], workspaceIds[0]],
  )).resolves.toMatchObject({ kind: 'error', text: expect.stringContaining('two distinct registered Workspace IDs') })

  const missingWorkspace = createHarness(async name => skill(name), undefined, { missingWorkspaceId: workspaceIds[1] })
  await expect(assess(missingWorkspace)).resolves.toMatchObject({ kind: 'error', text: expect.stringContaining('Both selected Workspace IDs must be registered') })

  const unavailableCoordinator = createHarness(async name => skill(name), undefined, { coordinatorAvailable: false })
  await expect(assess(unavailableCoordinator)).resolves.toMatchObject({ kind: 'error', text: expect.stringContaining('coordinator is unavailable') })
  expect(unavailableCoordinator.guards).toHaveLength(1)
  expect(unavailableCoordinator.agent.steer).not.toHaveBeenCalled()
})

it('admits up to the configured pending-request cap across independent Sessions', async () => {
  const loadSkill = vi.fn(async (name: string) => skill(name))
  const setup = createHarness(loadSkill)
  const requests = Array.from({ length: 32 }, (_, index) => {
    const agent = {
      ...setup.agent,
      id: `agent-${index}`,
      session: { ...setup.agent.session, id: `session-${index}` },
      steer: vi.fn(),
    }
    setup.agents.set(agent.id, agent)
    return {
      agent,
      result: executeActivityStrategicAssessment(
        setup.ctx,
        { agent, signal: new AbortController().signal } as never,
        activityId,
        workspaceIds,
      ),
    }
  })
  const admitted = await Promise.all(requests.map(({ result }) => result))
  expect(admitted).toHaveLength(32)
  expect(admitted.every(result => result.kind === 'success')).toBe(true)
  expect(loadSkill).toHaveBeenCalledTimes(64)

  const rejectedAgent = { ...setup.agent, id: 'agent-over-cap', session: { ...setup.agent.session, id: 'session-over-cap' }, steer: vi.fn() }
  setup.agents.set(rejectedAgent.id, rejectedAgent)
  await expect(executeActivityStrategicAssessment(
    setup.ctx,
    { agent: rejectedAgent, signal: new AbortController().signal } as never,
    activityId,
    workspaceIds,
  )).resolves.toMatchObject({ kind: 'error', text: expect.stringContaining('Too many Activity Strategic Brief requests') })
  expect(loadSkill).toHaveBeenCalledTimes(64)

  setup.dispose()
  for (const { agent } of requests) setup.ctx.emit('session/event', agent.session as never, {
    type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } },
  } as never)
})

it('handles unavailable and oversized Skills without admitting an assessment', async () => {
  const missingSkill = createHarness(async name => name === 'using-sensemaking' ? undefined : skill(name))
  await expect(assess(missingSkill)).resolves.toMatchObject({ kind: 'error', text: expect.stringContaining('Required Sensemaking Skills are unavailable') })
  expect(missingSkill.guards[0]?.({ name: 'shell', agent: missingSkill.agent } as never)).toBeUndefined()

  const oversizedSkills = createHarness(async name => ({ name, content: 'x'.repeat(33 * 1024), provider: 'fixture' }))
  await expect(assess(oversizedSkills)).resolves.toMatchObject({ kind: 'error', text: expect.stringContaining('exceed the assessment context limit') })
  expect(oversizedSkills.guards[0]?.({ name: 'shell', agent: oversizedSkills.agent } as never)).toBeUndefined()
  expect(oversizedSkills.agent.steer).not.toHaveBeenCalled()
})

it('formats an empty descriptive scope as an explicit absence', async () => {
  const setup = createHarness(async name => skill(name))
  setup.activity.boundaries.inScope = []
  setup.activity.boundaries.outOfScope = []
  expect(await assess(setup)).toMatchObject({ kind: 'success' })
  expect(setup.steeredText()).toContain('Descriptive in-scope statements: (none)')
  expect(setup.steeredText()).toContain('Descriptive out-of-scope statements: (none)')
})

it('cancels Skill loading and reports other-Actor and absent-request cancellation safely', async () => {
  let rejectSkill: ((reason: Error) => void) | undefined
  const setup = createHarness((_, options) => new Promise((_resolve, reject) => {
    rejectSkill = reject
    options?.signal.addEventListener('abort', () => reject(new Error('Skill load aborted')), { once: true })
  }))
  const loading = assess(setup)
  expect(setup.guards[0]?.({ name: 'shell', agent: setup.agent } as never)).toContain('Skills are loading')
  const otherAgent = { ...setup.agent, id: 'other-agent' }
  setup.agents.set(otherAgent.id, otherAgent)
  expect(setup.guards[0]?.({ name: 'shell', agent: otherAgent } as never)).toContain('another Agent')
  expect(cancelActivityStrategicAssessment(setup.ctx, { agent: otherAgent } as never)).toMatchObject({ kind: 'success', text: expect.stringContaining('No unfinished') })
  expect(cancelActivityStrategicAssessment(setup.ctx, { agent: { ...setup.agent } } as never)).toMatchObject({ kind: 'error', text: expect.stringContaining('live requesting Agent') })
  expect(cancelActivityStrategicAssessment(setup.ctx, { agent: setup.agent } as never)).toMatchObject({ kind: 'success', text: expect.stringContaining('Canceled Activity Strategic Brief setup') })
  expect(await loading).toMatchObject({ kind: 'error', text: expect.stringContaining('setup was canceled') })
  expect(rejectSkill).toBeTypeOf('function')
  expect(setup.guards[0]?.({ name: 'shell', agent: setup.agent } as never)).toBeUndefined()
})

it('retains a canceled request guard until an in-flight coordinator result returns', async () => {
  const setup = createHarness(async name => skill(name))
  expect(await assess(setup)).toMatchObject({ kind: 'success' })
  emitCoordinatorCall(setup)
  expect(setup.guards[0]?.({ name: 'shell', agent: setup.agent } as never)).toContain('read returns')
  expect(cancelActivityStrategicAssessment(setup.ctx, { agent: setup.agent } as never)).toMatchObject({ kind: 'success', text: expect.stringContaining('Canceled unfinished') })
  expect(setup.guards[0]?.({ name: 'shell', agent: setup.agent } as never)).toContain('in-flight coordinator call must return and the current turn must end')

  setup.ctx.emit('session/event', setup.agent.session as never, {
    type: 'turn/end',
    data: { turn: 1, reason: { kind: 'completed' } },
  } as never)
  expect(setup.guards[0]?.({ name: 'shell', agent: setup.agent } as never)).toContain('in-flight coordinator call must return')
  emitCoordinatorResult(setup, coordinatorReport(setup), undefined, ToolCallId('strategic-coordinator-pending'))
  expect(setup.guards[0]?.({ name: 'shell', agent: setup.agent } as never)).toBeUndefined()
  expect(setup.record).not.toHaveBeenCalled()
})

it('distinguishes an already canceled request from a saved brief', async () => {
  const canceled = createHarness(async name => skill(name))
  expect(await assess(canceled)).toMatchObject({ kind: 'success' })
  expect(cancelActivityStrategicAssessment(canceled.ctx, { agent: canceled.agent } as never).text).toContain('Canceled unfinished')
  expect(cancelActivityStrategicAssessment(canceled.ctx, { agent: canceled.agent } as never).text).toContain('already canceled and cannot be saved')

  const saved = createHarness(async name => skill(name))
  expect(await assess(saved)).toMatchObject({ kind: 'success' })
  emitCoordinatorResult(saved)
  await expect(executeRecord(saved, requestIdFrom(saved), JSON.stringify(brief()))).resolves.toMatchObject({ saved: true })
  expect(cancelActivityStrategicAssessment(saved.ctx, { agent: saved.agent } as never).text).toContain('already saved')
})

it('keeps a started save guarded through TTL expiry until persistence settles', async () => {
  vi.useFakeTimers()
  try {
    const finishSave: { resolve?: (value: { id: string; revision: number; recordedAt: string }) => void } = {}
    const record = vi.fn(() => new Promise<{ id: string; revision: number; recordedAt: string }>((resolve) => {
      finishSave.resolve = resolve
    }))
    const setup = createHarness(async name => skill(name), record)
    expect(await assess(setup)).toMatchObject({ kind: 'success' })
    const requestId = /Request ID: ([0-9a-f-]{36})/u.exec(setup.steeredText())?.[1]
    if (requestId === undefined) throw new Error('The assessment request id was not included in its instruction')
    emitCoordinatorResult(setup)
    const saving = executeRecord(setup, requestId, JSON.stringify(brief()))
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(46 * 60 * 1000)
    expect(setup.guards[0]?.({ name: 'shell', agent: setup.agent } as never)).toContain('Only its approved read-only repository coordinator')
    expect(cancelActivityStrategicAssessment(setup.ctx, { agent: setup.agent } as never)).toMatchObject({ kind: 'error', text: expect.stringContaining('save has already started') })
    finishSave.resolve?.({ id: 'episode-1', revision: 1, recordedAt: '2026-11-27T12:00:00.000Z' })
    await expect(saving).resolves.toMatchObject({ saved: true })
    expect(setup.guards[0]?.({ name: 'shell', agent: setup.agent } as never)).toContain('is saved')
  } finally {
    vi.useRealTimers()
  }
})

it('drains canceled disposal after persistence settles and the turn ends', async () => {
  const finishSave: { resolve?: (value: { id: string; revision: number; recordedAt: string }) => void } = {}
  const record = vi.fn(() => new Promise<{ id: string; revision: number; recordedAt: string }>((resolve) => {
    finishSave.resolve = resolve
  }))
  const setup = createHarness(async name => skill(name), record)
  expect(await assess(setup)).toMatchObject({ kind: 'success' })
  emitCoordinatorResult(setup)
  const saving = executeRecord(setup, requestIdFrom(setup), JSON.stringify(brief()))
  await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1))

  setup.dispose()
  expect(setup.guards[0]?.({ name: 'shell', agent: setup.agent } as never)).toContain('save must settle and the current turn must end')
  finishSave.resolve?.({ id: 'episode-disposed', revision: 1, recordedAt: '2026-11-27T12:00:00.000Z' })
  await expect(saving).resolves.toMatchObject({ saved: true })
  expect(setup.guards[0]?.({ name: 'shell', agent: setup.agent } as never)).toContain('was canceled')

  setup.ctx.emit('session/event', setup.agent.session as never, {
    type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } },
  } as never)
  expect(setup.guards).toHaveLength(0)
  expect(setup.toolsByName.has('record_activity_strategic_brief')).toBe(false)
})

it('drains plugin disposal when turn end precedes in-flight persistence settlement', async () => {
  const finishSave: { resolve?: (value: { id: string; revision: number; recordedAt: string }) => void } = {}
  const record = vi.fn(() => new Promise<{ id: string; revision: number; recordedAt: string }>((resolve) => {
    finishSave.resolve = resolve
  }))
  const setup = createHarness(async name => skill(name), record)
  expect(await assess(setup)).toMatchObject({ kind: 'success' })
  const recorder = setup.toolsByName.get('record_activity_strategic_brief')?.definition
  if (recorder === undefined) throw new Error('The explicit assessment recorder was not registered')
  emitCoordinatorResult(setup)
  const saving = executeRecord(setup, requestIdFrom(setup), JSON.stringify(brief()))
  await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1))

  setup.dispose()
  expect(setup.guards[0]?.({ name: 'shell', agent: setup.agent } as never)).toContain('Its save must settle and the current turn must end')
  setup.ctx.emit('session/event', setup.agent.session as never, {
    type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } },
  } as never)
  expect(setup.guards[0]?.({ name: 'shell', agent: setup.agent } as never)).toContain('Its save must settle before the guard is released')

  finishSave.resolve?.({ id: 'episode-disposed', revision: 1, recordedAt: '2026-11-27T12:00:00.000Z' })
  await expect(saving).resolves.toMatchObject({ saved: true })
  expect(setup.guards).toHaveLength(0)
  expect(setup.toolsByName.has('record_activity_strategic_brief')).toBe(false)
})

it('drains disposed requests after a failed write settles without retrying the append', async () => {
  const finishSave: { reject?: (error: Error) => void } = {}
  const storageError = new ActivityStrategicEpisodeStorageError(new Error('write outcome is uncertain'))
  const record = vi.fn(() => new Promise<never>((_resolve, reject) => { finishSave.reject = reject }))
  const setup = createHarness(async name => skill(name), record)
  expect(await assess(setup)).toMatchObject({ kind: 'success' })
  emitCoordinatorResult(setup)
  const saving = executeRecord(setup, requestIdFrom(setup), JSON.stringify(brief()))
  await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1))

  setup.dispose()
  setup.ctx.emit('session/event', setup.agent.session as never, {
    type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } },
  } as never)
  expect(setup.guards[0]?.({ name: 'shell', agent: setup.agent } as never)).toContain('save must settle before the guard is released')

  finishSave.reject?.(storageError)
  await expect(saving).rejects.toBe(storageError)
  expect(record).toHaveBeenCalledTimes(1)
  expect(setup.guards).toHaveLength(0)
  expect(setup.toolsByName.has('record_activity_strategic_brief')).toBe(false)
})

function createHarness(
  loadSkill: (
    name: string,
    options?: { readonly signal: AbortSignal; readonly cwd?: string },
  ) => Promise<{ name: string; content: string; provider: string } | undefined>,
  record = vi.fn(async () => ({ id: 'episode-1', revision: 1, recordedAt: '2026-11-27T12:00:00.000Z' })),
  options: {
    readonly activityAvailable?: boolean
    readonly coordinatorAvailable?: boolean
    readonly missingWorkspaceId?: WorkspaceId
  } = {},
) {
  const ctx = new Context()
  contexts.push(ctx)
  const workspaces = workspaceIds.map((id, index) => ({
    id,
    title: `Project ${index + 1}`,
    path: `C:\\projects\\project-${index + 1}`,
    status: async () => 'ok',
  } as Workspace))
  const activity = {
    id: activityId,
    name: 'Strategic review',
    objective: 'Identify the most useful next development responsibility.',
    boundaries: { inScope: ['Read selected repositories.'], outOfScope: ['Do not implement.'] },
  }
  const agent = {
    id: 'strategic-agent',
    session: { id: 'strategic-session', seq: 0, header: { cwd: 'C:\\projects' } },
    ctx: { skills: { get: loadSkill } },
    steer: vi.fn(),
  }
  const agents = new Map([[agent.id, agent]])
  const toolsByName = new Map<string, { definition: ToolDefinition; options: ToolRegistrationOptions }>()
  const guards: ToolGuard[] = []
  const coordinator: ToolDefinition = {
    name: 'coordinate_repositories',
    description: 'Read selected repositories.',
    parameters: {},
    output: { schema: { type: 'object' }, render: () => [] },
    async execute() { return {} },
  }
  ctx.provide('tools', {
    get(name: string) {
      return name === coordinator.name
        ? (options.coordinatorAvailable === false ? undefined : coordinator)
        : toolsByName.get(name)?.definition
    },
    guard(guard: ToolGuard) {
      guards.push(guard)
      return () => { guards.splice(guards.indexOf(guard), 1) }
    },
    register(definition: ToolDefinition, options: ToolRegistrationOptions = {}) {
      toolsByName.set(definition.name, { definition, options })
      return () => { toolsByName.delete(definition.name) }
    },
  } as never)
  ctx.provide('homeActivities', { get: (id: string) => options.activityAvailable === false ? undefined : id === activity.id ? activity : undefined } as never)
  ctx.provide('workspaceRegistry', {
    get: (id: WorkspaceId) => id === options.missingWorkspaceId ? undefined : workspaces.find(workspace => workspace.id === id),
  } as never)
  ctx.provide('agents', { get: (id: string) => agents.get(id) } as never)
  ctx.provide('homeActivityStrategicEpisodes', { record } as never)

  const dispose = registerActivityStrategicBriefTool(ctx)
  const steeredText = (): string => agent.steer.mock.calls
    .flatMap(([message]) => message.content)
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')

  return { ctx, agent, agents, activity, workspaces, toolsByName, guards, dispose, record, steeredText }
}

async function assess(setup: ReturnType<typeof createHarness>) {
  return executeActivityStrategicAssessment(
    setup.ctx,
    { agent: setup.agent, signal: new AbortController().signal } as never,
    activityId,
    workspaceIds,
  )
}

function skill(name: string) {
  return Promise.resolve({ name, content: `Instructions for ${name}.`, provider: 'fixture-skill-provider' })
}

function emitCoordinatorResult(
  setup: ReturnType<typeof createHarness>,
  report: unknown = coordinatorReport(setup),
  argumentsJson = JSON.stringify({ repositories: setup.workspaces.map(workspace => workspace.path), task: 'Inspect selected sources.' }),
  callId = ToolCallId('strategic-coordinator-result'),
): void {
  setup.ctx.emit('session/event', setup.agent.session as never, {
    type: 'tool/call',
    seq: 1,
    data: { turn: 1, step: 1, callId, name: 'coordinate_repositories', arguments: argumentsJson },
  } as never)
  setup.ctx.emit('session/event', setup.agent.session as never, {
    type: 'tool/result',
    seq: 2,
    data: { turn: 1, step: 1, message: { toolCallId: callId, isError: false }, meta: report },
  } as never)
}

function emitCoordinatorCall(setup: ReturnType<typeof createHarness>): void {
  const callId = ToolCallId('strategic-coordinator-pending')
  setup.ctx.emit('session/event', setup.agent.session as never, {
    type: 'tool/call',
    seq: 1,
    data: { turn: 1, step: 1, callId, name: 'coordinate_repositories', arguments: JSON.stringify({ repositories: setup.workspaces.map(workspace => workspace.path), task: 'Inspect selected sources.' }) },
  } as never)
}

function coordinatorReport(setup: ReturnType<typeof createHarness>): { repositories: Record<string, unknown>[] } {
  return {
    repositories: setup.workspaces.map((workspace, index) => ({
      workspaceId: workspace.id,
      root: workspace.path,
      head: `${index === 0 ? 'a' : 'b'}`.repeat(40),
      execution: 'result',
      childSessionId: `child-${index}`,
      runId: `run-${index}`,
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
      sourceChanged: false,
      observedAtStart: '2026-11-27T12:00:00.000Z',
      observedAtEnd: '2026-11-27T12:00:01.000Z',
    })),
  }
}

async function executeRecord(
  setup: ReturnType<typeof createHarness>,
  requestId: string,
  briefJson: string,
  agent = setup.agent,
) {
  const recorder = setup.toolsByName.get('record_activity_strategic_brief')?.definition
  if (recorder?.execute === undefined) throw new Error('The explicit assessment recorder was not registered')
  return recorder.execute({ requestId, briefJson }, {
    agent,
    callId: ToolCallId('strategic-record-validation'),
    signal: new AbortController().signal,
  } as never)
}

function brief() {
  return {
    status: 'complete',
    repositories: workspaceIds.map((workspaceId, index) => ({
      workspaceId,
      title: `Project ${index + 1}`,
      status: 'observed',
      revision: `${index === 0 ? 'a' : 'b'}`.repeat(40),
      workingTree: 'clean',
      sourceChanged: false,
      observedAtStart: '2026-11-27T12:00:00.000Z',
      observedAtEnd: '2026-11-27T12:00:01.000Z',
    })),
    evidence: workspaceIds.map((workspaceId, index) => ({
      id: `E${index + 1}`,
      workspaceId,
      revision: `${index === 0 ? 'a' : 'b'}`.repeat(40),
      path: `docs/project-${index + 1}.md`,
      note: `Observed repository source ${index + 1}.`,
    })),
    findings: [{ kind: 'source-observation', category: 'capability', statement: 'Both selected repositories have source evidence.', evidenceIds: ['E1', 'E2'] }],
    alternatives: [
      { name: 'Reuse the current integration', consequence: 'Keeps existing runtime ownership.', evidenceIds: ['E1', 'E2'], uncertaintyIds: [] },
      { name: 'Add a narrow adapter', consequence: 'Adds a new integration point.', evidenceIds: ['E1', 'E2'], uncertaintyIds: [] },
    ],
    uncertainties: [],
    recommendation: {
      disposition: 'INVESTIGATE',
      responsibility: 'Compare the two repository integration paths.',
      rationale: 'The selected sources establish relevant capabilities.',
      scope: 'within-activity',
      evidenceIds: ['E1', 'E2'],
      uncertaintyIds: [],
    },
  }
}

it('rejects malformed brief inputs and mismatched authenticated request identities before persistence', async () => {
  const wrongWorkspaceBrief = {
    ...brief(),
    repositories: brief().repositories.map((repository, index) => index === 0
      ? { ...repository, workspaceId: '00000000-0000-4000-8000-000000000099' }
      : repository),
    evidence: brief().evidence.map((reference, index) => index === 0
      ? { ...reference, workspaceId: '00000000-0000-4000-8000-000000000099' }
      : reference),
  }
  const invalidCases = [
    { requestId: 'not-the-request', briefJson: JSON.stringify(brief()), message: 'does not match a live explicit assessment request' },
    { requestId: undefined, briefJson: '{', message: 'must be valid JSON' },
    { requestId: undefined, briefJson: '{}', message: 'was not saved:' },
    { requestId: undefined, briefJson: 'x'.repeat(64 * 1024 + 1), message: 'exceeds the 64 KiB limit' },
    { requestId: undefined, briefJson: JSON.stringify(wrongWorkspaceBrief), message: 'exactly the two explicitly selected Workspaces' },
  ]

  for (const invalid of invalidCases) {
    const setup = createHarness(async name => skill(name))
    expect(await assess(setup)).toMatchObject({ kind: 'success' })
    const requestId = /Request ID: ([0-9a-f-]{36})/u.exec(setup.steeredText())?.[1]
    if (requestId === undefined) throw new Error('The assessment request id was not included in its instruction')
    await expect(executeRecord(setup, invalid.requestId ?? requestId, invalid.briefJson)).rejects.toThrow(invalid.message)
    expect(setup.record).not.toHaveBeenCalled()
  }

  const setup = createHarness(async name => skill(name))
  expect(await assess(setup)).toMatchObject({ kind: 'success' })
  const requestId = /Request ID: ([0-9a-f-]{36})/u.exec(setup.steeredText())?.[1]
  if (requestId === undefined) throw new Error('The assessment request id was not included in its instruction')
  await expect(executeRecord(setup, requestId, JSON.stringify(brief()), { ...setup.agent } as never))
    .rejects.toThrow('requires the live requesting Agent')
  await expect(executeRecord(setup, requestId, JSON.stringify(brief())))
    .rejects.toThrow('requires a successful read-only coordinator result')
  expect(setup.record).not.toHaveBeenCalled()
})

it('rejects malformed coordinator reports without saving an assessment', async () => {
  const invalidReports: readonly { readonly name: string; readonly mutate: (setup: ReturnType<typeof createHarness>) => unknown }[] = [
    { name: 'non-record metadata', mutate: () => null },
    { name: 'missing repository array', mutate: () => ({}) },
    { name: 'wrong repository count', mutate: setup => ({ repositories: coordinatorReport(setup).repositories.slice(0, 1) }) },
    { name: 'non-record repository', mutate: setup => ({ repositories: [null, ...coordinatorReport(setup).repositories.slice(1)] }) },
    { name: 'non-string Workspace id', mutate: setup => changeFirst(setup, 'workspaceId', 5) },
    { name: 'non-string repository root', mutate: setup => changeFirst(setup, 'root', 5) },
    { name: 'non-string source revision', mutate: setup => changeFirst(setup, 'head', 5) },
    { name: 'malformed source revision', mutate: setup => changeFirst(setup, 'head', 'short') },
    { name: 'unsupported execution result', mutate: setup => changeFirst(setup, 'execution', 'unknown') },
    { name: 'invalid source stability', mutate: setup => changeFirst(setup, 'sourceChanged', 'yes') },
    { name: 'invalid child Session identity', mutate: setup => changeFirst(setup, 'childSessionId', 5) },
    { name: 'invalid run identity', mutate: setup => changeFirst(setup, 'runId', 5) },
    { name: 'negative staged count', mutate: setup => changeFirst(setup, 'stagedCount', -1) },
    { name: 'fractional unstaged count', mutate: setup => changeFirst(setup, 'unstagedCount', 0.5) },
    { name: 'negative untracked count', mutate: setup => changeFirst(setup, 'untrackedCount', -1) },
    { name: 'invalid observation start', mutate: setup => changeFirst(setup, 'observedAtStart', 'yesterday') },
    { name: 'invalid observation end', mutate: setup => changeFirst(setup, 'observedAtEnd', 'later') },
    { name: 'duplicate Workspace identities', mutate: (setup) => {
      const report = coordinatorReport(setup)
      const first = report.repositories[0]
      const second = report.repositories[1]
      if (first === undefined || second === undefined) throw new Error('Expected two selected Workspace observations')
      return { repositories: [first, { ...second, workspaceId: first.workspaceId }] }
    } },
  ]

  for (const invalid of invalidReports) {
    const setup = createHarness(async name => skill(name))
    expect(await assess(setup)).toMatchObject({ kind: 'success' })
    emitCoordinatorResult(setup, invalid.mutate(setup))
    expect(setup.toolsByName.get('record_activity_strategic_brief')?.options.when?.({ agent: setup.agent } as never)).toBe(false)
    expect(setup.guards[0]?.({ name: 'shell', agent: setup.agent } as never)).toContain('was canceled')
    expect(setup.record).not.toHaveBeenCalled()
  }
})

it('ignores unrelated coordinator calls without consuming the one-shot selected-source read', async () => {
  const setup = createHarness(async name => skill(name))
  expect(await assess(setup)).toMatchObject({ kind: 'success' })
  const selectedRoots = setup.workspaces.map(workspace => workspace.path)
  const unrelated = JSON.stringify({ repositories: [selectedRoots[0], 'C:\\unselected\\repo'], task: 'Inspect selected sources.' })
  emitCoordinatorResult(setup, coordinatorReport(setup), '{')
  emitCoordinatorResult(setup, coordinatorReport(setup), unrelated)
  emitCoordinatorResult(setup)

  const requestId = /Request ID: ([0-9a-f-]{36})/u.exec(setup.steeredText())?.[1]
  if (requestId === undefined) throw new Error('The assessment request id was not included in its instruction')
  await expect(executeRecord(setup, requestId, JSON.stringify(brief()))).resolves.toMatchObject({ saved: true })
  expect(setup.record).toHaveBeenCalledTimes(1)
})

it('cancels untrusted coordinator events and accepts only a current selected-source result', async () => {
  const setup = createHarness(async name => skill(name))
  expect(await assess(setup)).toMatchObject({ kind: 'success' })
  const selectedArguments = JSON.stringify({ repositories: setup.workspaces.map(workspace => workspace.path), task: 'Inspect selected sources.' })
  const emitCall = (session: { id: string }, seq: number, name: string, argumentsJson = selectedArguments, callId = ToolCallId(`call-${seq}-${name}`)) => {
    setup.ctx.emit('session/event', session as never, {
      type: 'tool/call', seq,
      data: { turn: 1, step: 1, callId, name, arguments: argumentsJson },
    } as never)
    return callId
  }
  emitCall({ id: 'unrelated-session' }, 1, 'coordinate_repositories')
  emitCall(setup.agent.session, -1, 'coordinate_repositories')
  emitCall(setup.agent.session, 1, 'shell')
  emitCall(setup.agent.session, 1, 'coordinate_repositories', JSON.stringify({ repositories: [setup.workspaces[0]?.path, setup.workspaces[0]?.path], task: 'Inspect selected sources.' }))
  emitCall(setup.agent.session, 1, 'coordinate_repositories', JSON.stringify({ repositories: 'not-an-array' }))
  const callId = emitCall(setup.agent.session, 1, 'coordinate_repositories')
  expect(setup.guards[0]?.({ name: 'coordinate_repositories', callId, agent: setup.agent } as never)).toBeUndefined()
  emitCall(setup.agent.session, 2, 'coordinate_repositories')

  setup.ctx.emit('session/event', setup.agent.session as never, {
    type: 'tool/result', seq: 3,
    data: { turn: 1, step: 1, message: { toolCallId: ToolCallId('unrelated-result'), isError: false }, meta: coordinatorReport(setup) },
  } as never)
  expect(setup.guards[0]?.({ name: 'record_activity_strategic_brief', agent: setup.agent } as never)).toContain('only after the selected repository coordinator returns')
  setup.ctx.emit('session/event', setup.agent.session as never, {
    type: 'tool/result', seq: 4,
    data: { turn: 1, step: 1, message: { toolCallId: callId, isError: true }, meta: coordinatorReport(setup) },
  } as never)
  expect(setup.guards[0]?.({ name: 'shell', agent: setup.agent } as never)).toContain('was canceled')
  expect(setup.toolsByName.get('record_activity_strategic_brief')?.options.when?.({ agent: setup.agent } as never)).toBe(false)
  expect(setup.record).not.toHaveBeenCalled()
})

it('requires coordinator source identities and roots to match the selected Workspaces exactly', async () => {
  const setup = createHarness(async name => skill(name))
  expect(await assess(setup)).toMatchObject({ kind: 'success' })
  const mismatchedWorkspace = coordinatorReport(setup)
  const first = mismatchedWorkspace.repositories[0]
  if (first === undefined) throw new Error('Expected a first repository observation')
  emitCoordinatorResult(setup, { repositories: [{ ...first, workspaceId: 'unselected-workspace' }, mismatchedWorkspace.repositories[1]] })
  await expect(executeRecord(setup, requestIdFrom(setup), JSON.stringify(brief()))).rejects.toThrow('requires a successful read-only coordinator result')

  const wrongRootSetup = createHarness(async name => skill(name))
  expect(await assess(wrongRootSetup)).toMatchObject({ kind: 'success' })
  const wrongRootReport = coordinatorReport(wrongRootSetup)
  const firstWrongRoot = wrongRootReport.repositories[0]
  if (firstWrongRoot === undefined) throw new Error('Expected a first repository observation')
  emitCoordinatorResult(wrongRootSetup, { repositories: [{ ...firstWrongRoot, root: 'C:\\unselected\\repository' }, wrongRootReport.repositories[1]] })
  await expect(executeRecord(wrongRootSetup, requestIdFrom(wrongRootSetup), JSON.stringify(brief()))).rejects.toThrow('requires a successful read-only coordinator result')
  expect(setup.record).not.toHaveBeenCalled()
  expect(wrongRootSetup.record).not.toHaveBeenCalled()
})

it('records incomplete observations when a selected repository is unavailable or changed', async () => {
  const record = vi.fn(async () => ({ id: 'episode-incomplete', revision: 1, recordedAt: '2026-11-27T12:00:00.000Z' }))
  const setup = createHarness(async name => skill(name), record)
  expect(await assess(setup)).toMatchObject({ kind: 'success' })
  const report = coordinatorReport(setup)
  const second = report.repositories[1]
  const first = report.repositories[0]
  if (first === undefined || second === undefined) throw new Error('Expected two repository observations')
  emitCoordinatorResult(setup, { repositories: [
    { ...first, sourceChanged: true, stagedCount: 1 },
    { ...second, execution: 'startup-error', childSessionId: null, runId: null, observedAtEnd: null, sourceChanged: null },
  ] })
  const incomplete = {
    ...brief(),
    status: 'incomplete' as const,
    evidence: [brief().evidence[0]],
    findings: [{ ...brief().findings[0], evidenceIds: ['E1'] }],
    alternatives: [{ ...brief().alternatives[0], evidenceIds: ['E1'] }],
    recommendation: { ...brief().recommendation, evidenceIds: ['E1'] },
  }
  await expect(executeRecord(setup, requestIdFrom(setup), JSON.stringify(incomplete))).resolves.toMatchObject({ saved: true })
  const saved = record.mock.calls[0]?.[0]
  expect(saved).toMatchObject({
    repositories: [
      { status: 'observed', workingTree: 'dirty', sourceChanged: true, revision: 'a'.repeat(40) },
      { status: 'unavailable', workingTree: 'unknown', sourceChanged: null, revision: null, observedAtStart: null },
    ],
    originSessionId: 'strategic-session',
    activityId,
  })
})

it('requires complete source evidence to remain available, stable, and clean', async () => {
  const cases = [
    {
      name: 'unavailable Workspace',
      mutate: (setup: ReturnType<typeof createHarness>) => {
        const rows = coordinatorReport(setup).repositories
        const first = rows[0]
        const second = rows[1]
        if (first === undefined || second === undefined) throw new Error('Expected two observations')
        return { repositories: [first, { ...second, execution: 'startup-error', childSessionId: null, runId: null, observedAtEnd: null }] }
      },
      error: 'selected Workspace was unavailable',
    },
    {
      name: 'changed source',
      mutate: (setup: ReturnType<typeof createHarness>) => {
        const report = coordinatorReport(setup)
        return { repositories: [changeFirst(setup, 'sourceChanged', true).repositories[0], report.repositories[1]] }
      },
      error: 'changed during observation or source stability is unknown',
    },
    {
      name: 'dirty source tree',
      mutate: (setup: ReturnType<typeof createHarness>) => {
        const report = coordinatorReport(setup)
        return { repositories: [changeFirst(setup, 'stagedCount', 1).repositories[0], report.repositories[1]] }
      },
      error: 'uncommitted source changes or an unknown working-tree state',
    },
  ] as const

  for (const scenario of cases) {
    const setup = createHarness(async name => skill(name))
    expect(await assess(setup)).toMatchObject({ kind: 'success' })
    emitCoordinatorResult(setup, scenario.mutate(setup))
    await expect(executeRecord(setup, requestIdFrom(setup), JSON.stringify(brief()))).rejects.toThrow(scenario.error)
    expect(setup.record).not.toHaveBeenCalled()
  }
})

it('preserves typed persistence errors for callers', async () => {
  for (const error of [
    new ActivityStrategicEpisodeError('invalid-episode', 'The stored report is invalid.'),
    new ActivityStrategicEpisodeStorageError(new Error('database write failed')),
  ]) {
    const setup = createHarness(async name => skill(name), vi.fn(async () => { throw error }))
    expect(await assess(setup)).toMatchObject({ kind: 'success' })
    emitCoordinatorResult(setup)
    await expect(executeRecord(setup, requestIdFrom(setup), JSON.stringify(brief()))).rejects.toBe(error)
    expect(setup.guards[0]?.({ name: 'shell', agent: setup.agent } as never)).toContain('Activity Strategic Brief is active')
  }
})

it('renders the saved record confirmation only for a valid success response', async () => {
  const setup = createHarness(async name => skill(name))
  const recorder = setup.toolsByName.get('record_activity_strategic_brief')?.definition
  if (recorder === undefined) throw new Error('The explicit assessment recorder was not registered')
  expect(recorder.output.render?.({}, null as never)).toEqual([{ type: 'text', text: 'Saved advisory Activity Strategic Brief. It has not been independently verified or accepted.' }])
  expect(recorder.output.render?.({}, { saved: true, episodeId: 'episode-live', revision: 3, recordedAt: '2026-11-27T12:00:00.000Z' })).toEqual([{
    type: 'text',
    text: 'Saved advisory Activity Strategic Brief episode-live (revision 3) at 2026-11-27T12:00:00.000Z. It has not been independently verified or accepted.',
  }])
})

function requestIdFrom(setup: ReturnType<typeof createHarness>): string {
  const requestId = /Request ID: ([0-9a-f-]{36})/u.exec(setup.steeredText())?.[1]
  if (requestId === undefined) throw new Error('The assessment request id was not included in its instruction')
  return requestId
}

function changeFirst(
  setup: ReturnType<typeof createHarness>,
  key: string,
  value: unknown,
): { repositories: Record<string, unknown>[] } {
  const report = coordinatorReport(setup)
  const first = report.repositories[0]
  if (first === undefined) throw new Error('Expected a first selected Workspace observation')
  return { repositories: [{ ...first, [key]: value }, report.repositories[1] ?? {}] }
}
