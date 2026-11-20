/** Persisted Session recovery across two real dsh server processes on the same port. */
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { dump } from 'js-yaml'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { bundlePatchPaths, composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import {
  connectFreshWorkspace, REPO_ROOT, newEnglishPage, saveFailureShot, writeComposerDraft,
} from './support.ts'

const BASE_PATCH = join(REPO_ROOT, 'packages/bundle/base/cordis.patch.yml')
const WEB_BUNDLE = join(REPO_ROOT, 'packages/bundle/web-app')
const WEB_BUNDLE_MANIFEST = (JSON.parse(readFileSync(join(WEB_BUNDLE, 'package.json'), 'utf8')) as {
  dsh: { bundle: { patch: string[] } }
}).dsh.bundle
const WEB_PATCHES = bundlePatchPaths(WEB_BUNDLE, WEB_BUNDLE_MANIFEST)

/** Add the deterministic external one-shot test provider to the shipped standard Agent preset. */
async function writeActivityRecoveryOverlay(root: string): Promise<string> {
  const layers = [
    loadOverlayPatches('Activity recovery test overlay', BASE_PATCH),
    ...WEB_PATCHES.map(file => loadOverlayPatches('Activity recovery test overlay', file)),
  ]
  const row = composeEntries(layers).find(entry => entry.id === 'preset-standard')
  if (row === undefined) throw new Error('The Web bundle has no standard Agent preset')
  const config = row.config as { readonly plugins: readonly Record<string, unknown>[] }
  const fixture = pathToFileURL(fileURLToPath(new URL('./fixtures/restart-home-activity-codex.js', import.meta.url))).href
  const patch = join(root, 'activity-recovery-test-preset.patch.yml')
  await writeFile(patch, dump([{
    id: 'preset-standard',
    config: { ...config, plugins: [...config.plugins, { id: 'restart-home-activity-codex', name: fixture }] },
  }], { schema: entryListSchema, noRefs: true, lineWidth: -1 }), 'utf8')
  return patch
}

class RestartableServer {
  private child: ChildProcess | undefined
  private closed: Promise<void> | undefined
  private output = ''
  readonly startupBlocked = Promise.withResolvers<undefined>()

  constructor(
    private readonly world: string,
    private readonly modelUrl: string,
    private readonly extraPatches: readonly string[] = [],
  ) {}

  async start(port: number, holdStartup = false): Promise<string> {
    if (this.child !== undefined) throw new Error('Server is already running')
    this.output = ''
    const ready = Promise.withResolvers<string>()
    const child = spawn(process.execPath, [
      join(REPO_ROOT, 'apps/cli/lib/bin.js'), '--profile', 'web',
      '--patch', fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)),
      '--patch', fileURLToPath(new URL('./fixtures/restart-startup.overlay.yml', import.meta.url)),
      ...this.extraPatches.flatMap(patch => ['--patch', patch]),
      '--no-open', '--port', String(port),
    ], {
      cwd: this.world,
      env: {
        ...process.env, NODE_OPTIONS: '',
        DSH_HOME: join(this.world, 'home'), DSH_AGENTS_HOME: join(this.world, 'agents'),
        DSH_TELEMETRY_DISABLED: '1', DEEPSEEK_API_KEY: 'keyless-server-restart-fixture',
        DEEPSEEK_BASE_URL: this.modelUrl,
        DSH_WEB_RESTART_HOLD_STARTUP: holdStartup ? '1' : '0',
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    this.child = child
    const receive = (data: Buffer): void => {
      this.output += data.toString()
      const url = /dsh web: (http:\/\/[^\s]+)/u.exec(this.output)?.[1]
      if (url !== undefined) ready.resolve(url)
    }
    child.stdout?.on('data', receive)
    child.stderr?.on('data', receive)
    child.on('message', (message) => {
      if (message === 'startup-blocked') this.startupBlocked.resolve(undefined)
    })
    child.once('error', (error) => { ready.reject(error) })
    this.closed = new Promise((resolve) => {
      child.once('close', (code, signal) => {
        ready.reject(new Error('Server exited before readiness: ' + JSON.stringify({ code, signal }) + '\n' + this.logs()))
        resolve()
      })
    })
    const timer = setTimeout(() => { ready.reject(new Error('Server readiness timed out\n' + this.logs())) }, 30_000)
    try { return await ready.promise }
    finally { clearTimeout(timer) }
  }

  async stop(): Promise<void> {
    const child = this.child
    if (child === undefined) return
    this.resumeStartup()
    let forced = false
    const timer = setTimeout(() => { forced = true; child.kill('SIGKILL') }, 15_000)
    try {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
      await this.closed
    } finally {
      clearTimeout(timer)
      this.child = undefined
    }
    if (forced) throw new Error('Server did not stop after SIGTERM\n' + this.logs())
  }

  resumeStartup(): void {
    if (this.child?.connected) this.child.send('resume-startup')
  }

  processState(): string {
    const child = this.child
    if (child === undefined) return 'no-child'
    return `pid:${child.pid ?? 'none'},exit:${child.exitCode ?? 'running'},signal:${child.signalCode ?? 'none'}`
  }

  logs(): string { return this.output.replace(/([?&]token=)[A-Za-z0-9_-]+/gu, '$1<redacted>') }
}

type HostRpc = <T>(endpoint: string, args: object) => Promise<T>

/** Authenticate against one server process and return its Host RPC caller. */
async function hostRpc(url: string): Promise<HostRpc> {
  const authenticated = await fetch(url, { redirect: 'manual' })
  const cookie = authenticated.headers.get('set-cookie')?.split(';', 1)[0]
  if (cookie === undefined) throw new Error('Server did not issue an authentication cookie')
  return async <T>(endpoint: string, args: object): Promise<T> => {
    const response = await fetch(new URL('/api/' + endpoint, url), {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: endpoint, payload: { args } }),
    })
    const result = await response.json() as { result: { ok: boolean; value: T; error?: { message: string } } }
    if (!result.result.ok) throw new Error(`${endpoint}: ${String(result.result.error?.message)}`)
    return result.result.value
  }
}

