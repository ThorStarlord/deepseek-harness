import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AgentPresetRegistry } from '@deepseek-ai/dsh-agent-preset-registry'
import { CommandId } from '@deepseek-ai/dsh-commands'
import type { CommandInvocation } from '@deepseek-ai/dsh-commands'
import Storage, { StorageError } from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import HomeActivityService from '@deepseek-ai/dsh-home-activity'
import HomeActivityDelegations from '@deepseek-ai/dsh-home-activity/delegations'
import type { ActivityDelegation } from '@deepseek-ai/dsh-home-activity/delegations'
import { PROFILE_TEMPLATES } from '@deepseek-ai/dsh-official-bundles'
import type { SubagentActivation, SubagentActivationSpec, SubagentResult } from '@deepseek-ai/dsh-subagent'
import { SubagentError, SubagentRunId } from '@deepseek-ai/dsh-subagent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { captureActivityDelegationExecutionSelection } from '../src/execution-selection.ts'
import { executeActivityDelegation } from '../src/delegation-command.ts'

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

interface Fixture {
  readonly ctx: Context
  readonly activityId: ActivityDelegation['activityId']
  readonly invocation: CommandInvocation
  readonly signal: AbortSignal
}

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-delegation-coverage-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(HomeActivityService)
  await ctx.plugin(HomeActivityDelegations)
  const activity = await ctx.homeActivities.create({
    name: 'Delegation qualification',
    objective: 'Record an explicitly requested, bounded provider execution.',
    boundaries: { inScope: ['Review the release checklist.'], outOfScope: ['Publish the release.'] },
  })
  const sessionId = SessionId('delegation-command-coverage-parent')
  const agent = {
    id: sessionId,
    session: { id: sessionId },
    ctx: new Context(),
  } as Agent
  const signal = new AbortController().signal
  const invocation: CommandInvocation = {
    commandId: CommandId('delegation-command-coverage'),
    agent,
    rawInput: '',
    attachments: [],
    signal,
  }
  return { ctx, activityId: activity.id, invocation, signal }
}

function installSubagents(
  ctx: Context,
  providers: readonly string[],
  start: (spec: SubagentActivationSpec) => Promise<SubagentActivation>,
) {
  const service = {
    getProvider: vi.fn((provider: string) => providers.includes(provider) ? { name: provider } : undefined),
    startActivation: vi.fn(start),
  }
  ctx.provide('subagents', service as never)
  vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
  return service
}

function activation(
  spec: SubagentActivationSpec,
  result: Promise<SubagentResult>,
): SubagentActivation {
  if (spec.childId === undefined || spec.name === undefined) throw new Error('Spawn activation lacked its requested identities.')
  return { childId: spec.childId, name: spec.name, result, dispose: async () => {} }
}

async function waitForRecord(
  ctx: Context,
  activityId: ActivityDelegation['activityId'],
  status: ActivityDelegation['status'],
): Promise<ActivityDelegation> {
  let record: ActivityDelegation | undefined
  await vi.waitFor(() => {
    record = ctx.homeActivityDelegations.list(activityId)[0]
    expect(record?.status).toBe(status)
  }, { timeout: 5_000 })
  if (record === undefined) throw new Error('The delegation record was not saved.')
  return record
}

