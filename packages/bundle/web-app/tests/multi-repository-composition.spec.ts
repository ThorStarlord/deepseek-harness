/** The Web bundle inserts repository analysis into the root tool composition. */

import { fileURLToPath } from 'node:url'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { expect, it } from 'vitest'

const BASE_PATCH = fileURLToPath(new URL('../../base/cordis.patch.yml', import.meta.url))
const WEB_PATCH = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))

it('inserts repository tools into the shipped Web root composition', () => {
  const entries = composeEntries([
    loadOverlayPatches('web-multi-repository', BASE_PATCH),
    loadOverlayPatches('web-multi-repository', WEB_PATCH),
  ], (message) => { throw new Error(message) })
  const repositoryTools = entries.filter(entry => entry.id === 'tool-multi-repository')

  expect(repositoryTools).toHaveLength(1)
  expect(repositoryTools[0]?.name).toBe('@deepseek-ai/dsh-tool-multi-repository')
})