it.each([false, true])('keeps the same revision, Session and page across a server restart (delayed startup: %s)', async (holdStartup) => {
  const world = await mkdtemp(join(tmpdir(), 'dsh-server-restart-'))
  onTestFinished(() => rm(world, { recursive: true, force: true }))
  const model = createServer((request, response) => {
    request.resume()
    request.once('end', () => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      const events = [
        { type: 'message_start', message: { id: 'restart-fixture', model: 'mock-model', usage: { input_tokens: 3, output_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Persisted server restart fixture.' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
        { type: 'message_stop' },
      ]
      response.end(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join(''))
    })
  })
  onTestFinished(() => new Promise<void>((resolve, reject) => {
    model.close((error) => { if (error) reject(error); else resolve() })
    model.closeAllConnections()
  }))
  await new Promise<void>((resolve, reject) => {
    model.once('error', reject)
    model.listen(0, '127.0.0.1', resolve)
  })
  const modelAddress = model.address()
  if (modelAddress === null || typeof modelAddress === 'string') throw new Error('Model fixture did not listen')
  const server = new RestartableServer(world, `http://127.0.0.1:${String(modelAddress.port)}`)
  onTestFinished(() => server.stop())
  const workspacePath = join(world, 'workspace')
  await mkdir(workspacePath)

  const url = await server.start(0)
  const port = Number(new URL(url).port)
  const rpc = await hostRpc(url)
  await rpc('workspace/create', { request: { path: workspacePath } })
  const scenarioId = randomUUID()

  const browser = await chromium.launch({ headless: true })
  onTestFinished(() => browser.close())
  const page = await newEnglishPage(browser)
  const errors: string[] = []
  const streamErrors: unknown[] = []
  const graphs: { rev: string; entries: { id: string; rev: string }[] }[] = []
  let readyFrames = 0
  let sessionBaselines = 0
  let navigations = 0
  page.on('pageerror', (error) => { errors.push(String(error)) })
  page.on('websocket', (socket) => {
    const endpoints = new Map<string, string>()
    socket.on('framesent', ({ payload }) => {
      if (typeof payload !== 'string') return
      const frame = JSON.parse(payload) as { type?: string; streamId: string; endpoint: string }
      if (frame.type === 'open') endpoints.set(frame.streamId, frame.endpoint)
    })
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload !== 'string') return
      const message = JSON.parse(payload) as { type?: string; streamId: string; value?: { type?: string }; error?: unknown }
      if (message.type === 'error') streamErrors.push(message.error)
      if (message.type === 'item' && message.value?.type === 'ready') readyFrames++
      if (message.type === 'item' && endpoints.get(message.streamId) === 'session/follow'
        && message.value?.type === 'snapshot') sessionBaselines++
    })
  })
  const network = await page.context().newCDPSession(page)
  await network.send('Network.enable')
  network.on('Network.eventSourceMessageReceived', (event) => {
    const message = JSON.parse(event.data) as { type?: string; graph: typeof graphs[number] }
    if (message.type === 'graph') graphs.push(message.graph)
  })
  onTestFailed(async () => {
    await saveFailureShot(page, 'web-server-restart-' + scenarioId)
    await writeFile(join(REPO_ROOT, '.artifacts', 'server-restart-' + scenarioId + '.json'), JSON.stringify({ errors, streamErrors, graphs, server: server.logs() }, null, 2))
  })
  await page.goto(url, { waitUntil: 'load' })
  await page.locator('[data-slot="root"]').waitFor({ state: 'attached', timeout: 20_000 })
  const notice = page.getByRole('button', { name: 'Continue', exact: true })
  await notice.click({ timeout: 15_000 })
  const composer = page.locator('[data-composer-input][contenteditable="true"]')
  await writeComposerDraft(page, composer, 'Create a completed turn for the server restart test.')
  await composer.press('Enter')
  const response = page.getByRole('paragraph').filter({ hasText: /^Persisted server restart fixture\.$/u })
  await response.last().waitFor({ timeout: 20_000 })
  const draft = 'Unsent draft across a server restart'
  await writeComposerDraft(page, composer, draft)
  await expect.poll(() => graphs.length).toBeGreaterThan(0)
  await expect.poll(() => sessionBaselines).toBeGreaterThan(0)
  const originalRoot = await page.locator('[data-slot="root"]').elementHandle()
  expect(originalRoot).not.toBeNull()
  const beforeReady = readyFrames
  const beforeBaseline = sessionBaselines
  const beforeGraphs = graphs.length
  page.on('framenavigated', () => { navigations++ })

  await server.stop()
  let restarted: string
  const restarting = server.start(port, holdStartup)
  try {
    if (holdStartup) {
      await Promise.race([
        server.startupBlocked.promise,
        restarting.then(() => { throw new Error('the restarted Host did not hold controller startup') }),
      ])
      const opened = await page.evaluate(() => new Promise<boolean>((resolve) => {
        const endpoint = new URL('api/remote.mux', location.href)
        endpoint.protocol = 'ws:'
        const socket = new WebSocket(endpoint)
        let accepted = false
        socket.addEventListener('open', () => { accepted = true; socket.close() })
        socket.addEventListener('close', () => { resolve(accepted) })
      }))
      expect(opened).toBe(false)
      expect(readyFrames).toBe(beforeReady)
    }
  } finally {
    server.resumeStartup()
    restarted = await restarting
  }
  expect(new URL(restarted).origin).toBe(new URL(url).origin)
  await expect.poll(() => readyFrames, { timeout: 30_000 }).toBeGreaterThan(beforeReady)
  await expect.poll(() => sessionBaselines, { timeout: 30_000 }).toBeGreaterThan(beforeBaseline)
  await expect.poll(() => graphs.length, { timeout: 30_000 }).toBeGreaterThan(beforeGraphs)
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => { requestAnimationFrame(() => { resolve() }) })
  }))

  expect(errors).toEqual([])
  expect(streamErrors).toEqual([])
  for (const graph of graphs.slice(beforeGraphs)) expect(graph).toEqual(graphs[beforeGraphs - 1])
  expect(await originalRoot!.evaluate(element => element.isConnected)).toBe(true)
  expect(await composer.textContent()).toBe(draft)
  expect(await response.isVisible()).toBe(true)

  await composer.press('Enter')
  await expect.poll(() => response.count(), { timeout: 20_000 }).toBe(2)
  expect(errors).toEqual([])
  expect(streamErrors).toEqual([])
  expect(navigations).toBe(0)
})

