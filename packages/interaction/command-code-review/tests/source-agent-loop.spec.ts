import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { Context, FiberState } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SubagentRunId } from '@deepseek-ai/dsh-subagent'
import type { SubagentActivation, SubagentActivationSpec, SubagentResult } from '@deepseek-ai/dsh-subagent'
import { describe, expect, it, vi } from 'vitest'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { bootProductionProfile } from '../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'
import * as codeReview from '../src/index.ts'
import type { Config as CodeReviewConfig } from '../src/index.ts'
import type {} from '@deepseek-ai/dsh-agent-loop'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-working-directory'

const execFileAsync = promisify(execFile)
const loaderPatch = fileURLToPath(new URL('./fixtures/loader/code-review.patch.yml', import.meta.url))
const processTimeoutMs = 120_000

describe('code review source workflow', () => {
  it('rejects invalid byte and file-count limits when the command is configured', () => {
    const defaults: CodeReviewConfig = {
      maxPacketBytes: 524_288,
      maxChangedFiles: 100,
      maxInstructionBytes: 16_384,
      maxResultBytes: 65_536,
      evidenceReminder: true,
    }
    const limits = [
      ['maxPacketBytes', 8 * 1024 * 1024],
      ['maxChangedFiles', 1_000],
      ['maxInstructionBytes', 65_536],
      ['maxResultBytes', 262_144],
    ] as const
    for (const [field, maximum] of limits) {
      for (const value of [0, 1.5, maximum + 1]) {
        const invalidConfig = Object.assign({}, defaults, { [field]: value })
        expect(() => { codeReview.apply(new Context(), invalidConfig) })
          .toThrow(`command-code-review: ${field} must be an integer between 1 and ${maximum}`)
      }
    }
  })

  it('runs the source plugin through the production AgentLoop with scoped tools and attributed live evidence', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'dsh-code-review-source-'))
    const repositoryRoot = join(tempRoot, 'repository')
    const agentHome = join(tempRoot, 'agent-home')
    await initializeRepository(repositoryRoot)
    await writeSkill(repositoryRoot, '.agents/skills/code-review', 'code-review', 'PROJECT REVIEW SKILL LOADED')
    await writeSkill(agentHome, 'skills/review-evidence', 'review-evidence', 'USER EVIDENCE SKILL LOADED')
    const originalRepository = await snapshotRepository(repositoryRoot)
    const originalEnvironment = {
      dshHome: process.env['DSH_HOME'],
      agentsHome: process.env['DSH_AGENTS_HOME'],
    }
    process.env['DSH_HOME'] = join(tempRoot, 'dsh-home')
    process.env['DSH_AGENTS_HOME'] = agentHome
    let ctx: Context | undefined
    try {
      const sourcePatch = join(tempRoot, 'source-code-review.patch.yml')
      const patchText = await readFile(loaderPatch, 'utf8')
      const commandRow = new RegExp([
        String.raw`    - id: command-code-review`,
        String.raw`      name: '@deepseek-ai\/dsh-command-code-review'`,
        String.raw`      config:`,
        String.raw`        evidenceReminder: true`,
      ].join(String.raw`\r?\n`), 'u')
      expect(patchText).toMatch(commandRow)
      await writeFile(sourcePatch, patchText.replace(commandRow, ''))
      const runtime = ctx = await bootProductionProfile({
        binName: 'code-review-source-agent-loop',
        profile: 'headless',
        overlayPaths: [resolveConfigPath(sourcePatch, undefined)],
      })
      const reviewConfig: CodeReviewConfig = {
        maxPacketBytes: 524_288,
        maxChangedFiles: 100,
        maxInstructionBytes: 16_384,
        maxResultBytes: 65_536,
        evidenceReminder: true,
      }
      await runtime.plugin({ name: codeReview.name, inject: codeReview.inject, apply: codeReview.apply }, reviewConfig)
      const parentSessionId = SessionId(`code-review-source-parent-${randomUUID()}`)
      const reviewerRuns: { readonly sessionId: string; readonly runId: string; readonly cwd: string; readonly tools: string[] }[] = []
      const reviewerSessions = new Map<string, import('@deepseek-ai/dsh-session').Session>()
      let activeReviewer = -1
      let denyTools = false
      let changedSource = false
      const adapter = new MockAdapter(Array.from({ length: 32 }, () => dispatch))
      runtime.llm.registerAdapter(['fixture'], adapter)
      const parent = await runtime.agentLoop.create(parentSessionId, { provider: 'fixture', model: 'fixture' }, { cwd: repositoryRoot })
      const preset = await runtime.agentPresets.resolve('standard')
      if (preset.broken !== undefined) throw new Error(`standard preset failed: ${preset.broken}`)
      await runtime.agentPresets.select(parent, 'standard')
      runtime.on('subagent/start', ({ id, runId }) => {
        const child = runtime.agents.get(id)
        if (child === undefined) return
        reviewerRuns.push({
          sessionId: String(child.session.id),
          runId: String(runId),
          cwd: runtime.workingDirectory.get(child.session),
          tools: [],
        })
        reviewerSessions.set(String(child.session.id), child.session)
        activeReviewer = reviewerRuns.length - 1
      })

      const execution = await runtime.commands.execute(parent, '/review preserve staged and working values', [], new AbortController().signal)
      if (execution?.result.kind !== 'success') {
        const reviewer = reviewerRuns.at(-1)
        const events = reviewer === undefined ? [] : reviewerSessions.get(reviewer.sessionId)?.snapshotEvents() ?? []
        throw new Error(`source review failed: ${execution?.result.text ?? 'command was unavailable'}\n${JSON.stringify(events)}`)
      }
      await parent.whenIdle()
      const parentOutput = parent.session.snapshotEvents()
        .filter(event => event.type === 'assistant/message')
        .flatMap(event => event.data.message.content)
        .flatMap(block => block.type === 'text' ? [block.text] : [])
        .at(-1) ?? ''
      expect(parentOutput).toContain(repositoryRoot)
      expect(parentOutput).toContain('Committed HEAD:')
      expect(parentOutput).toContain('Reviewer Session:')
      expect(parentOutput).toContain('Reviewer run:')
      expect(parentOutput).toContain('Working tree changed during review: yes')
      expect(parentOutput).toContain('PROJECT REVIEW SKILL LOADED')
      expect(parentOutput).toContain('USER EVIDENCE SKILL LOADED')
      expect(reviewerRuns).toHaveLength(1)
      expect(reviewerRuns[0]?.sessionId).not.toBe(String(parentSessionId))
      expect(reviewerRuns[0]?.runId).toBeTruthy()
      expect(reviewerRuns[0]?.cwd).toBe(repositoryRoot)
      expect(reviewerRuns[0]?.tools).toEqual(['skill'])
      await writeFile(join(repositoryRoot, 'src/core.ts'), 'export const value = "working"\n')

      denyTools = true
      const denied = await runtime.commands.execute(parent, '/review verify tool restriction', [], new AbortController().signal)
      if (denied?.result.kind !== 'error') throw new Error(`tool restriction run did not fail closed: ${denied?.result.text ?? 'command was unavailable'}`)
      expect(denied?.result.text).toContain('stopped with error')
      expect(reviewerRuns).toHaveLength(2)
      expect(reviewerRuns[1]?.sessionId).not.toBe(reviewerRuns[0]?.sessionId)
      expect(reviewerRuns[1]?.runId).toBeTruthy()
      expect(reviewerRuns[1]?.tools).toEqual(['skill'])
      expect(await readFile(join(repositoryRoot, 'src/core.ts'), 'utf8')).toBe('export const value = "working"\n')
      expect(await readFile(join(repositoryRoot, 'src/unauthorized-write.txt')).catch(() => undefined)).toBeUndefined()
      expect(await git(repositoryRoot, ['status', '--porcelain=v1', '--untracked-files=all'])).toContain('src/draft.ts')
      expect(await snapshotRepository(repositoryRoot)).toBe(originalRepository)

      const longFocus = await runtime.commands.execute(
        parent,
        `/review ${'x'.repeat(4_097)}`,
        [],
        new AbortController().signal,
      )
      expect(longFocus?.result.kind).toBe('error')
      expect(longFocus?.result.text).toContain('4,096 bytes')
      expect(reviewerRuns).toHaveLength(2)

      const nestedHandle = await runtime.agentLoop.createAgent(runtime, {
        sessionId: SessionId(`code-review-source-nested-${randomUUID()}`),
        agentOptions: { provider: 'fixture', model: 'fixture' },
        meta: { cwd: repositoryRoot, parentSession: parentSessionId },
      })
      const nested = nestedHandle.agent
      try {
        await runtime.agentPresets.select(nested, 'standard')
        const nestedResult = await runtime.commands.execute(nested, '/review', [], new AbortController().signal)
        expect(nestedResult?.result.kind).toBe('error')
        expect(nestedResult?.result.text).toContain('user-started conversation')
      } finally {
        await nestedHandle.dispose()
      }

      await runtime.workingDirectory.set(parent, tempRoot)
      const outsideRepository = await runtime.commands.execute(parent, '/review', [], new AbortController().signal)
      expect(outsideRepository?.result.kind).toBe('error')
      expect(outsideRepository?.result.text).toContain('outside this Session’s authorized repository root')
      await runtime.workingDirectory.set(parent, repositoryRoot)

      const movedGitDirectory = join(tempRoot, 'repository-git-metadata')
      await rename(join(repositoryRoot, '.git'), movedGitDirectory)
      try {
        const missingGit = await runtime.commands.execute(parent, '/review', [], new AbortController().signal)
        expect(missingGit?.result.kind).toBe('error')
        expect(missingGit?.result.text).toContain('Git could not read the current repository state')
      } finally {
        await rename(movedGitDirectory, join(repositoryRoot, '.git'))
      }

      const overflowDirectory = join(repositoryRoot, 'overflow')
      await mkdir(overflowDirectory)
      try {
        await Promise.all(Array.from({ length: 101 }, (_, index) => (
          writeFile(join(overflowDirectory, `changed-${index}.ts`), `export const value${index} = ${index}\n`)
        )))
        const tooManyFiles = await runtime.commands.execute(parent, '/review', [], new AbortController().signal)
        expect(tooManyFiles?.result.kind).toBe('error')
        expect(tooManyFiles?.result.text).toContain('configured limit is 100')
      } finally {
        await rm(overflowDirectory, { recursive: true, force: true })
      }

      const oversizedPath = join(repositoryRoot, 'src/oversized.ts')
      await writeFile(oversizedPath, 'x'.repeat(524_289))
      try {
        const oversizedFile = await runtime.commands.execute(parent, '/review', [], new AbortController().signal)
        expect(oversizedFile?.result.kind).toBe('error')
        expect(oversizedFile?.result.text).toContain('exceeds the review packet limit')
      } finally {
        await rm(oversizedPath, { force: true })
      }

      const largePathA = join(repositoryRoot, 'src/large-a.ts')
      const largePathB = join(repositoryRoot, 'src/large-b.ts')
      await Promise.all([
        writeFile(largePathA, 'a'.repeat(280_000)),
        writeFile(largePathB, 'b'.repeat(280_000)),
      ])
      try {
        const oversizedPacket = await runtime.commands.execute(parent, '/review', [], new AbortController().signal)
        expect(oversizedPacket?.result.kind).toBe('error')
        expect(oversizedPacket?.result.text).toContain('Review packet exceeds the configured 524288-byte limit')
      } finally {
        await Promise.all([rm(largePathA, { force: true }), rm(largePathB, { force: true })])
      }

      const unchangedRunCount = reviewerRuns.length
      await git(repositoryRoot, ['add', '--all'])
      await git(repositoryRoot, ['-c', 'user.name=DSH fixture', '-c', 'user.email=dsh-fixture@example.invalid', 'commit', '--no-gpg-sign', '-m', 'settle review fixture'])
      const cleanReview = await runtime.commands.execute(parent, '/review', [], new AbortController().signal)
      expect(cleanReview?.result.kind).toBe('success')
      expect(cleanReview?.result.text).toContain('No reviewable changes were found')
      expect(reviewerRuns).toHaveLength(unchangedRunCount)

      const originalAgentGet = runtime.agents.get.bind(runtime.agents)
      const missingParent = vi.spyOn(runtime.agents, 'get').mockImplementation(id => (
        id === parent.id ? undefined : originalAgentGet(id)
      ))
      try {
        const result = await runtime.commands.execute(parent, '/review', [], new AbortController().signal)
        expect(result?.result.text).toContain('requires a live parent Agent')
      } finally {
        missingParent.mockRestore()
      }
      const parentFiberState = parent.ctx.fiber.state
      parent.ctx.fiber.state = FiberState.DISPOSED
      try {
        const result = await runtime.commands.execute(parent, '/review', [], new AbortController().signal)
        expect(result?.result.text).toContain('requires a live parent Agent')
      } finally {
        parent.ctx.fiber.state = parentFiberState
      }

      const fakeGitCases: readonly {
        readonly label: string
        readonly respond?: FakeGitResponder
        readonly expected: string
        readonly enforcement?: 'full' | 'partial'
      }[] = [
        { label: 'empty Git root', respond: args => args.includes('--show-toplevel') ? { stdout: '' } : undefined, expected: 'absolute repository root' },
        { label: 'relative Git root', respond: args => args.includes('--show-toplevel') ? { stdout: 'relative/repository' } : undefined, expected: 'absolute repository root' },
        { label: 'repository outside authorized root', respond: args => args.includes('--show-toplevel') ? { stdout: `${tempRoot}\\other-repository` } : undefined, expected: 'outside this Session' },
        { label: 'truncated Git stdout', respond: args => args.includes('--show-toplevel') ? { stdoutLossy: true } : undefined, expected: 'capture limit' },
        { label: 'truncated Git stderr', respond: args => args.includes('--show-toplevel') ? { stderrLossy: true } : undefined, expected: 'capture limit' },
        { label: 'Git exit failure with diagnostics', respond: args => args.includes('--show-toplevel') ? { exitCode: 1, stderr: 'fatal: fixture failure' } : undefined, expected: 'fatal: fixture failure' },
        { label: 'Git termination without diagnostics', respond: args => args.includes('--show-toplevel') ? { exitCode: null, signal: 'SIGTERM' } : undefined, expected: 'rev-parse --show-toplevel' },
        { label: 'Git command with absent stdout', respond: args => args.includes('--show-toplevel') ? { omitStdout: true } : undefined, expected: 'absolute repository root' },
        { label: 'partial sandbox fallback', enforcement: 'partial', expected: 'No reviewable changes were found' },
        { label: 'confined sandbox command', enforcement: 'full', expected: 'No reviewable changes were found' },
      ]
      for (const scenario of fakeGitCases) {
        const restoreFakeGit = installFakeGit(runtime, repositoryRoot, scenario.respond, scenario.enforcement)
        try {
          const result = await runtime.commands.execute(parent, '/review', [], new AbortController().signal)
          expect(result?.result.text, scenario.label).toContain(scenario.expected)
        } finally {
          restoreFakeGit()
        }
      }

      const originalReadBytes = runtime.fs.readBytes.bind(runtime.fs)
      const tooLargeInstruction = vi.spyOn(runtime.fs, 'readBytes').mockImplementation(async (target, signal, maxBytes) => {
        if (runtime.fs.processPath(target) === join(repositoryRoot, 'AGENTS.md')) {
          throw Object.assign(new Error('instruction exceeds limit'), { code: 'FS_TOO_LARGE' })
        }
        return originalReadBytes(target, signal, maxBytes)
      })
      try {
        const restoreFakeGit = installFakeGit(runtime, repositoryRoot)
        try {
          const result = await runtime.commands.execute(parent, '/review', [], new AbortController().signal)
          expect(result?.result.kind).toBe('success')
        } finally {
          restoreFakeGit()
        }
      } finally {
        tooLargeInstruction.mockRestore()
      }

      const failedInstructionRead = vi.spyOn(runtime.fs, 'readBytes').mockImplementation(async (target, signal, maxBytes) => {
        if (runtime.fs.processPath(target) === join(repositoryRoot, 'AGENTS.md')) throw 'fixture read failure'
        return originalReadBytes(target, signal, maxBytes)
      })
      try {
        const restoreFakeGit = installFakeGit(runtime, repositoryRoot)
        try {
          const result = await runtime.commands.execute(parent, '/review', [], new AbortController().signal)
          expect(result?.result.kind).toBe('error')
          expect(result?.result.text).toContain('fixture read failure')
        } finally {
          restoreFakeGit()
        }
      } finally {
        failedInstructionRead.mockRestore()
      }

      const originalInstructions = await readFile(join(repositoryRoot, 'AGENTS.md'))
      await writeFile(join(repositoryRoot, 'AGENTS.md'), Uint8Array.from([0xFF, 0xFE]))
      const restoreBinaryInstructionsGit = installFakeGit(runtime, repositoryRoot)
      try {
        const result = await runtime.commands.execute(parent, '/review', [], new AbortController().signal)
        expect(result?.result.kind).toBe('success')
      } finally {
        restoreBinaryInstructionsGit()
        await writeFile(join(repositoryRoot, 'AGENTS.md'), originalInstructions)
      }

      const coreEntry = await runtime.fs.lstat('src/core.ts', { cwd: repositoryRoot })
      if (coreEntry === undefined) throw new Error('review fixture lost its source file')
      const originalLstat = runtime.fs.lstat.bind(runtime.fs)
      const originalStat = runtime.fs.stat.bind(runtime.fs)
      const fileKinds = vi.spyOn(runtime.fs, 'lstat').mockImplementation(async (path, options, signal) => {
        if (options?.cwd === repositoryRoot && path === 'src/vanished.ts') return undefined
        if (options?.cwd === repositoryRoot && path === 'src/link.ts') return { ...coreEntry, type: 'symlink' }
        if (options?.cwd === repositoryRoot && path === 'src/CLAUDE.md') return { ...coreEntry, type: 'directory' }
        if (options?.cwd === repositoryRoot && (path === 'src/stat-race.ts' || path === 'src/stat-missing.ts')) {
          return { ...coreEntry, type: 'file' }
        }
        return originalLstat(path, options, signal)
      })
      const fileStatKinds = vi.spyOn(runtime.fs, 'stat').mockImplementation(async (target, signal) => {
        const path = runtime.fs.processPath(target)
        if (path === join(repositoryRoot, 'src/stat-race.ts')) {
          const info = await originalStat(await runtime.fs.resolve('src/core.ts', { cwd: repositoryRoot }), signal)
          return info === undefined ? undefined : { ...info, type: 'directory' }
        }
        if (path === join(repositoryRoot, 'src/stat-missing.ts')) return undefined
        return originalStat(target, signal)
      })
      const nonRegularGit = installFakeGit(runtime, repositoryRoot, args => (
        args[0] === 'ls-files'
          ? { stdout: 'src/vanished.ts\0src/link.ts\0src/stat-race.ts\0src/stat-missing.ts\0' }
          : undefined
      ))
      try {
        const result = await runtime.commands.execute(parent, '/review', [], new AbortController().signal)
        expect(result?.result.kind).toBe('success')
      } finally {
        nonRegularGit()
        fileStatKinds.mockRestore()
        fileKinds.mockRestore()
      }

      const outsideTarget = await runtime.fs.resolve(tempRoot)
      const originalResolve = runtime.fs.resolve.bind(runtime.fs)
      const resolveOutside = vi.spyOn(runtime.fs, 'resolve').mockImplementation((path, options) => (
        path === 'src/outside.ts' && options?.cwd === repositoryRoot
          ? Promise.resolve(outsideTarget)
          : originalResolve(path, options)
      ))
      const outsideLstat = vi.spyOn(runtime.fs, 'lstat').mockImplementation(async (path, options, signal) => (
        options?.cwd === repositoryRoot && path === 'src/outside.ts'
          ? { ...coreEntry, type: 'file' }
          : originalLstat(path, options, signal)
      ))
      const outsideGit = installFakeGit(runtime, repositoryRoot, args => (
        args[0] === 'ls-files' ? { stdout: 'src/outside.ts\0' } : undefined
      ))
      try {
        const result = await runtime.commands.execute(parent, '/review', [], new AbortController().signal)
        expect(result?.result.kind).toBe('error')
        expect(result?.result.text).toContain('resolves outside the selected repository')
      } finally {
        outsideGit()
        outsideLstat.mockRestore()
        resolveOutside.mockRestore()
      }

      const originalInstructionStat = runtime.fs.stat.bind(runtime.fs)
      const nonFileInstruction = vi.spyOn(runtime.fs, 'stat').mockImplementation(async (target, signal) => {
        if (runtime.fs.processPath(target) === join(repositoryRoot, 'AGENTS.md')) {
          const info = await originalInstructionStat(target, signal)
          return info === undefined ? undefined : { ...info, type: 'directory' }
        }
        return originalInstructionStat(target, signal)
      })
      const nonFileInstructionGit = installFakeGit(runtime, repositoryRoot)
      try {
        const result = await runtime.commands.execute(parent, '/review', [], new AbortController().signal)
        expect(result?.result.kind).toBe('success')
      } finally {
        nonFileInstructionGit()
        nonFileInstruction.mockRestore()
      }

      const outsideInstruction = vi.spyOn(runtime.fs, 'resolve').mockImplementation((path, options) => (
        path === 'AGENTS.md' && options?.cwd === repositoryRoot
          ? Promise.resolve(outsideTarget)
          : originalResolve(path, options)
      ))
      const outsideInstructionGit = installFakeGit(runtime, repositoryRoot)
      try {
        const result = await runtime.commands.execute(parent, '/review', [], new AbortController().signal)
        expect(result?.result.kind).toBe('success')
      } finally {
        outsideInstructionGit()
        outsideInstruction.mockRestore()
      }

      const identityRoots = [repositoryRoot, join(repositoryRoot, 'src')]
      let identityRootReads = 0
      const restoreIdentityGit = installFakeGit(runtime, repositoryRoot, args => (
        args.includes('--show-toplevel') ? { stdout: identityRoots[identityRootReads++] ?? repositoryRoot } : undefined
      ))
      try {
        const result = await runtime.commands.execute(parent, '/review', [], new AbortController().signal)
        expect(result?.result.kind).toBe('error')
        expect(result?.result.text).toContain('identity changed')
      } finally {
        restoreIdentityGit()
      }

      const restoreCaptureRaceGit = installFakeGit(runtime, repositoryRoot, (() => {
        let listed = 0
        return args => args[0] === 'ls-files'
          ? { stdout: listed++ < 1 ? 'src/draft.ts\0' : 'src/draft.ts\0src/created-during-capture.ts\0' }
          : undefined
      })())
      try {
        const result = await runtime.commands.execute(parent, '/review', [], new AbortController().signal)
        expect(result?.result.kind).toBe('error')
        expect(result?.result.text).toContain('changed while the review packet was being captured')
      } finally {
        restoreCaptureRaceGit()
      }

      await writeFile(join(repositoryRoot, 'src/core.ts'), 'export const value = "stable review"\n')
      denyTools = false
      const changedFakeGit = (args: readonly string[]): FakeGitOutput | undefined => (
        args[0] === 'branch'
          ? { stdout: '' }
          : args.includes('--name-only') && args.includes('--cached')
            ? { stdout: 'src/core.ts\0' }
            : undefined
      )
      const unmatchedStart = vi.spyOn(runtime.subagents, 'startActivation').mockImplementation(async (request) => {
        runtime.emit('subagent/start', {
          id: SessionId('unrelated-reviewer'),
          runId: SubagentRunId('unrelated-review-run'),
          provider: 'spawn',
          parentSessionId,
          local: true,
        })
        return fakeActivation(request, {
          stopReason: 'completed',
          output: [
            { type: 'reasoning', text: 'hidden analysis' },
            { type: 'text', text: 'Synthetic finding.' },
          ],
        })
      })
      const stableReviewGit = installFakeGit(runtime, repositoryRoot, changedFakeGit)
      try {
        const result = await runtime.commands.execute(parent, '/review', [], new AbortController().signal)
        expect(result?.result.kind, result?.result.text).toBe('success')
        expect(result?.result.text).toContain('run not reported')
        expect(result?.result.text).toContain('remained unchanged during review')
      } finally {
        stableReviewGit()
        unmatchedStart.mockRestore()
      }

      await writeFile(join(repositoryRoot, 'src/core.ts'), 'export const value = "oversized result"\n')
      const oversizedActivation = vi.spyOn(runtime.subagents, 'startActivation').mockImplementation(async request => (
        fakeActivation(request, { stopReason: 'completed', output: [{ type: 'text', text: 'x'.repeat(65_537) }] })
      ))
      const oversizedGit = installFakeGit(runtime, repositoryRoot, changedFakeGit)
      try {
        const result = await runtime.commands.execute(parent, '/review oversized reviewer output', [], new AbortController().signal)
        expect(result?.result.kind).toBe('error')
        expect(result?.result.text).toContain('exceeded the 65536-byte limit')
      } finally {
        oversizedGit()
        oversizedActivation.mockRestore()
      }

      const startupGit = installFakeGit(runtime, repositoryRoot, changedFakeGit)
      const startupFailure = vi.spyOn(runtime.subagents, 'startActivation').mockRejectedValue(new Error('fixture startup failure'))
      try {
        const result = await runtime.commands.execute(parent, '/review startup failure', [], new AbortController().signal)
        expect(result?.result.kind).toBe('error')
        expect(result?.result.text).toContain('fixture startup failure')
      } finally {
        startupFailure.mockRestore()
        startupGit()
      }

      const canceled = new AbortController()
      const cleanupWarning = vi.spyOn(runtime.logger, 'warn')
      const cancelGit = installFakeGit(runtime, repositoryRoot, changedFakeGit)
      const failCleanupOnce = vi.spyOn(runtime.subagents, 'startActivation').mockImplementation(async (request) => {
        const activation = fakeActivation(request, { stopReason: 'completed', output: [] })
        let fail = true
        vi.spyOn(activation, 'dispose').mockImplementation(async () => {
          if (fail) {
            fail = false
            throw new Error('fixture cleanup failure')
          }
        })
        canceled.abort()
        return activation
      })
      try {
        await expect(runtime.commands.execute(parent, '/review cancel reviewer', [], canceled.signal)).rejects.toThrow()
        await vi.waitFor(() =>{  expect(runtime.logger.warn).toHaveBeenCalledWith(
          'command-code-review: reviewer cleanup after cancellation failed: %o',
          expect.any(Error),
        ) })
      } finally {
        failCleanupOnce.mockRestore()
        cleanupWarning.mockRestore()
        cancelGit()
      }

      const failedReview = vi.spyOn(runtime.subagents, 'startActivation').mockImplementation(async request => (
        fakeActivation(request, { stopReason: 'error', diagnostic: 'fixture reviewer failure', output: [] })
      ))
      const failedReviewGit = installFakeGit(runtime, repositoryRoot, changedFakeGit)
      try {
        const result = await runtime.commands.execute(parent, '/review failed reviewer', [], new AbortController().signal)
        expect(result?.result.kind).toBe('error')
        expect(result?.result.text).toContain('fixture reviewer failure')
      } finally {
        failedReviewGit()
        failedReview.mockRestore()
      }

      function dispatch(request: GenerateOptions): StreamChunk[] {
        const child = reviewerRuns[activeReviewer]
        if (String(request.sessionId) === String(parentSessionId)) {
          const transcript = JSON.stringify(request.messages)
          expect(transcript).toContain('Review handoff guidance: attribute each finding')
          const handoff = request.messages.flatMap(message => message.content)
            .flatMap(block => block.type === 'text' ? [block.text] : [])
            .find(text => text.startsWith('[DSH code review handoff]'))
          if (handoff === undefined) throw new Error('parent request omitted the review handoff')
          return textResponse(`${handoff}\nParent reconciled the findings.`)
        }
        if (child === undefined) throw new Error('reviewer request has no Session or run attribution')
        const tools = (request.tools ?? []).map(tool => tool.name)
        if (child.tools.length === 0) {
          child.tools.push(...tools)
          expect(tools).toEqual(['skill'])
          const prompt = request.messages.flatMap(message => message.content)
            .flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
          expect(prompt).toContain('### Repository instructions: AGENTS.md')
          expect(prompt).toContain('### Repository instructions: src/AGENTS.md')
          expect(prompt).toContain('### Staged diff: src/core.ts')
          expect(prompt).toContain('value = "staged"')
          expect(prompt).toContain('### Unstaged diff: src/core.ts')
          expect(prompt).toContain('value = "working"')
          expect(prompt).toContain('### Untracked file: src/draft.ts')
          expect(prompt).toContain('binary or non-regular untracked files omitted: 2')
          expect(prompt).not.toContain('fixture secret')
          expect(prompt).not.toContain('ignored content')
          expect(prompt).not.toContain('ignored CLAUDE content')
          return toolCallResponse(`load-project-${randomUUID()}`, 'skill', { name: 'code-review' })
        }
        const transcript = JSON.stringify(request.messages)
        if (!transcript.includes('PROJECT REVIEW SKILL LOADED')) {
          throw new Error('project Skill did not override the bundled code-review Skill')
        }
        if (!transcript.includes('USER EVIDENCE SKILL LOADED')) {
          return toolCallResponse(`load-user-${randomUUID()}`, 'skill', { name: 'review-evidence' })
        }
        if (denyTools) {
          const forbidden = ['bash', 'pwsh', 'write', 'edit', 'apply_patch', 'subagent', 'coordinate_repositories', 'set_sandbox_mode', 'request_sandbox_escalation']
          if (!transcript.includes('Working tree paths')) throw new Error('review request omitted repository state')
          return toolCallsResponse(forbidden.map(name => ({
            id: `denied-${name}-${randomUUID()}`,
            name,
            arguments: name === 'bash'
              ? { command: `echo denied > "${join(repositoryRoot, 'unauthorized-shell.txt')}"` }
              : name === 'pwsh'
                ? { command: `Set-Content '${join(repositoryRoot, 'unauthorized-pwsh.txt')}' denied` }
                : name === 'write'
                  ? { file_path: join(repositoryRoot, 'unauthorized-write.txt'), content: 'denied' }
                  : name === 'edit'
                    ? { file_path: join(repositoryRoot, 'src/core.ts'), old_string: 'working', new_string: 'denied' }
                    : name === 'apply_patch'
                      ? { input: 'denied patch' }
                      : { mode: 'workspace-write', description: 'request wider execution' },
          })))
        }
        if (!changedSource) {
          changedSource = true
          writeFileSync(join(repositoryRoot, 'src/core.ts'), 'export const value = "changed during review"\n')
        }
        return textResponse('PROJECT REVIEW SKILL LOADED; USER EVIDENCE SKILL LOADED. Finding: src/core.ts:1 has staged and working-tree values that differ.')
      }
    } finally {
      await ctx?.fiber.dispose()
      await restoreEnvironment('DSH_HOME', originalEnvironment.dshHome)
      await restoreEnvironment('DSH_AGENTS_HOME', originalEnvironment.agentsHome)
      await rm(tempRoot, { recursive: true, force: true })
    }

    async function restoreEnvironment(name: 'DSH_HOME' | 'DSH_AGENTS_HOME', value: string | undefined): Promise<void> {
      if (name === 'DSH_HOME') {
        if (value === undefined) delete process.env.DSH_HOME
        else process.env.DSH_HOME = value
        return
      }
      if (value === undefined) delete process.env.DSH_AGENTS_HOME
      else process.env.DSH_AGENTS_HOME = value
    }
  }, processTimeoutMs + 15_000)
})

