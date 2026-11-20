import { fileURLToPath } from 'node:url'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { expect, it } from 'vitest'

const BASE_PATCH = fileURLToPath(new URL('../../base/cordis.patch.yml', import.meta.url))
const WEB_PATCH = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))

it('mounts Activity annotation persistence before the human Activity command', () => {
  const entries = composeEntries([
    loadOverlayPatches('web-home-activity', BASE_PATCH),
    loadOverlayPatches('web-home-activity', WEB_PATCH),
  ], (message) => { throw new Error(message) })
  const annotationIndex = entries.findIndex(entry => entry.id === 'home-activity-annotations')
  const commandIndex = entries.findIndex(entry => entry.id === 'command-home-activity')

  expect(entries[annotationIndex]?.name).toBe('@deepseek-ai/dsh-home-activity/annotations')
  expect(commandIndex).toBeGreaterThan(annotationIndex)
})