it('keeps a live blank Session blank across a graceful server restart', async () => {
  const world = await mkdtemp(join(tmpdir(), 'dsh-server-restart-'))
  onTestFinished(() => rm(world, { recursive: true, force: true }))
  // The scenario runs no model turn, so the model endpoint is never contacted.
  const server = new RestartableServer(world, 'http://127.0.0.1:9')
  onTestFinished(() => server.stop())
  const workspacePath = join(world, 'workspace')
  await mkdir(workspacePath)
  onTestFailed(async () => {
    await writeFile(join(REPO_ROOT, '.artifacts', 'server-restart-blank-' + randomUUID() + '.json'), JSON.stringify({ server: server.logs() }, null, 2))
  })

  const before = await hostRpc(await server.start(0))
  const { workspace } = await before<{ workspace: { id: string } }>('workspace/create', { request: { path: workspacePath } })
  const { sessionId } = await before<{ sessionId: string }>('session/create', { request: { workspaceId: workspace.id } })
  const listed = async (rpc: HostRpc) => (await rpc<{
    items: { sessionId: string; blank: boolean; agentAvailable: boolean }[]
  }>('session/list', { _request: {} })).items.find(item => item.sessionId === sessionId)
  expect(await listed(before)).toMatchObject({ blank: true, agentAvailable: true })

  // SIGTERM unloads the Web layer, including the list projection, before its live Session detaches;
  // stopping right after creation also precedes the throttled checkpoint of the Session's setup events.
  await server.stop()
  const after = await hostRpc(await server.start(0))
  expect(await listed(after)).toMatchObject({ blank: true, agentAvailable: false })
})