async function initializeRepository(root: string): Promise<void> {
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(root, 'repository-files'), { recursive: true })
  await writeFile(join(root, 'AGENTS.md'), 'Use repository-local review instructions.\n')
  await writeFile(join(root, 'CLAUDE.md'), 'ignored CLAUDE content; excluded\n')
  await writeFile(join(root, '.gitignore'), '.env\n.env.local\nignored.log\nCLAUDE.md\n')
  await writeFile(join(root, '.env'), 'fixture secret; excluded\n')
  await writeFile(join(root, '.env.local'), 'fixture secret; excluded\n')
  await writeFile(join(root, 'ignored.log'), 'ignored content; excluded\n')
  await writeFile(join(root, 'src/AGENTS.md'), 'Use the source-specific review instructions.\n')
  await writeFile(join(root, 'src/core.ts'), 'export const value = "committed"\n')
  await writeFile(join(root, 'src/secrets.ts'), 'secret file-name exclusion\n')
  await writeFile(join(root, 'src/credentials.json'), 'fixture secret; excluded\n')
  await writeFile(join(root, 'src/id_rsa'), 'fixture secret; excluded\n')
  await writeFile(join(root, 'src/signing.pem'), 'fixture secret; excluded\n')
  await writeFile(join(root, 'src/draft.ts'), 'export const draft = "untracked"\n')
  await writeFile(join(root, 'src/blob.bin'), Uint8Array.from([0, 255, 13, 10]))
  await writeFile(join(root, 'src/invalid-utf8.bin'), Uint8Array.from([0xFF, 0xFE]))
  await git(root, ['init', '--initial-branch=review-source-test'])
  await git(root, ['add', '--', 'AGENTS.md', '.gitignore', 'src/AGENTS.md', 'src/core.ts', 'src/secrets.ts'])
  await git(root, ['-c', 'user.name=DSH fixture', '-c', 'user.email=dsh-fixture@example.invalid', 'commit', '--no-gpg-sign', '-m', 'initial'])
  await writeFile(join(root, 'src/core.ts'), 'export const value = "staged"\n')
  await git(root, ['add', '--', 'src/core.ts'])
  await writeFile(join(root, 'src/core.ts'), 'export const value = "working"\n')
}