describe('Activity delegation command lifecycle', () => {
  it('persists the exact request before dispatch and records the accepted result once', async () => {
    const test = await fixture()
    const result = Promise.withResolvers<SubagentResult>()
    const task = 'Review the release checklist for missing migration verification.'
    const runtimeProfile = { name: 'web', startedBundles: PROFILE_TEMPLATES.web!.bundles }
    test.ctx.provide('profileContext', runtimeProfile as never)
    test.ctx.provide('agentPresets', {
      composedPreset: () => 'review',
      inspectCompositions: () => [{
        id: 'review', modules: [{ moduleName: '@deepseek-ai/dsh-experimental-review' }], leakedServices: [],
      }],
    } as never)

    let requestAtDispatch: ActivityDelegation | undefined
    let dispatchedSpec: SubagentActivationSpec | undefined
    const subagents = installSubagents(test.ctx, ['spawn'], async (spec) => {
      requestAtDispatch = test.ctx.homeActivityDelegations.list(test.activityId)[0]
      dispatchedSpec = spec
      const childSessionId = spec.childId
      if (childSessionId === undefined) throw new Error('The saved request did not select a child Session id.')
      test.ctx.emit('subagent/start', {
        id: childSessionId,
        parentSessionId: spec.parent.session.id,
        provider: 'spawn',
        runId: SubagentRunId('delegation-coverage-run'),
        local: true,
      })
      return activation(spec, result.promise)
    })

    const started = await executeActivityDelegation(test.ctx, test.invocation, `${test.activityId} spawn ${task}`)
    expect(started.kind).toBe('success')
    expect(started.text).toContain('Delegation admitted: provider spawn')
    expect(requestAtDispatch).toMatchObject({ status: 'requested', request: { task, source: 'user-command' } })
    expect(dispatchedSpec).toMatchObject({
      provider: 'spawn',
      prompt: [{ type: 'text', text: task }],
      signal: test.signal,
      delivery: 'caller',
    })
    expect(dispatchedSpec?.parent).toBe(test.invocation.agent)
    expect(subagents.startActivation).toHaveBeenCalledTimes(1)

    const admitted = test.ctx.homeActivityDelegations.list(test.activityId)[0]
    expect(admitted).toMatchObject({ status: 'admitted', admission: { runId: 'delegation-coverage-run' } })
    expect(admitted?.request.executionSelection).toEqual({
      provider: 'spawn',
      profile: {
        status: 'available',
        name: 'web',
        startedBundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
        classification: 'stable',
        classificationSource: 'shipped-profile-template',
      },
      preset: {
        status: 'selected',
        id: 'review',
        activeModules: ['@deepseek-ai/dsh-experimental-review'],
        classification: 'experimental',
        classificationSource: 'experimental-package-metadata',
      },
    })

    result.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'Migration validation is missing.' }] })
    const reported = await waitForRecord(test.ctx, test.activityId, 'reported')
    expect(reported).toMatchObject({
      status: 'reported',
      report: { stopReason: 'completed', outputText: 'Migration validation is missing.', source: 'subagent-activation-result' },
    })
    expect(reported.admission).toEqual(admitted?.admission)
    expect(subagents.startActivation).toHaveBeenCalledTimes(1)
  })

  it('does not dispatch when the request save fails and allows only a later explicit retry', async () => {
    const test = await fixture()
    const result = Promise.resolve<SubagentResult>({ stopReason: 'completed', output: [] })
    const subagents = installSubagents(test.ctx, ['spawn'], async spec => activation(spec, result))
    vi.spyOn(test.ctx.homeActivityDelegations, 'createRequest')
      .mockRejectedValueOnce(new StorageError('unknown-state', 'private storage detail'))
    const input = `${test.activityId} spawn Inspect the release checklist.`

    const failed = await executeActivityDelegation(test.ctx, test.invocation, input)
    expect(failed).toEqual({
      kind: 'error',
      text: 'Delegation request could not be saved; no provider start was attempted.',
    })
    expect(subagents.startActivation).not.toHaveBeenCalled()
    expect(test.ctx.homeActivityDelegations.list(test.activityId)).toEqual([])

    const explicitlyRetried = await executeActivityDelegation(test.ctx, test.invocation, input)
    expect(explicitlyRetried.kind).toBe('success')
    expect(subagents.startActivation).toHaveBeenCalledTimes(1)
    await waitForRecord(test.ctx, test.activityId, 'reported')
    expect(test.ctx.homeActivityDelegations.list(test.activityId)).toHaveLength(1)
  })

  it('retains an ambiguous external start as unconfirmed without dispatching it again', async () => {
    const test = await fixture()
    const subagents = installSubagents(test.ctx, ['codex'], async () => {
      throw new Error('private provider transport detail')
    })

    const started = await executeActivityDelegation(test.ctx, test.invocation, `${test.activityId} codex Review the checklist once.`)

    expect(started.kind).toBe('error')
    expect(started.text).toContain('DSH could not confirm whether Codex started.')
    expect(started.text).toContain('do not repeat this task unless you have independently confirmed it did not start')
    expect(test.ctx.homeActivityDelegations.list(test.activityId)).toMatchObject([{
      status: 'unconfirmed',
      request: { provider: 'codex', source: 'user-command' },
      uncertainty: { reason: 'codex-start-outcome-unknown' },
    }])
    expect(subagents.startActivation).toHaveBeenCalledTimes(1)
  })

  it('records a definite pre-dispatch refusal separately from an uncertain external start', async () => {
    const test = await fixture()
    const subagents = installSubagents(test.ctx, ['spawn'], async () => {
      throw new SubagentError('provider changed before dispatch', 'NOT_DISPATCHED')
    })

    const rejected = await executeActivityDelegation(test.ctx, test.invocation, `${test.activityId} spawn Inspect the checklist.`)

    expect(rejected.kind).toBe('error')
    expect(rejected.text).toContain('did not call the DSH spawn provider')
    expect(rejected.text).not.toContain('do not repeat this task')
    expect(test.ctx.homeActivityDelegations.list(test.activityId)).toMatchObject([{
      status: 'not-admitted',
      failure: { source: 'subagents.startActivation' },
    }])
    expect(subagents.startActivation).toHaveBeenCalledTimes(1)
  })

  it('records an unavailable external provider without attempting activation and reports an uncertain save failure', async () => {
    const test = await fixture()
    const unavailable = installSubagents(test.ctx, [], async () => {
      throw new Error('An unavailable provider must not be activated.')
    })

    const result = await executeActivityDelegation(
      test.ctx,
      test.invocation,
      `${test.activityId} codex Review the release checklist once.`,
    )

    expect(result.kind).toBe('error')
    expect(result.text).toContain('Codex provider is unavailable; DSH did not attempt activation.')
    expect(unavailable.startActivation).not.toHaveBeenCalled()
    expect(test.ctx.homeActivityDelegations.list(test.activityId)).toMatchObject([{ status: 'not-admitted' }])

    const persistenceFailure = await fixture()
    const unavailableWithoutRecordedStatus = installSubagents(persistenceFailure.ctx, [], async () => {
      throw new Error('An unavailable provider must not be activated.')
    })
    vi.spyOn(persistenceFailure.ctx.homeActivityDelegations, 'markNotAdmitted')
      .mockRejectedValueOnce(new StorageError('unknown-state', 'private persistence detail'))

    const failedSave = await executeActivityDelegation(
      persistenceFailure.ctx,
      persistenceFailure.invocation,
      `${persistenceFailure.activityId} codex Review the release checklist once.`,
    )

    expect(failedSave.kind).toBe('error')
    expect(failedSave.text).toContain('Saving this Activity state failed; no provider call occurred.')
    expect(unavailableWithoutRecordedStatus.startActivation).not.toHaveBeenCalled()
    expect(persistenceFailure.ctx.homeActivityDelegations.list(persistenceFailure.activityId)).toMatchObject([{ status: 'requested' }])
  })

  it('keeps an uncertain Claude Code start unconfirmed when its state write also fails', async () => {
    const test = await fixture()
    const subagents = installSubagents(test.ctx, ['claude-code'], async () => {
      throw new Error('private provider transport detail')
    })
    vi.spyOn(test.ctx.homeActivityDelegations, 'markUnconfirmed')
      .mockRejectedValueOnce(new StorageError('unknown-state', 'private persistence detail'))

    const result = await executeActivityDelegation(
      test.ctx,
      test.invocation,
      `${test.activityId} claude-code Review the release checklist once.`,
    )

    expect(result.kind).toBe('error')
    expect(result.text).toContain('Saving the Activity status also failed; check the Activity after storage is available.')
    expect(test.ctx.homeActivityDelegations.list(test.activityId)).toMatchObject([{ status: 'requested' }])
    expect(subagents.startActivation).toHaveBeenCalledTimes(1)
  })

  it('keeps a changed pre-dispatch provider from being treated as an uncertain start', async () => {
    const test = await fixture()
    const subagents = installSubagents(test.ctx, ['spawn'], async () => {
      throw new SubagentError('The selected provider changed.', 'PROVIDER_CHANGED')
    })
    vi.spyOn(test.ctx.homeActivityDelegations, 'markNotAdmitted')
      .mockRejectedValueOnce(new StorageError('unknown-state', 'private persistence detail'))

    const result = await executeActivityDelegation(
      test.ctx,
      test.invocation,
      `${test.activityId} spawn Review the release checklist once.`,
    )

    expect(result.kind).toBe('error')
    expect(result.text).toContain('provider changed before dispatch, so DSH did not start this task.')
    expect(result.text).toContain('Saving this Activity status failed; check the Activity before submitting another request.')
    expect(result.text).not.toContain('do not repeat this task')
    expect(subagents.startActivation).toHaveBeenCalledTimes(1)
    expect(test.ctx.homeActivityDelegations.list(test.activityId)).toMatchObject([{ status: 'requested' }])
  })

  it('reports provider admission when persisting the admission record fails', async () => {
    const test = await fixture()
    const subagents = installSubagents(test.ctx, ['spawn'], async spec => activation(
      spec,
      Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'Checklist reviewed.' }] }),
    ))
    vi.spyOn(test.ctx.homeActivityDelegations, 'recordAdmitted')
      .mockRejectedValueOnce(new StorageError('unknown-state', 'private persistence detail'))

    const result = await executeActivityDelegation(
      test.ctx,
      test.invocation,
      `${test.activityId} spawn Review the release checklist once.`,
    )

    expect(result.kind).toBe('success')
    expect(result.text).toContain('Delegation admitted but not durably confirmed: provider spawn')
    expect(result.text).toContain('Execution was accepted by DSH, but the admission record could not be confirmed.')
    expect(subagents.startActivation).toHaveBeenCalledTimes(1)
  })

  it('preserves the uncertain one-shot warning when external admission persistence fails', async () => {
    const test = await fixture()
    const subagents = installSubagents(test.ctx, ['codex'], async () => ({
      childId: SessionId('codex-coverage-session'),
      name: 'codex-coverage-run',
      result: Promise.resolve({ stopReason: 'completed', output: [] }),
      dispose: async () => {},
    }))
    vi.spyOn(test.ctx.homeActivityDelegations, 'recordAdmitted')
      .mockRejectedValueOnce(new StorageError('unknown-state', 'private persistence detail'))

    const result = await executeActivityDelegation(
      test.ctx,
      test.invocation,
      `${test.activityId} codex Review the release checklist once.`,
    )

    expect(result.kind).toBe('success')
    expect(result.text).toContain('Delegation admitted but not durably confirmed: provider codex')
    expect(result.text).toContain('Execution was accepted by DSH, but its admission record could not be confirmed.')
    expect(result.text).toContain('do not treat this record as proof it did not run')
    expect(subagents.startActivation).toHaveBeenCalledTimes(1)
  })
})

