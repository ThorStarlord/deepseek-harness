import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolGuard, ToolRegistrationOptions } from '@deepseek-ai/dsh-tools'
import { ActivityId } from '@deepseek-ai/dsh-home-activity'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { Workspace } from '@deepseek-ai/dsh-workspace/types'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import {
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

function createHarness(
  loadSkill: (name: string) => Promise<{ name: string; content: string; provider: string }>,
  record = vi.fn(async () => ({ id: 'episode-1', revision: 1, recordedAt: '2026-11-27T12:00:00.000Z' })),
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
    get(name: string) { return name === coordinator.name ? coordinator : toolsByName.get(name)?.definition },
    guard(guard: ToolGuard) {
      guards.push(guard)
      return () => { guards.splice(guards.indexOf(guard), 1) }
    },
    register(definition: ToolDefinition, options: ToolRegistrationOptions = {}) {
      toolsByName.set(definition.name, { definition, options })
      return () => { toolsByName.delete(definition.name) }
    },
  } as never)
  ctx.provide('homeActivities', { get: (id: string) => id === activity.id ? activity : undefined } as never)
  ctx.provide('workspaceRegistry', {
    get: (id: WorkspaceId) => workspaces.find(workspace => workspace.id === id),
  } as never)
  ctx.provide('agents', { get: (id: string) => id === agent.id ? agent : undefined } as never)
  ctx.provide('homeActivityStrategicEpisodes', { record } as never)

  const dispose = registerActivityStrategicBriefTool(ctx)
  const steeredText = (): string => agent.steer.mock.calls
    .flatMap(([message]) => message.content)
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')

  return { ctx, agent, activity, workspaces, toolsByName, guards, dispose, record, steeredText }
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

function emitCoordinatorResult(setup: ReturnType<typeof createHarness>): void {
  const callId = ToolCallId('strategic-coordinator-result')
  setup.ctx.emit('session/event', setup.agent.session as never, {
    type: 'tool/call',
    seq: 1,
    data: {
      turn: 1,
      step: 1,
      callId,
      name: 'coordinate_repositories',
      arguments: JSON.stringify({ repositories: setup.workspaces.map(workspace => workspace.path), task: 'Inspect selected sources.' }),
    },
  } as never)
  setup.ctx.emit('session/event', setup.agent.session as never, {
    type: 'tool/result',
    seq: 2,
    data: {
      turn: 1,
      step: 1,
      message: { toolCallId: callId, isError: false },
      meta: {
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
      },
    },
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