async function writeSkill(root: string, relativePath: string, name: string, marker: string): Promise<void> {
  const skillDirectory = join(root, relativePath)
  await mkdir(skillDirectory, { recursive: true })
  await writeFile(join(skillDirectory, 'SKILL.md'), `---\nname: ${name}\ndescription: fixture guidance\n---\n\n${marker}\n`)
}

async function snapshotRepository(root: string): Promise<string> {
  const paths = [
    'AGENTS.md', 'CLAUDE.md', '.gitignore', '.env', '.env.local', 'ignored.log', 'src/AGENTS.md', 'src/core.ts',
    'src/secrets.ts', 'src/credentials.json', 'src/id_rsa', 'src/signing.pem', 'src/draft.ts', 'src/blob.bin',
    'src/invalid-utf8.bin', '.agents/skills/code-review/SKILL.md',
  ]
  const files = await Promise.all(paths.map(async (path) => {
    try {
      return [path, (await readFile(join(root, path))).toString('base64')] as const
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [path, null] as const
      throw error
    }
  }))
  return JSON.stringify({
    files,
    index: (await readFile(join(root, '.git', 'index'))).toString('base64'),
    branch: await git(root, ['branch', '--show-current']),
    head: await git(root, ['rev-parse', 'HEAD']),
    status: await git(root, ['status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching']),
  })
}

