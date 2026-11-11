import { describe, expect, it } from 'vitest'
import { sameRepositoryPath } from '../src/repository-path.ts'

describe('repository path identity comparison', () => {
  it('normalizes resolved paths and applies Windows case folding only on Windows', () => {
    expect(sameRepositoryPath('C:\\Repositories\\Example\\', 'c:\\repositories\\example', 'win32')).toBe(true)
    expect(sameRepositoryPath('C:\\Repositories\\Example', 'c:\\repositories\\example', 'linux')).toBe(false)
    expect(sameRepositoryPath('C:\\Repositories\\Example', 'C:\\Repositories\\Other', 'win32')).toBe(false)
  })
})
