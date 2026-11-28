import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { bootProductionProfile } from '../src/production-profile.ts'

const overlayPath = fileURLToPath(new URL('./fixtures/production-profile.patch.yml', import.meta.url))
const ENVIRONMENT_KEYS = ['DSH_HOME', 'DSH_AGENTS_HOME', 'USERPROFILE', 'HOME'] as const
const PROFILE_BOOT_TIMEOUT_MS = 30_000

describe('bootProductionProfile', { concurrent: false }, () => {
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
      await selectBaseOnlyProfile(expectedDshHome)

      context = await bootProductionProfile({
        binName: 'loader-smoke-test',
        profile: 'headless',
        overlayPaths: [],
        prepare: (root) => {
          expect(root.get('profileContext')?.home).toBe(expectedDshHome)
          prepared = true
        },
      })

      expect(context.get('profileContext')?.home).toBe(expectedDshHome)
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
      await selectBaseOnlyProfile(savedHome)

      const bootedContext = await bootProductionProfile({
        binName: 'loader-smoke-test',
        profile: 'headless',
        overlayPaths: [overlayPath],
      })
      context = bootedContext

      expect(bootedContext.get('profileContext')?.home).toBe(savedHome)
      const pluginPackages = bootedContext.get('pluginPackages')
      if (pluginPackages === undefined) throw new Error('Plugin package resolution service is unavailable')
      const resolution = pluginPackages.resolution
      expect(resolution).toBeDefined()
      const overlayPackages = resolution?.entries
        .filter(entry => entry.scope === 'profile' && ['tsx', 'vitest'].includes(entry.name))
        .map(entry => entry.name)
        .sort()
      expect(overlayPackages).toEqual(['tsx', 'vitest'])
    } finally {
      await context?.fiber.dispose()
      restoreEnvironment(savedEnvironment)
      await rm(root, { recursive: true, force: true })
    }
  }, PROFILE_BOOT_TIMEOUT_MS)
})

async function selectBaseOnlyProfile(home: string): Promise<void> {
  const profileDirectory = join(home, 'profiles', 'headless')
  await mkdir(profileDirectory, { recursive: true })
  await writeFile(join(profileDirectory, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-headless',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
  }, undefined, 2)}\n`)
}

function restoreEnvironment(saved: Record<string, string | undefined>): void {
  for (const name of ENVIRONMENT_KEYS) {
    const value = saved[name]
    if (value === undefined) Reflect.deleteProperty(process.env, name)
    else process.env[name] = value
  }
}
