/** Capture DSH profile and Agent preset facts for one Activity delegation. */
import type { Context } from '@deepseek-ai/cordis'
import {
  EXPERIMENTAL_BUNDLES, EXPERIMENTAL_PACKAGE_NAME_EXCEPTIONS, PROFILE_TEMPLATES,
} from '@deepseek-ai/dsh-official-bundles'
import type { ProfileContext } from '@deepseek-ai/dsh-app-boot'
import type { AgentPresetRegistry } from '@deepseek-ai/dsh-agent-preset-registry'
import type { DshActivityDelegationExecutionSelectionSnapshot } from '@deepseek-ai/dsh-home-activity/delegations'

const MAX_SELECTION_ENTRIES = 256
const MAX_SELECTION_NAME_LENGTH = 256
const EXPERIMENTAL_PACKAGE_PREFIX = '@deepseek-ai/dsh-experimental-'

/** Capture only DSH runtime facts; an external provider must report its own unavailable state.
 * @param profile - Profile name and ordered launcher bundle list, when the `dsh` launcher supplied them.
 * @param presets - Registry that can identify the exact revision joined by the requesting Agent.
 * @param agentContext - Requesting Agent context retained by the DSH child.
 * @returns Detached profile and preset facts captured before provider startup.
 */
export function captureActivityDelegationExecutionSelection(
  profile: Pick<ProfileContext, 'name' | 'startedBundles'> | undefined,
  presets: Pick<AgentPresetRegistry, 'composedPreset' | 'inspectCompositions'> | undefined,
  agentContext: Context,
): DshActivityDelegationExecutionSelectionSnapshot {
  return {
    provider: 'spawn',
    profile: captureProfile(profile),
    preset: capturePreset(presets, agentContext),
  }
}

/** Identify bundle or package names the product explicitly marks experimental.
 * @param specifier - Configured bundle or plugin module name.
 * @returns Whether its exact package identity is marked experimental.
 */
export function isExplicitlyExperimentalPackage(specifier: string): boolean {
  const packageName = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
  return packageName !== undefined
    && (EXPERIMENTAL_BUNDLES.has(packageName)
      || EXPERIMENTAL_PACKAGE_NAME_EXCEPTIONS.has(packageName)
      || packageName.startsWith(EXPERIMENTAL_PACKAGE_PREFIX))
}

function captureProfile(
  profile: Pick<ProfileContext, 'name' | 'startedBundles'> | undefined,
): DshActivityDelegationExecutionSelectionSnapshot['profile'] {
  if (profile === undefined) return { status: 'unavailable', reason: 'runtime-profile-unavailable' }
  if (!isPersistableName(profile.name)) {
    return { status: 'unavailable', reason: 'profile-identity-exceeds-persistence-limit' }
  }
  if (!isPersistableList(profile.startedBundles)) {
    return {
      status: 'available', name: profile.name, startedBundles: null,
      classification: 'unavailable', classificationSource: 'unavailable',
    }
  }
  const startedBundles = [...profile.startedBundles]
  const hasExperimentalBundle = startedBundles.some(isExplicitlyExperimentalPackage)
  const template = Object.hasOwn(PROFILE_TEMPLATES, profile.name) ? PROFILE_TEMPLATES[profile.name] : undefined
  const matchesShippedTemplate = template !== undefined && sameStrings(startedBundles, template.bundles)
  const classification = hasExperimentalBundle
    ? 'experimental'
    : matchesShippedTemplate ? 'stable' : 'unavailable'
  const classificationSource = hasExperimentalBundle
    ? 'experimental-package-metadata'
    : matchesShippedTemplate ? 'shipped-profile-template' : 'unavailable'
  return {
    status: 'available',
    name: profile.name,
    startedBundles,
    classification,
    classificationSource,
  }
}

function capturePreset(
  presets: Pick<AgentPresetRegistry, 'composedPreset' | 'inspectCompositions'> | undefined,
  agentContext: Context,
): DshActivityDelegationExecutionSelectionSnapshot['preset'] {
  if (presets === undefined) return { status: 'unavailable', reason: 'agent-preset-registry-unavailable' }
  let id: string | undefined
  try {
    id = presets.composedPreset(agentContext)
  } catch (error: unknown) {
    void error
    // Captured selection details are ancillary; a registry read failure must not block an explicitly requested activation.
    return { status: 'unavailable', reason: 'agent-preset-registry-unavailable' }
  }
  if (id === undefined) return { status: 'none' }
  if (!isPersistableName(id)) {
    return { status: 'unavailable', reason: 'preset-identity-exceeds-persistence-limit' }
  }
  let modules: readonly { readonly moduleName: string }[] | undefined
  try {
    modules = presets.inspectCompositions(agentContext).find(composition => composition.id === id)?.modules
  } catch (error: unknown) {
    void error
    // Captured selection details are ancillary; an inspection failure must not block an explicitly requested activation.
    return unavailablePresetDetails(id)
  }
  if (modules === undefined || !isPersistableList(modules.map(module => module.moduleName))) {
    return unavailablePresetDetails(id)
  }
  const activeModules = modules.map(module => module.moduleName)
  const hasExperimentalModule = activeModules.some(isExplicitlyExperimentalPackage)
  return {
    status: 'selected',
    id,
    activeModules,
    classification: hasExperimentalModule ? 'experimental' : 'unavailable',
    classificationSource: hasExperimentalModule ? 'experimental-package-metadata' : 'unavailable',
  }
}

function unavailablePresetDetails(id: string): DshActivityDelegationExecutionSelectionSnapshot['preset'] {
  return {
    status: 'selected',
    id,
    activeModules: null,
    classification: 'unavailable',
    classificationSource: 'unavailable',
  }
}

function isPersistableList(values: readonly string[]): boolean {
  return values.length <= MAX_SELECTION_ENTRIES && values.every(isPersistableName)
}

function isPersistableName(value: string): boolean {
  return value.length > 0 && value.length <= MAX_SELECTION_NAME_LENGTH
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
