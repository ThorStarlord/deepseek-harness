// Web e2e scenario: a user invokes a disable-model-invocation skill through
// the composer (issue #1470). The entered `/name args` line claims into
// skill.invoke: the real host forwards the gesture as an ordinary user
// prompt, injects the rendered body as instructions context named after the
// skill, and starts a turn answered by the replay adapter. Chat shows the
// gesture bubble and reply; the Session retains the injected instructions.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ReplayEntry, ReplayOverrideDoc } from '@deepseek-ai/dsh-llm-replay'
import {
  assertFixtureInventory,
  captureExpandedTurnProcessAria,
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/skill-user-invoke', import.meta.url))
const UI_EXPECTED = join(SNAPSHOT_DIR, 'ui.expected.md')
const UI_EXPANDED_EXPECTED = join(SNAPSHOT_DIR, 'ui-expanded.expected.md')
const MODE = webSnapshotMode()

const SKILL_NAME = 'user-invoke-demo'
const COMPLETION_SKILL_NAME = 'evidence-aware-completion'
const FILE_NAME = 'meeting notes-this-is-a-very-long-filename-for-testing-user-message-file-references-and-preview-layout.md'
const ARGS_TEXT = `@"${FILE_NAME}" and confirm the fixture wiring`
const REPLY = 'USER_INVOKE_REPLY acknowledged; following the injected skill.'
const CASUAL_REPLY = 'CASUAL_REPLY; no completion report was requested.'
const COMPLETION_REPLY = 'No test execution is visible in this Session; I cannot confirm whether tests ran elsewhere.'

async function seedUserOnlySkill(workspaceCwd: string): Promise<void> {
  const directory = join(workspaceCwd, 'workspace', '.agents', 'skills', SKILL_NAME)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'SKILL.md'), [
    '---',
    `name: ${SKILL_NAME}`,
    'description: Prove user-explicit invocation of a model-hidden skill',
    'disable-model-invocation: true',
    '---',
    '',
    'Reply with the fixture acknowledgement line.',
    '',
  ].join('\n'))
}

