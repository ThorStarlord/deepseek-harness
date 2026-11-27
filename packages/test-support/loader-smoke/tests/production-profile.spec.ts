import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { bootProductionProfile } from '../src/production-profile.ts'

const overlayPath = fileURLToPath(new URL('./fixtures/production-profile.patch.yml', import.meta.url))
const ENVIRONMENT_KEYS = ['DSH_HOME', 'DSH_AGENTS_HOME', 'USERPROFILE', 'HOME'] as const
const PROFILE_BOOT_TIMEOUT_MS = 30_000

describe.sequential('bootProductionProfile', () => {
  it('rejects overlays outside the supported filename contract before loading a profile', async () => {
    await expect(bootProductionProfile({
      binName: 'loader-smoke-test',
      profile: 'headless',
      overlayPaths: ['invalid.yml'],
    })).rejects.toThrow('loader-smoke-test: test overlay path must end in .patch.yml: invalid.yml')
  })

  it('uses a private home fallback and prepares the composed context without overlays', async () => {
    const userHome = await mkdtemp(join(tmpdir(), 'loader-smoke-profile-home-'))
    const savedEnvironment = Object.fromEntries(ENVIRONMENT_KEYS.map(name => [name, process.env[name]]))
    let context: Context | undefined
    let prepared = false
    try {
      Reflect.deleteProperty(process.env, 'DSH_HOME')
      process.env['USERPROFILE'] = userHome
      process.env['HOME'] = userHome
      const expectedDshHome = join(homedir(), '.dsh')
      expect(expectedDshHome).toBe(join(userHome, '.dsh'))

      context = await bootProductionProfile({
        binName: 'loader-smoke-test',
        profile: 'headless',
        overlayPaths: [],
        prepare: (root) => {
          expect(root.get('profileContext').home).toBe(expectedDshHome)
          prepared = true
        },
      })

      expect(context.get('profileContext').home).toBe(expectedDshHome)
      expect(prepared).toBe(true)
    } finally {
      await context?.fiber.dispose()
      restoreEnvironment(savedEnvironment)
      await rm(userHome, { recursive: true, force: true })
    }
  }, PROFILE_BOOT_TIMEOUT_MS)

  it('adds only resolvable overlay packages, including nested group entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loader-smoke-profile-overlay-'))
    const savedEnvironment = Object.fromEntries(ENVIRONMENT_KEYS.map(name => [name, process.env[name]]))
    let context: Context | undefined
    try {
      process.env['DSH_HOME'] = join(root, '.dsh')
      process.env['DSH_AGENTS_HOME'] = join(root, '.agents')
      const savedHome = process.env['DSH_HOME']

      context = await bootProductionProfile({
        binName: 'loader-smoke-test',
        profile: 'headless',
        overlayPaths: [overlayPath],
      })

      expect(context.get('profileContext').home).toBe(savedHome)
      const resolution = context.get('pluginPackages').resolution
      expect(resolution).toBeDefined()
      const overlayPackages = resolution?.entries
        .filter(entry => entry.name.startsWith('test-overlay:'))
        .map(entry => entry.name)
        .sort()
      expect(overlayPackages).toEqual([
        'test-overlay:0:@deepseek-ai/dsh-agent',
        'test-overlay:1:@deepseek-ai/dsh-llm',
        'test-overlay:2:@deepseek-ai/dsh-session',
        'test-overlay:3:tsx',
      ])
    } finally {
      await context?.fiber.dispose()
      restoreEnvironment(savedEnvironment)
      await rm(root, { recursive: true, force: true })
    }
  }, PROFILE_BOOT_TIMEOUT_MS)
})

function restoreEnvironment(saved: Record<string, string | undefined>): void {
  for (const name of ENVIRONMENT_KEYS) {
    const value = saved[name]
    if (value === undefined) Reflect.deleteProperty(process.env, name)
    else process.env[name] = value
  }
}