function toolCallsResponse(calls: readonly { readonly id: string; readonly name: string; readonly arguments: object }[]): StreamChunk[] {
  const chunks: StreamChunk[] = []
  calls.forEach((call, index) => {
    const argumentsJson = JSON.stringify(call.arguments)
    chunks.push(
      { type: 'block-start', index, blockType: 'tool-call' },
      { type: 'tool-call-delta', index, id: ToolCallId(call.id), name: call.name, argumentsDelta: argumentsJson },
      { type: 'block-end', index, block: { type: 'tool-call', id: ToolCallId(call.id), name: call.name, arguments: argumentsJson } },
    )
  })
  chunks.push({ type: 'usage', usage: { inputTokens: 10, outputTokens: calls.length * 5 } })
  chunks.push({ type: 'finish', reason: { kind: 'tool-calls' } })
  return chunks
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const windows = process.platform === 'win32'
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')))
  env.GIT_CONFIG_NOSYSTEM = '1'
  env.GIT_CONFIG_GLOBAL = windows ? 'NUL' : '/dev/null'
  env.GIT_OPTIONAL_LOCKS = '0'
  env.GIT_TERMINAL_PROMPT = '0'
  return (await execFileAsync('git', ['-c', `core.hooksPath=${windows ? 'NUL' : '/dev/null'}`, ...args], { cwd, env })).stdout.trim()
}

