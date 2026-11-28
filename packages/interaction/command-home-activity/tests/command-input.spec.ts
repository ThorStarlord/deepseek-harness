import { expect, it } from 'vitest'
import { z } from 'zod'
import { commandUuid, parseActivityJsonInput, parseActivitySubcommand } from '../src/command-input.ts'

it('returns valid UUID text for the owning command to brand', () => {
  expect(commandUuid('123e4567-e89b-12d3-a456-426614174000', 'Activity id', 'Usage')).toEqual({
    success: true,
    data: '123e4567-e89b-12d3-a456-426614174000',
  })
})

it('uses the command label and usage without exposing parser details', () => {
  expect(commandUuid('private-invalid-input', 'Workspace id', 'Usage')).toEqual({
    success: false,
    message: 'Workspace id must be a UUID. Usage',
  })
})

it('distinguishes another command, malformed command text, and a validated Activity command', () => {
  const parse = (rawInput: string) => rawInput === 'other'
    ? undefined
    : rawInput === 'broken'
      ? { kind: 'invalid' as const, message: 'bad syntax' }
      : { kind: 'add' as const, activityId: rawInput }
  expect(parseActivitySubcommand('other', parse, 'Usage')).toEqual({ kind: 'result', result: undefined })
  expect(parseActivitySubcommand('broken', parse, 'Usage')).toEqual({
    kind: 'result',
    result: { kind: 'error', text: 'bad syntax' },
  })
  expect(parseActivitySubcommand('123e4567-e89b-12d3-a456-426614174000', parse, 'Usage')).toEqual({
    kind: 'command',
    command: { kind: 'add', activityId: '123e4567-e89b-12d3-a456-426614174000' },
    activityId: '123e4567-e89b-12d3-a456-426614174000',
  })
  expect(parseActivitySubcommand('bad-id', parse, 'Usage')).toEqual({
    kind: 'result',
    result: { kind: 'error', text: 'Activity id must be a UUID. Usage' },
  })
})

it('returns validated command JSON and stable errors without exposing parser details', () => {
  const schema = z.object({ label: z.string().min(1) }).strict()
  expect(parseActivityJsonInput('{"label":"reference"}', 'Artifact', 'Usage', schema)).toEqual({
    success: true,
    data: { label: 'reference' },
  })
  expect(parseActivityJsonInput('{', 'Review', 'Usage', schema)).toEqual({
    success: false,
    message: 'Review details must be valid JSON. Usage',
  })
  expect(parseActivityJsonInput('{"label":""}', 'Artifact', 'Usage', schema)).toEqual({
    success: false,
    message: 'Artifact details are invalid: Too small: expected string to have >=1 characters',
  })
})