it('creates and reopens a named Activity from a new Session after a Web process restart', async () => {
  const world = await mkdtemp(join(tmpdir(), 'dsh-home-activity-restart-'))
  let modelRequests = 0
  const model = createServer((request, response) => {
    request.resume()
    request.once('end', () => {
      modelRequests++
      const outputText = modelRequests === 1
        ? 'The DSH child reported a saved recovery summary.'
        : 'The recovery parent Session is ready.'
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      const events = [
        { type: 'message_start', message: { id: `activity-recovery-${String(modelRequests)}`, model: 'mock-model', usage: { input_tokens: 3, output_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: outputText } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
        { type: 'message_stop' },
      ]
      response.end(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join(''))
    })
  })
  await new Promise<void>((resolve, reject) => {
    model.once('error', reject)
    model.listen(0, '127.0.0.1', resolve)
  })
  const modelAddress = model.address()
  if (modelAddress === null || typeof modelAddress === 'string') throw new Error('Model fixture did not listen')
  const providerPatch = await writeActivityRecoveryOverlay(world)
  const server = new RestartableServer(world, `http://127.0.0.1:${String(modelAddress.port)}`, [providerPatch])
  const startServer = async (stage: string, port: number) => {
    try {
      return await server.start(port)
    } catch (error: unknown) {
      const output = server.logs()
      const errorTypes = [...new Set([...output.matchAll(/\b[A-Z][A-Za-z0-9]*(?:Error|Exception)\b/gu)].map(match => match[0]))]
      const errorName = error instanceof Error ? error.name : 'unknown'
      const errorCode = typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : 'none'
      throw new Error(`${stage} Web startup did not reach readiness (${server.processState()}; startup error type: ${errorName}; code: ${errorCode}; output bytes: ${output.length}; mentions overlay: ${output.includes('activity-recovery-test-preset.patch.yml')}; mentions fixture: ${output.includes('restart-home-activity-codex')}; server error types: ${errorTypes.join(', ') || 'none'}).`)
    }
  }
  onTestFinished(async () => {
    const failures: unknown[] = []
    await server.stop().catch((error: unknown) => failures.push(error))
    await new Promise<void>((resolve, reject) => {
      model.close((error) => { if (error) reject(error); else resolve() })
      model.closeAllConnections()
    }).catch((error: unknown) => failures.push(error))
    await rm(world, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
    if (failures.length > 0) throw new AggregateError(failures, 'Home Activity restart test cleanup failed')
  })
  const firstWorkspacePath = join(world, 'workspace-one')
  const secondWorkspacePath = join(world, 'workspace-two')
  await mkdir(firstWorkspacePath)
  await mkdir(secondWorkspacePath)

  const firstUrl = await startServer('initial', 0)
  const webPort = Number(new URL(firstUrl).port)
  const first = await hostRpc(firstUrl)
  const { workspace: firstWorkspace } = await first<{ workspace: { workspaceId: string } }>('workspace/create', { request: { path: firstWorkspacePath } })
  const { workspace: secondWorkspace } = await first<{ workspace: { workspaceId: string } }>('workspace/create', { request: { path: secondWorkspacePath } })
  const { sessionId: originalSessionId } = await first<{ sessionId: string }>('session/create', {
    request: { workspaceId: firstWorkspace.workspaceId },
  })
  const { sessionId: linkedSessionId } = await first<{ sessionId: string }>('session/create', {
    request: { workspaceId: secondWorkspace.workspaceId },
  })
  const registrations = (await readFile(join(world, 'home', 'restart-activity-provider-registered.txt'), 'utf8')).trim().split(/\r?\n/u)
  expect(registrations.length).toBeGreaterThanOrEqual(1)
  const created = await first<{ result: { kind: string; text?: string } }>('commands/execute', {
    agentId: originalSessionId,
    line: '/activity create {"name":"Release readiness","objective":"Prepare the next release for review.","boundaries":{"inScope":["Review release notes and focused check results."],"outOfScope":["Do not publish or deploy."]}}',
    submittedAttachments: [],
  })
  expect(created.result.kind).toBe('success')
  expect(created.result.text).toContain('Saved only; its objective has not been started.')
  const activityId = /ID: ([0-9a-f-]{36})/u.exec(created.result.text ?? '')?.[1]
  if (activityId === undefined) throw new Error('Activity creation did not return its stable id')
  const firstList = await first<{ result: { text?: string } }>('commands/execute', {
    agentId: originalSessionId,
    line: '/activity list',
    submittedAttachments: [],
  })
  expect(firstList.result.text).toContain(activityId)
  const execute = async (rpc: HostRpc, agentId: string, line: string) => await rpc<{ result: { kind: string; text?: string } }>(
    'commands/execute', { agentId, line, submittedAttachments: [] },
  )
  for (const workspaceId of [firstWorkspace.workspaceId, secondWorkspace.workspaceId]) {
    const linked = await execute(first, originalSessionId, `/activity link ${activityId} workspace ${workspaceId}`)
    expect(linked.result.kind).toBe('success')
  }
  for (const sessionId of [originalSessionId, linkedSessionId]) {
    const linked = await execute(first, originalSessionId, `/activity link ${activityId} session ${sessionId}`)
    expect(linked.result.kind).toBe('success')
  }

  const dshAdmission = await execute(first, originalSessionId,
    `/activity delegate ${activityId} spawn Summarize the release checklist once for recovery.`)
  expect(dshAdmission.result.kind).toBe('success')
  expect(dshAdmission.result.text).toContain('Delegation admitted: provider spawn')
  let beforeRestartOverview = ''
  await expect.poll(async () => {
    const opened = await execute(first, originalSessionId, `/activity open ${activityId}`)
    beforeRestartOverview = opened.result.text ?? ''
    return beforeRestartOverview
  }, { timeout: 30_000 }).toContain('Provider-reported output: The DSH child reported a saved recovery summary.')
  const dshDelegationId = /Delegation ([0-9a-f-]{36}): provider spawn/u.exec(beforeRestartOverview)?.[1]
  if (dshDelegationId === undefined) throw new Error('The DSH result did not preserve its delegation identity')
  const artifact = await execute(first, originalSessionId,
    `/activity artifact add ${activityId} ${dshDelegationId} ${firstWorkspace.workspaceId} {"label":"Recovery summary","location":"reports/recovery.md"}`)
  expect(artifact.result.kind).toBe('success')
  expect(artifact.result.text).toContain('Artifact reference recorded: Recovery summary')

  const codexReport = await execute(first, originalSessionId,
    `/activity delegate ${activityId} codex Review the release checklist once for recovery.`)
  expect(codexReport.result.kind, codexReport.result.text).toBe('success')
  expect(codexReport.result.text).toContain('Delegation admitted: provider codex')
  await expect.poll(async () => {
    const opened = await execute(first, originalSessionId, `/activity open ${activityId}`)
    beforeRestartOverview = opened.result.text ?? ''
    return beforeRestartOverview
  }, { timeout: 15_000 }).toContain('Codex-reported output: The external one-shot report was saved.')
  const codexUnconfirmed = await execute(first, originalSessionId,
    `/activity delegate ${activityId} codex Review the release checklist once for recovery.`)
  expect(codexUnconfirmed.result.kind).toBe('error')
  expect(codexUnconfirmed.result.text).toContain('DSH could not confirm whether Codex started')
  expect(codexUnconfirmed.result.text).toContain('do not repeat this task unless you have independently confirmed it did not start')

  const startsPath = join(world, 'home', 'restart-activity-provider-starts.txt')
  const codexStartsPath = join(world, 'home', 'restart-activity-codex-starts.txt')
  const providerStartsBeforeRestart = (await readFile(startsPath, 'utf8')).trim().split(/\r?\n/u)
  const codexStartsBeforeRestart = (await readFile(codexStartsPath, 'utf8')).trim().split(/\r?\n/u)
  const modelRequestsBeforeRestart = modelRequests
  expect(providerStartsBeforeRestart).toEqual(['spawn', 'codex'])
  expect(codexStartsBeforeRestart).toEqual(['start', 'start'])

  await server.stop()
  const restartedUrl = await startServer('restarted', webPort)
  const second = await hostRpc(restartedUrl)
  const sessions = await second<{ items: { sessionId: string; agentAvailable: boolean }[] }>('session/list', { _request: {} })
  expect(sessions.items.some(item => item.sessionId === originalSessionId && item.agentAvailable)).toBe(false)
  const browser = await chromium.launch({ headless: true })
  onTestFinished(() => browser.close())
  const page = await newEnglishPage(browser)
  onTestFailed(() => saveFailureShot(page, 'web-e2e-home-activity-process-recovery'))
  const pageErrors: string[] = []
  page.on('pageerror', (error) => { pageErrors.push(String(error)) })
  await page.goto(restartedUrl, { waitUntil: 'load' })
  await page.locator('[data-slot="root"]').waitFor({ state: 'attached', timeout: 20_000 })
  await page.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: 15_000 })
  await connectFreshWorkspace(page, world, 'workspace-recovery')
  const recoveryWorkspaceRow = page.locator('[role="treeitem"][aria-expanded]')
    .filter({ has: page.getByText('workspace-recovery', { exact: true }) })
  await recoveryWorkspaceRow.getByText('workspace-recovery', { exact: true }).hover()
  const createdParentResponse = page.waitForResponse('**/api/session/create')
  await recoveryWorkspaceRow.getByRole('button', {
    name: 'New session in workspace-recovery', exact: true,
  }).click()
  const createdParent = await createdParentResponse
  const createdParentBody = await createdParent.json() as {
    result: { ok: boolean; value: { sessionId: string } }
  }
  expect(createdParentBody.result.ok).toBe(true)
  const newParentSessionId = createdParentBody.result.value.sessionId
  expect(createdParent.request().postDataJSON()).toHaveProperty(
    'payload.args.request.sessionId', newParentSessionId,
  )
  await page.locator(`[data-conversation-session="${newParentSessionId}"]`).waitFor({ timeout: 15_000 })
  await expect.poll(async () => await page.evaluate(() => {
    const selected = localStorage.getItem('dsh.sessions.current')
    return selected === null ? undefined : (JSON.parse(selected) as { sessionId?: string }).sessionId
  }), { timeout: 15_000 }).toBe(newParentSessionId)
  expect(newParentSessionId).not.toBe(originalSessionId)
  expect(newParentSessionId).not.toBe(linkedSessionId)
  const recoveryConversation = page.locator(`[data-conversation-session="${newParentSessionId}"]`)
  await recoveryConversation.waitFor({ timeout: 15_000 })
  const composer = recoveryConversation.locator('[data-composer-input][contenteditable="true"]')
  expect(modelRequests).toBe(modelRequestsBeforeRestart)
  const modelRequestsBeforeRecoveryPrompt = modelRequests
  await writeComposerDraft(page, composer, 'Start a fresh recovery Session and confirm it is ready.')
  await composer.press('Enter')
  await page.getByText('The recovery parent Session is ready.', { exact: true }).last().waitFor({ timeout: 15_000 })
  const modelRequestsBeforeActivityOpen = modelRequests
  expect(modelRequestsBeforeActivityOpen).toBeGreaterThan(modelRequestsBeforeRecoveryPrompt)
  await composer.fill(`/activity open ${activityId}`)
  await composer.press('Enter')
  const activityCard = recoveryConversation.getByRole('button', { name: /Activity: Release readiness/u }).last()
  await activityCard.waitFor({ timeout: 15_000 })
  await activityCard.click()
  const reopened = recoveryConversation.locator('pre').filter({ hasText: 'Activity: Release readiness' }).last()
  await reopened.waitFor({ state: 'visible', timeout: 15_000 })
  const overview = await reopened.textContent() ?? ''
  const dshChildSessionId = /Child Session: ([^\s]+)/u.exec(overview)?.[1]
  if (dshChildSessionId === undefined) throw new Error('The recovered Activity omitted its DSH child Session link')
  expect(overview).toContain(`ID: ${activityId}`)
  expect(overview).toContain('Objective: Prepare the next release for review.')
  expect(overview).toContain('In scope: Review release notes and focused check results.')
  expect(overview).toContain('Out of scope: Do not publish or deploy.')
  expect(overview).toContain(`Workspace: ${basename(firstWorkspacePath)} — ${firstWorkspace.workspaceId}`)
  expect(overview).toContain(`Workspace: ${basename(secondWorkspacePath)} — ${secondWorkspace.workspaceId}`)
  expect(overview).toContain(`DSH Session: ${originalSessionId}`)
  expect(overview).toContain(`DSH Session: ${linkedSessionId}`)
  expect(overview).not.toContain(`DSH Session: ${newParentSessionId}`)
  expect(overview).toContain('Provider-reported output: The DSH child reported a saved recovery summary.')
  expect(overview).toContain('Codex-reported output: The external one-shot report was saved.')
  expect(overview).toContain('Recovery summary')
  expect(overview).toContain('Source location: reports/recovery.md')
  expect(overview).toContain('Outcome: unknown; no provider result was recorded.')
  expect(overview).toContain('do not repeat the task unless you independently confirm it did not start')
  expect(overview).toContain('Activity does not expose a Codex transcript, resume the run, or retry it')
  expect(overview).toContain('does not start work or activate a Goal')
  expect(overview).not.toContain('Status: accepted.')

  await composer.fill('/activity sessions')
  await composer.press('Enter')
  const availableSessions = recoveryConversation.getByText(/Available DSH Sessions/u).last()
  await availableSessions.waitFor({ timeout: 15_000 })
  const sessionListText = await availableSessions.textContent() ?? ''
  expect(sessionListText).toContain(dshChildSessionId)
  expect(sessionListText).toContain(newParentSessionId)
  expect(sessionListText).toContain('Select an id with /activity link')

  expect(pageErrors).toEqual([])
  const reopenedFromHost = await second<{ result: { text?: string } }>('commands/execute', {
    agentId: newParentSessionId, line: `/activity open ${activityId}`, submittedAttachments: [],
  })
  expect(reopenedFromHost.result.text).toContain('does not start work or activate a Goal')
  expect((await readFile(startsPath, 'utf8')).trim().split(/\r?\n/u)).toEqual(providerStartsBeforeRestart)
  expect((await readFile(codexStartsPath, 'utf8')).trim().split(/\r?\n/u)).toEqual(codexStartsBeforeRestart)
  expect(modelRequests).toBe(modelRequestsBeforeActivityOpen)
  expect(modelRequestsBeforeRestart).toBeGreaterThan(0)
})
