import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const processTimeoutMs = 120_000
const binScript = fileURLToPath(new URL('./fixtures/loader/annotations-driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/loader/annotations.patch.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

it('persists annotation corrections and recovers them through the shipped Loader after restart', async () => {
  const { stdout, stderr } = await runLoaderSmoke({
    label: 'home-activity-annotations',
    tempDirPrefix: 'dsh-home-activity-annotations-loader-',
    binScript,
    libBinScript: binScript,
    configPath,
    tsconfigPath,
    processTimeoutMs,
    env: { DEEPSEEK_API_KEY: '', DSH_TELEMETRY_DISABLED: '1' },
  })
  const resultLine = stdout.split(/\r?\n/u).find(line => line.startsWith('ANNOTATION_COMPOSITION_RESULT '))
  expect(resultLine).toBeDefined()
  const result = JSON.parse(resultLine?.slice('ANNOTATION_COMPOSITION_RESULT '.length) ?? '{}') as {
    readonly activityId?: string
    readonly revisions?: number
    readonly invalidInput?: string
    readonly currentRevision?: number
  }
  expect(stderr).toBe('')
  expect(result.activityId).toMatch(/^[0-9a-f-]{36}$/u)
  expect(result.revisions).toBe(2)
  expect(result.invalidInput).toBe('error')
  expect(result.currentRevision).toBe(2)
}, processTimeoutMs + 15_000)
