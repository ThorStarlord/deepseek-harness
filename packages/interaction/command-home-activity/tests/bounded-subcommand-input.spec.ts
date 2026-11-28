import { expect, it } from 'vitest'
import { boundedSubcommandInput } from '../src/bounded-subcommand-input.ts'

it('recognizes only the owned Activity verb and returns its trimmed input', () => {
  expect(boundedSubcommandInput('  annotate  ', 'annotate', 32, 'too long')).toEqual({
    kind: 'input', input: 'annotate',
  })
  expect(boundedSubcommandInput('\tartifact add id details\n', 'artifact', 32, 'too long')).toEqual({
    kind: 'input', input: 'artifact add id details',
  })
  expect(boundedSubcommandInput('artifactize anything', 'artifact', 32, 'too long')).toBeUndefined()
  expect(boundedSubcommandInput('other', 'artifact', 32, 'too long')).toBeUndefined()
})

it('rejects oversized owned input by UTF-8 bytes without intercepting another verb', () => {
  const oversized = `handoff ${'ñ'.repeat(8)}`
  expect(Buffer.byteLength(oversized, 'utf8')).toBeGreaterThan(16)
  expect(boundedSubcommandInput(oversized, 'handoff', 16, 'handoff limit')).toEqual({
    kind: 'invalid', message: 'handoff limit',
  })
  expect(boundedSubcommandInput(`review ${'x'.repeat(20)}`, 'handoff', 16, 'handoff limit')).toBeUndefined()
})
