import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import { expect, it } from 'vitest'

const standardPatch = fileURLToPath(new URL('../presets/standard.patch.yml', import.meta.url))
const skillRoot = fileURLToPath(new URL('../skills/', import.meta.url))

it('exposes evidence-aware completion guidance through the standard Web preset', async (test) => {
  const standardEntries = loadOverlayPatches('evidence-aware-completion', standardPatch)
    .flatMap(patch => patch.insert ?? [])
  const standardPreset = standardEntries.find(entry => entry.id === 'preset-standard')
  expect(standardPreset).toBeDefined()
  const presetText = JSON.stringify(standardPreset)
  expect(presetText).toContain("resolve('@deepseek-ai/dsh-web-app/package.json')")
  expect(presetText).toContain("'skills')")

  const ctx = new Context()
  test.onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillFileSystem, {
    includeDefaultRoots: false,
    watch: false,
    bundledSkillDir: skillRoot,
  })

  const skill = await ctx.skills.get('evidence-aware-completion')
  expect(skill).toMatchObject({
    source: 'bundled',
    invocation: { modelInvocable: true, userInvocable: false },
  })
  expect(skill?.content).toContain('A successful tool result establishes what that command reported')
  expect(skill?.content).toContain('**Passed:**')
  expect(skill?.content).toContain('**Failed:**')
  expect(skill?.content).toContain('**Skipped:**')
  expect(skill?.content).toContain('**Blocked:**')
  expect(skill?.content).toContain('**Not observed:**')
  expect(skill?.content).toContain('**Unknown:**')
  expect(skill?.content).toContain('matching command completed successfully')
  expect(skill?.content).toContain('reported a test or validation failure')
  expect(skill?.content).toContain('explicitly skipped')
  expect(skill?.content).toContain('environment prevented the check from starting or completing')
  expect(skill?.content).toContain('I cannot confirm whether tests ran elsewhere.')
  expect(skill?.content).toContain('does not prove semantic correctness or independent review')
  expect(skill?.content).toContain('Do not load it for casual conversation or unrelated requests.')
  expect(skill?.content).toContain('Do not rerun tests, start another agent, or continue a loop')
})

it('offers test-driven development only through explicit Web invocation', async (test) => {
  const ctx = new Context()
  test.onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillFileSystem, {
    includeDefaultRoots: false,
    watch: false,
    bundledSkillDir: skillRoot,
  })

  const skill = await ctx.skills.get('test-driven-development')
  expect(skill).toMatchObject({
    source: 'bundled',
    invocation: { modelInvocable: false, userInvocable: true },
  })
  expect(skill?.description).toContain('explicitly invokes this Skill')
  expect(skill?.content).toContain('Confirm that it fails because the behavior is missing.')
  expect(skill?.content).toContain('Make the smallest implementation that satisfies the test.')
  expect(skill?.content).toContain('do not run the entire suite solely because more checks exist')
  expect(skill?.content).toContain('Do not delete existing implementation or user changes')
  expect(skill?.content).toContain('Follow the selected profile\'s available tools, approval rules, and sandbox.')
})