interface FakeGitOutput {
  readonly stdout?: string
  readonly stderr?: string
  readonly exitCode?: number | null
  readonly signal?: NodeJS.Signals | null
  readonly stdoutLossy?: boolean
  readonly stderrLossy?: boolean
  readonly omitStdout?: boolean
  readonly omitStderr?: boolean
}

type FakeGitResponder = (args: readonly string[]) => FakeGitOutput | undefined

/** Replace only the trusted Git reader for one command invocation. */
function installFakeGit(
  runtime: Context,
  repositoryRoot: string,
  respond?: FakeGitResponder,
  enforcement: 'full' | 'partial' = 'partial',
): () => void {
  const confine = vi.spyOn(runtime.sandbox, 'confine').mockImplementation(async argv => ({
    argv: [...argv],
    enforcement,
    denialSignatures: [],
    runnerFailureRules: [],
  }))
  const spawn = vi.spyOn(runtime.subprocess, 'spawn').mockImplementation((spec) => {
    const args = spec.argv.slice(1)
    const fallback: FakeGitOutput = args.includes('--show-toplevel')
      ? { stdout: `${repositoryRoot}\n` }
      : args[0] === 'rev-parse' && args.includes('HEAD')
        ? { stdout: '0123456789abcdef0123456789abcdef01234567\n' }
        : args[0] === 'branch'
          ? { stdout: '' }
          : args.includes('check-ignore')
            ? { stdout: '', exitCode: args.at(-1) === 'CLAUDE.md' ? 0 : 1 }
            : { stdout: '' }
    return completedGitHandle({ ...fallback, ...respond?.(args) })
  })
  return () => {
    spawn.mockRestore()
    confine.mockRestore()
  }
}

/** Build a settled process handle with exactly the requested Git output facts. */
function completedGitHandle(output: FakeGitOutput): SubprocessHandle {
  const exitCode = output.exitCode === undefined ? 0 : output.exitCode
  const reader = (text: string, lossy: boolean) => ({
    readFrom: () => ({ text, nextOffset: Buffer.byteLength(text), lossy }),
  })
  return {
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    control: undefined,
    collected: {
      ...(output.omitStdout === true ? {} : { stdout: reader(output.stdout ?? '', output.stdoutLossy ?? false) }),
      ...(output.omitStderr === true ? {} : { stderr: reader(output.stderr ?? '', output.stderrLossy ?? false) }),
    },
    done: Promise.resolve({ exitCode, signal: output.signal ?? null }),
    terminate: () => undefined,
    waitForExit: async () => true,
  }
}

function fakeActivation(
  request: SubagentActivationSpec,
  result: SubagentResult,
): SubagentActivation {
  return {
    childId: request.childId ?? SessionId('code-review-fixture-child'),
    name: request.label,
    result: Promise.resolve(result),
    dispose: async () => undefined,
  }
}