describe('Activity delegation execution selection limits', () => {
  it('records oversized profile and preset data as unavailable without changing the requested task', () => {
    const longIdentity = 'p'.repeat(257)
    const oversizedBundles = Array.from({ length: 257 }, (_, index) => `bundle-${index}`)
    const longPreset = 'r'.repeat(257)
    const oversizedModules = Array.from({ length: 257 }, (_, index) => ({ moduleName: `module-${index}`, useHostBase: true }))
    const context = new Context()
    const oversizedRegistry: Pick<AgentPresetRegistry, 'composedPreset' | 'inspectCompositions'> = {
      composedPreset: () => 'review',
      inspectCompositions: () => [{ id: 'review', modules: oversizedModules, leakedServices: [] }],
    }
    const longPresetRegistry: Pick<AgentPresetRegistry, 'composedPreset' | 'inspectCompositions'> = {
      composedPreset: () => longPreset,
      inspectCompositions: () => [],
    }
    const selection = captureActivityDelegationExecutionSelection(
      { name: 'custom', startedBundles: oversizedBundles },
      oversizedRegistry,
      context,
    )
    const longNames = captureActivityDelegationExecutionSelection(
      { name: longIdentity, startedBundles: [] },
      longPresetRegistry,
      context,
    )

    expect(selection).toMatchObject({
      profile: { status: 'available', name: 'custom', startedBundles: null, classification: 'unavailable' },
      preset: { status: 'selected', id: 'review', activeModules: null, classification: 'unavailable' },
    })
    expect(longNames).toMatchObject({
      profile: { status: 'unavailable', reason: 'profile-identity-exceeds-persistence-limit' },
      preset: { status: 'unavailable', reason: 'preset-identity-exceeds-persistence-limit' },
    })
  })
})