function replayText(text: string): ReplayEntry {
  return {
    kind: 'chunks' as const,
    chunks: [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text },
      { type: 'block-end', index: 0, block: { type: 'text' as const, text } },
      { type: 'usage', usage: { inputTokens: 256, outputTokens: 16 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ],
  }
}

function skillToolCall(): ReplayEntry {
  const id = ToolCallId('evidence-completion-skill')
  const argumentsJson = JSON.stringify({ name: COMPLETION_SKILL_NAME })
  return {
    kind: 'chunks',
    chunks: [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id, name: 'skill', argumentsDelta: argumentsJson },
      {
        type: 'block-end', index: 0,
        block: { type: 'tool-call', id, name: 'skill', arguments: argumentsJson },
      },
      { type: 'usage', usage: { inputTokens: 256, outputTokens: 16 } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ],
  }
}

const REPLAY: ReplayOverrideDoc = [
  replayText(REPLY),
  replayText(CASUAL_REPLY),
  skillToolCall(),
  replayText(COMPLETION_REPLY),
]

describe.skipIf(MODE === 'record')('web e2e: user-explicit skill invocation through the composer', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let replayDir: string
  let tripwire: ReturnType<typeof watchConsole>
  let conversationSessionId: Awaited<ReturnType<WebScaffold['whenTurnSettled']>> | undefined

  beforeAll(async () => {
    replayDir = await mkdtemp(join(tmpdir(), 'dsh-skill-user-invoke-replay-'))
    const replayOverride = join(replayDir, 'replay.override.json')
    await writeFile(replayOverride, JSON.stringify(REPLAY))
    scaffold = await launchWebScaffold({
      replayFixture: join(replayDir, 'override-only.jsonl'),
      replayOverride,
      // Paced replay keeps the timing-derived chrome (TTFT / tok/s) present
      // deterministically; instant playback races it in and out of the golden.
      paceMs: 10,
    })
    await seedUserOnlySkill(scaffold.workspaceCwd)
    await writeFile(join(scaffold.workspaceCwd, 'workspace', FILE_NAME), '# Meeting notes\n\nSent reference preview.\n')
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    const failures: unknown[] = []
    await browser?.close().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (replayDir !== undefined) {
      await rm(replayDir, { recursive: true, force: true })
        .catch((error: unknown) => failures.push(error))
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'skill-user-invoke e2e cleanup failed')
  })

  it('claims /name args into a gesture bubble, logged instructions, and a replayed answer', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-skill-user-invoke'))
    const composer = page.locator('[data-composer-input][contenteditable="true"]').last()
    await composer.waitFor({ timeout: 15_000 })

    // The menu lists the user-only skill (its only entry point) before enter.
    await composer.fill(`/${SKILL_NAME}`)
    const menu = page.getByRole('listbox', { name: 'Trigger suggestions' })
    await expect.poll(
      () => menu.getByRole('option', { name: new RegExp(SKILL_NAME) }).count(),
      { timeout: 10_000 },
    ).toBe(1)

    const settled = scaffold.whenTurnSettled()
    await composer.fill(`/${SKILL_NAME} ${ARGS_TEXT}`)
    await composer.press('Enter')

    // The gesture stays an ordinary user bubble with the skill chip and trailing text.
    const bubble = page.locator('[data-ref-chip="skill"]').first()
    await bubble.waitFor({ timeout: 15_000 })
    expect(await bubble.textContent()).toBe(`/${SKILL_NAME}`)

    await page.getByText('USER_INVOKE_REPLY', { exact: false }).first().waitFor({ timeout: 20_000 })
    const sessionId = conversationSessionId = await settled
    const process = page.locator('[data-turn-process]')
    await process.waitFor({ state: 'visible', timeout: 10_000 })
    // The chip derives from the step's logged injection, so it must survive
    // every later Node rebuild of the Turn (process publication, turn close).
    expect(await bubble.count()).toBe(1)
    expect(await bubble.textContent()).toBe(`/${SKILL_NAME}`)
    // The loaded instructions stay out of the bubble as their own collapsed Context row.
    // The folded Turn process holds it, so match the row without requiring it to be visible.
    const skillContext = page.locator('[data-chat-flow-kind="context"] [data-disclosure-row]')
      .filter({ hasText: new RegExp(`^Context injection${SKILL_NAME}`) })
    expect(await skillContext.count()).toBe(1)
    expect(await skillContext.getAttribute('aria-expanded')).toBe('false')
    const session = scaffold.ctx.sessions.get(sessionId)
    if (session === undefined) throw new Error('skill invocation session is unavailable')
    const injected = session.snapshotEvents().flatMap(event => event.type === 'user/message'
      && event.data.source.kind === 'skill-invocation'
      ? event.data.content.flatMap(block => block.type === 'text' ? [block.text] : []) : []).join('')
    expect(injected).toContain(`<skill_content name="${SKILL_NAME}">`)
    expect(injected).toContain('Reply with the fixture acknowledgement line.')
    expect(injected).not.toContain(ARGS_TEXT)

    const snapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    const expanded = await captureExpandedTurnProcessAria(
      page,
      '[class*="centerCol"]',
      scaffold.workspaceCwd,
    )
    await compareOrRefreshGolden(UI_EXPANDED_EXPECTED, expanded, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it('previews sent skill and quoted file references with prose-link hover styling after reloading history', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-sent-reference-preview'))
    await page.reload({ waitUntil: 'load' })
    const skill = page.locator('[data-chat-flow-kind="user"] [data-ref-chip="skill"]').first()
    await skill.waitFor({ timeout: 15_000 })
    const preview = page.locator('[data-document-markdown]')
    await skill.hover()
    await expect.poll(() => skill.evaluate(el => getComputedStyle(el).textDecorationStyle)).toBe('dotted')
    await skill.click()
    await expect.poll(() => preview.textContent(), { timeout: 10_000 }).toContain('Reply with the fixture acknowledgement line.')
    const file = page.locator('[data-chat-flow-kind="user"] [data-ref-chip="file"]').first()
    const bounds = await file.evaluate((element) => {
      const bubble = element.closest('[class*="bubble"]')
      if (bubble === null) throw new Error('file reference has no user bubble')
      const label = element.getBoundingClientRect()
      const container = bubble.getBoundingClientRect()
      return {
        left: label.left - container.left, right: container.right - label.right,
        height: label.height, lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
      }
    })
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeGreaterThanOrEqual(0)
    expect(bounds.height).toBeGreaterThan(bounds.lineHeight)
    await file.hover()
    expect(await file.evaluate(el => getComputedStyle(el).textDecorationStyle)).toBe('dotted')
    await file.click()
    await expect.poll(() => preview.textContent()).toContain('Sent reference preview.')
    await skill.click()
    await expect.poll(() => preview.textContent()).toContain('Reply with the fixture acknowledgement line.')
    expect(await page.locator('[data-chat-flow-kind="user"]').first().textContent()).toContain('and confirm the fixture wiring')
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })

  it('loads completion guidance only for a matching engineering report', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-evidence-aware-completion'))
    const composer = page.locator('[data-composer-input][contenteditable="true"]').last()
    const session = conversationSessionId === undefined
      ? undefined
      : scaffold.ctx.sessions.get(conversationSessionId)
    if (session === undefined) throw new Error('completion guidance Session is unavailable')
    const casualSettled = scaffold.whenTurnSettled()
    await composer.fill('What are three kinds of tea?')
    await composer.press('Enter')
    await page.getByText(CASUAL_REPLY, { exact: true }).waitFor({ timeout: 20_000 })
    await casualSettled
    const catalogEvents = session.snapshotEvents().filter(event => (
      event.type === 'user/message' && event.data.source.kind === 'skill-catalog'
    ))
    expect(catalogEvents.flatMap(event => event.type === 'user/message'
      && event.data.source.kind === 'skill-catalog' ? event.data.source.entries : []))
      .toContainEqual(expect.objectContaining({ name: COMPLETION_SKILL_NAME }))
    const catalogText = catalogEvents.flatMap(event => event.type === 'user/message'
      && event.data.source.kind === 'skill-catalog'
      ? event.data.content.flatMap(block => block.type === 'text' ? [block.text] : [])
      : []).join('\n')
    expect(catalogText).not.toContain('**Not observed:**')
    const callsBeforeCompletion = session.snapshotEvents().filter(event => event.type === 'tool/call').length
    expect(callsBeforeCompletion).toBe(0)

    await composer.fill('Summarize this completed engineering work and report only verification supported by this Session.')
    const completionSettled = scaffold.whenTurnSettled()
    await composer.press('Enter')
    await page.getByText(COMPLETION_REPLY, { exact: true }).waitFor({ timeout: 20_000 })
    await completionSettled

    const events = session.snapshotEvents()
    const skillCall = events.find(event => event.type === 'tool/call' && event.data.name === 'skill')
    expect(skillCall?.type === 'tool/call' ? JSON.parse(skillCall.data.arguments) : undefined)
      .toEqual({ name: COMPLETION_SKILL_NAME })
    const skillResult = skillCall?.type === 'tool/call'
      ? events.find(event => event.type === 'tool/result'
        && event.data.message.toolCallId === skillCall.data.callId)
      : undefined
    const skillResultText = skillResult?.type === 'tool/result'
      ? skillResult.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
      : ''
    expect(skillResultText).toContain(`<skill_content name="${COMPLETION_SKILL_NAME}">`)
    expect(skillResultText).toContain('**Not observed:**')
    expect(skillResult?.type === 'tool/result' ? skillResult.data.message.isError : true).toBeFalsy()
    expect(events.filter(event => event.type === 'tool/call')).toHaveLength(callsBeforeCompletion + 1)
    expect(await readFile(join(scaffold.workspaceCwd, 'workspace', FILE_NAME), 'utf8'))
      .toBe('# Meeting notes\n\nSent reference preview.\n')
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['ui.expected.md', 'ui-expanded.expected.md'])
  })
})
