import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { PROFILE_TEMPLATES } from '@deepseek-ai/dsh-official-bundles'
import type { AgentPresetRegistry } from '@deepseek-ai/dsh-agent-preset-registry'
import { captureActivityDelegationExecutionSelection, isExplicitlyExperimentalPackage } from '../src/execution-selection.ts'

it('classifies an exact shipped profile template but leaves an ordinary preset unclassified', () => {
  const context = new Context()
  const presets: Pick<AgentPresetRegistry, 'composedPreset' | 'inspectCompositions'> = {
    composedPreset: () => 'review',
    inspectCompositions: () => [{
      id: 'review', modules: [{ moduleName: '@deepseek-ai/dsh-command-home-activity', useHostBase: true }],
      leakedServices: [],
    }],
  }

  const selection = captureActivityDelegationExecutionSelection({
    name: 'web', startedBundles: PROFILE_TEMPLATES.web!.bundles,
  }, presets, context)

  expect(selection).toEqual({
    provider: 'spawn',
    profile: {
      status: 'available', name: 'web', startedBundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
      classification: 'stable', classificationSource: 'shipped-profile-template',
    },
    preset: {
      status: 'selected', id: 'review', activeModules: ['@deepseek-ai/dsh-command-home-activity'],
      classification: 'unavailable', classificationSource: 'unavailable',
    },
  })
})

it('classifies only explicitly experimental package identities', () => {
  expect(isExplicitlyExperimentalPackage('@deepseek-ai/dsh-experimental-terminal-bundle')).toBe(true)
  expect(isExplicitlyExperimentalPackage('@deepseek-ai/dsh-terminal-bundle')).toBe(false)
  expect(isExplicitlyExperimentalPackage('@deepseek-ai/dsh-personalized-recommendations')).toBe(true)
  expect(isExplicitlyExperimentalPackage('cordis:experimental-loader')).toBe(false)
})

it('marks a profile or preset unavailable when the product cannot classify its selected composition', () => {
  const context = new Context()
  const presets: Pick<AgentPresetRegistry, 'composedPreset' | 'inspectCompositions'> = {
    composedPreset: () => 'custom-review',
    inspectCompositions: vi.fn(() => { throw new Error('private inspection detail') }),
  }

  expect(captureActivityDelegationExecutionSelection({ name: 'custom', startedBundles: ['@vendor/private-bundle'] }, presets, context))
    .toEqual({
      provider: 'spawn',
      profile: {
        status: 'available', name: 'custom', startedBundles: ['@vendor/private-bundle'],
        classification: 'unavailable', classificationSource: 'unavailable',
      },
      preset: {
        status: 'selected', id: 'custom-review', activeModules: null,
        classification: 'unavailable', classificationSource: 'unavailable',
      },
    })
})

it('treats inherited object names as custom profiles', () => {
  const selection = captureActivityDelegationExecutionSelection({
    name: 'toString', startedBundles: ['@vendor/private-bundle'],
  }, undefined, new Context())

  expect(selection.profile).toEqual({
    status: 'available', name: 'toString', startedBundles: ['@vendor/private-bundle'],
    classification: 'unavailable', classificationSource: 'unavailable',
  })
})

it('records a known absence separately from missing profile and preset services', () => {
  const context = new Context()
  const presets: Pick<AgentPresetRegistry, 'composedPreset' | 'inspectCompositions'> = {
    composedPreset: () => undefined,
    inspectCompositions: () => [],
  }

  expect(captureActivityDelegationExecutionSelection(undefined, presets, context)).toMatchObject({
    profile: { status: 'unavailable', reason: 'runtime-profile-unavailable' },
    preset: { status: 'none' },
  })
  expect(captureActivityDelegationExecutionSelection(undefined, undefined, context)).toMatchObject({
    profile: { status: 'unavailable', reason: 'runtime-profile-unavailable' },
    preset: { status: 'unavailable', reason: 'agent-preset-registry-unavailable' },
  })
})

it('keeps selection failures and oversized configuration from blocking a requested provider start', () => {
  const context = new Context()
  const brokenRegistry: Pick<AgentPresetRegistry, 'composedPreset' | 'inspectCompositions'> = {
    composedPreset: () => { throw new Error('private registry detail') },
    inspectCompositions: () => [],
  }
  const oversizedProfile = {
    name: 'custom',
    startedBundles: Array.from({ length: 257 }, (_, index) => `bundle-${index}`),
  }

  expect(captureActivityDelegationExecutionSelection(oversizedProfile, brokenRegistry, context)).toMatchObject({
    profile: {
      status: 'available', name: 'custom', startedBundles: null,
      classification: 'unavailable', classificationSource: 'unavailable',
    },
    preset: { status: 'unavailable', reason: 'agent-preset-registry-unavailable' },
  })
})
