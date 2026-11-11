import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SubagentRunId } from '@deepseek-ai/dsh-subagent'
import {
  digestSnapshot,
  errorMessage,
  HANDOFF_MARKER,
  isGitMetadataPath,
  isSensitivePath,
  outputText,
  renderParentHandoff,
  renderRepositoryPacket,
  renderReviewerPrompt,
  splitNul,
} from '../src/render.ts'
import type { CapturedRepository, RepositorySnapshot } from '../src/render.ts'

describe('review evidence rendering', () => {
  it('renders staged, working-tree, instruction, and untracked evidence', () => {
    const snapshot = createSnapshot({
      instructions: [{ path: 'AGENTS.md', content: 'Keep the change focused.' }],
      stagedDiffs: [{ path: 'src/index.ts', content: '+staged' }],
      unstagedDiffs: [{ path: 'src/index.ts', content: '+working' }],
      untrackedFiles: [{ path: 'notes.txt', content: 'first\r\nsecond\n' }],
    })
    const packet = renderRepositoryPacket('C:\\repo', snapshot)
    expect(packet).toContain('Observation: captured live Git index and working-tree content; this is not an immutable filesystem snapshot.')
    expect(packet).toContain('Branch: (detached HEAD)')
    expect(packet).toContain('Index paths (1): src/index.ts')
    expect(packet).toContain('Working-tree paths (1): src/index.ts')
    expect(packet).toContain('Untracked, non-ignored paths (1): notes.txt')
    expect(packet).toContain('### Repository instructions: AGENTS.md')
    expect(packet).toContain('### Staged diff: src/index.ts\n+staged')
    expect(packet).toContain('### Unstaged diff: src/index.ts\n+working')
    expect(packet).toContain('### Untracked file: notes.txt\n1: first\n2: second\n3: ')
    expect(renderRepositoryPacket('C:\\repo', createSnapshot({ branch: 'main', stagedPaths: [], unstagedPaths: [], untrackedPaths: [] })))
      .toContain('Index paths (0): (none)')
    expect(renderRepositoryPacket('C:\\repo', createSnapshot({ branch: 'main' })))
      .toContain('Branch: main')
  })

  it('renders reviewer and parent prompts with optional context and attribution', () => {
    const repository = createCapturedRepository()
    expect(renderReviewerPrompt(repository, '')).not.toContain('User review focus:')
    expect(renderReviewerPrompt(repository, 'check compatibility')).toContain('User review focus: check compatibility')
    const detached = renderParentHandoff(
      repository,
      SessionId('review-session'),
      undefined,
      'finding evidence',
      true,
      'completed',
    )
    expect(detached).toContain(HANDOFF_MARKER)
    expect(detached).toContain('Branch: (detached HEAD)')
    expect(detached).toContain('Working tree changed during review: yes')
    expect(detached).toContain('Reviewer run: not reported')
    const branch = renderParentHandoff(
      { ...repository, branch: 'release' },
      SessionId('review-session'),
      SubagentRunId('review-run'),
      '',
      false,
      'completed',
    )
    expect(branch).toContain('Branch: release')
    expect(branch).toContain('Working tree changed during review: no')
    expect(branch).toContain('Reviewer run: review-run')
  })

  it('keeps Git path parsing, secret-name filtering, and text output explicit', () => {
    expect(splitNul('src/a.ts\0\0src/b.ts\0')).toEqual(['src/a.ts', 'src/b.ts'])
    expect(splitNul('')).toEqual([])
    for (const path of ['.env', 'config/.env.local', 'signing.pem', 'client.key', 'archive.p12', 'archive.pfx', 'credentials.json', 'secrets', 'id_rsa', 'id_ed25519_old']) {
      expect(isSensitivePath(path), path).toBe(true)
    }
    expect(isSensitivePath('src/core.ts')).toBe(false)
    expect(isGitMetadataPath('.git/config')).toBe(true)
    expect(isGitMetadataPath('src/.git/config')).toBe(false)
    expect(outputText([
      { type: 'reasoning', text: 'hidden analysis' },
      { type: 'text', text: ' finding ' },
      { type: 'text', text: 'evidence ' },
    ])).toBe('finding \nevidence')
    expect(outputText([])).toBe('')
  })

  it('reports thrown errors without losing non-Error values and hashes full evidence', () => {
    const snapshot = createSnapshot()
    expect(errorMessage(new Error('specific failure'))).toBe('specific failure')
    expect(errorMessage('plain failure')).toBe('plain failure')
    expect(digestSnapshot('C:\\repo', snapshot)).toBe(digestSnapshot('C:\\repo', snapshot))
    expect(digestSnapshot('C:\\repo', snapshot)).not.toBe(digestSnapshot('C:\\other', snapshot))
    expect(digestSnapshot('C:\\repo', snapshot)).not.toBe(digestSnapshot('C:\\repo', { ...snapshot, head: 'new-head' }))
  })
})

function createSnapshot(overrides: Partial<RepositorySnapshot> = {}): RepositorySnapshot {
  return {
    branch: null,
    head: '0123456789abcdef0123456789abcdef01234567',
    status: 'tracked changes',
    stagedPaths: ['src/index.ts'],
    unstagedPaths: ['src/index.ts'],
    untrackedPaths: ['notes.txt'],
    instructions: [],
    stagedDiffs: [],
    unstagedDiffs: [],
    untrackedFiles: [],
    omittedSensitivePaths: 2,
    omittedBinaryFiles: 1,
    ...overrides,
  }
}

function createCapturedRepository(): CapturedRepository {
  return {
    root: 'C:\\repo',
    branch: null,
    head: '0123456789abcdef0123456789abcdef01234567',
    packet: 'captured source packet',
    digest: 'a'.repeat(64),
    observedAt: '2026-11-11T00:00:00.000Z',
    hasReviewableChanges: true,
  }
}
