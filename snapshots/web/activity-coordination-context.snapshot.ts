/** Pin the user-authored source context supplied to a coordinating Session. */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Activity, ActivityId } from '@deepseek-ai/dsh-home-activity/activity-types'
import type { ActivityCoordinationSessionSnapshot } from '@deepseek-ai/dsh-home-activity/coordination-types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { contextMessage } from '../../packages/client/ui-activity-coordination/src/client/surface.ts'

const FIXTURE = fileURLToPath(new URL('./activity-coordination-context/session.v4.jsonl', import.meta.url))

describe('Activity coordination Session context', () => {
  it('matches the recorded model-visible source evidence message', async () => {
    const fixture = await readFile(FIXTURE, 'utf8')
    const expected = fixture.split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line) as {
      readonly type?: string
      readonly data?: { readonly content?: readonly { readonly type?: string; readonly text?: string }[] }
    }).flatMap(event => event.type === 'user/message' ? event.data?.content ?? [] : [])
      .find(part => part.type === 'text' && part.text?.includes('"recordType": "user-selected-activity-session-context"'))?.text
    expect(expected).toBeDefined()

    const activity: Activity = {
      id: brandString<ActivityId>('activity-context-fixture'),
      name: 'Coordination evidence fixture',
      objective: 'Distinguish target Session reports from verified outcomes.',
      boundaries: { inScope: ['Review selected Session evidence'], outOfScope: ['Do not start or change work'] },
      createdAt: '2026-11-25T01:00:00.000Z',
    }
    const snapshot: ActivityCoordinationSessionSnapshot = {
      activityId: activity.id,
      workspaceId: brandString<WorkspaceId>('workspace-context-fixture'),
      workspaceTitle: 'Fixture repository',
      workspacePath: 'C:/Fixture/Repository',
      sessionId: brandString<SessionId>('session-target-fixture'),
      sessionCwd: 'C:/Fixture/Repository',
      sessionCreatedAt: 1_795_554_000_000,
      observedAt: 1_795_555_000_000,
      source: 'live',
      cursor: 12,
      runtime: 'loaded',
      recentMessages: [{
        role: 'assistant',
        sourceKind: 'model',
        eventSeq: 12,
        time: 1_795_554_999_000,
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        text: 'The bounded inspection is complete. One test remains unrun.',
        truncated: false,
      }],
    }

    expect(contextMessage(activity, [snapshot])).toBe(expected)
  })
})
