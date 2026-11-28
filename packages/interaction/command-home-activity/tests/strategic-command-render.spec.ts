import { expect, it } from 'vitest'
import { ActivityId } from '@deepseek-ai/dsh-home-activity'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {
  ActivityStrategicEpisode,
  ActivityStrategicEpisodeId,
} from '@deepseek-ai/dsh-home-activity/strategic-episodes'
import { renderActivityStrategicEpisodes } from '../src/strategic-command.ts'

const activityId = ActivityId('00000000-0000-4000-8000-000000000021')

it('renders no-history guidance, latest summaries, and historical freshness without changing source attribution', () => {
  expect(renderActivityStrategicEpisodes([], activityId)).toEqual([
    'Strategic Assessments:',
    'No Activity Strategic Briefs have been saved.',
    `Use /activity workspaces to see registered Workspace ids, then run /activity assess ${activityId} <workspace-id> <workspace-id> to request an assessment.`,
  ])

  const episodes = [
    episode(1, {
      repositories: [
        observed('workspace-a', 'Alpha', 'a'.repeat(40), 'dirty', null, '2026-11-20T10:00:00.000Z', null),
        observed('workspace-b', 'Beta', 'b'.repeat(40), 'clean', false, '2026-11-20T10:00:00.000Z', '2026-11-20T10:01:00.000Z'),
      ],
      evidence: [
        reference('E1', 'workspace-a', 'a'.repeat(40), 'src/index.ts', 4, 4),
        reference('E2', 'workspace-a', 'a'.repeat(40), 'README.md'),
        reference('E3', 'workspace-a', 'a'.repeat(40), 'src/strategy.ts', 7),
        reference('E4', 'workspace-a', 'a'.repeat(40), 'src/guard.ts', 8, 10),
      ],
      findings: [
        { kind: 'interpretation', category: 'capability', statement: 'Existing integration may suffice.', evidenceIds: [] },
        { kind: 'source-observation', category: 'ownership', statement: 'The Activity remains advisory.', evidenceIds: ['E1'] },
      ],
      alternatives: [
        { name: 'Reuse', consequence: 'Retains current ownership.', evidenceIds: [], uncertaintyIds: [] },
        { name: 'Adapt', consequence: 'Adds a small integration point.', evidenceIds: ['E1'], uncertaintyIds: ['U1'] },
      ],
      uncertainties: [
        { id: 'U1', statement: 'Current integration use is not measured.', evidenceIds: [] },
        { id: 'U2', statement: 'The second source could not be read.', evidenceIds: ['E2'] },
      ],
    }),
    episode(2, {
      repositories: [
        observed('workspace-a', 'Alpha', 'b'.repeat(40), 'unknown', true, '2026-11-21T10:00:00.000Z', null),
        observed('workspace-b', 'Beta', 'b'.repeat(40), 'clean', false, '2026-11-21T10:00:00.000Z', '2026-11-21T10:01:00.000Z'),
      ],
    }),
    episode(3, {
      repositories: [
        observed('workspace-a', 'Alpha', 'c'.repeat(40), 'clean', false, '2026-11-22T10:00:00.000Z', '2026-11-22T10:01:00.000Z'),
        unavailable('workspace-b', 'Beta'),
      ],
      recommendation: { disposition: 'NO_CHANGE', responsibility: null, rationale: 'No new work is warranted from this historical episode.', scope: 'within-activity', evidenceIds: [], uncertaintyIds: [] },
    }),
  ]

  const latest = renderActivityStrategicEpisodes(episodes, activityId).join('\n')
  expect(latest).toContain('Latest Activity Strategic Brief (agent-authored; not independently verified or user-accepted):')
  expect(latest).toContain('2 earlier briefs remain saved;')
  expect(latest).toContain('Recommendation: NO_CHANGE — no next responsibility selected (within-activity) [Evidence: none; uncertainty: none]')
  expect(latest).toContain('working tree clean; stable during recorded observation')
  expect(latest).toContain('unavailable during this assessment; no source claims are confirmed.')
  const twoEpisodeView = renderActivityStrategicEpisodes(episodes.slice(0, 2), activityId).join('\\n')
  expect(twoEpisodeView).toContain('1 earlier brief remains saved;')
  expect(latest).toContain('Opening an Activity shows stored episodes only.')

  const historical = renderActivityStrategicEpisodes(episodes, activityId, 1).join('\n')
  expect(historical).toContain('Activity Strategic Brief revision 1 (agent-authored; not independently verified or user-accepted):')
  expect(historical).toContain('a later saved observation is at ' + 'c'.repeat(40))
  expect(historical).toContain('a later assessment could not observe this Workspace; historical applicability is uncertain')
  expect(historical).toContain('observation started 2026-11-20T10:00:00.000Z; end time unavailable')
  expect(historical).toContain('working tree dirty; HEAD is only the committed base')
  expect(historical).toContain('source stability is unknown')
  expect(historical).toContain('E1: workspace-a@' + 'a'.repeat(40) + ' src/index.ts:4')
  expect(historical).toContain('src/strategy.ts:7')
  expect(historical).toContain('src/guard.ts:8-10')
  expect(historical).toContain('README.md')
  expect(historical).toContain('no source reference')
  expect(historical).toContain('uncertainty: none')

  const changed = renderActivityStrategicEpisodes(episodes, activityId, 2).join('\n')
  expect(changed).toContain('source changed during observation; findings may be stale')
  expect(changed).toContain('working tree unknown')
  expect(changed).toContain('observed 2026-11-21T10:00:00.000Z to 2026-11-21T10:01:00.000Z')

  const missing = renderActivityStrategicEpisodes(episodes, activityId, 99).join('\n')
  expect(missing).toContain('Activity Strategic Brief revision 99')
  expect(missing).not.toContain('Assessment 1:')
})

function episode(
  revision: number,
  overrides: Partial<Pick<ActivityStrategicEpisode,
    'repositories' | 'evidence' | 'findings' | 'alternatives' | 'uncertainties' | 'recommendation'>> = {},
): ActivityStrategicEpisode {
  return {
    id: brandString<ActivityStrategicEpisodeId>(`episode-${revision}`),
    activityId,
    revision,
    originSessionId: `session-${revision}`,
    producer: 'dsh-active-agent',
    requestId: `request-${revision}`,
    objective: 'Select a useful bounded next responsibility.',
    status: 'complete',
    repositories: [],
    skillDigests: [],
    evidence: [],
    findings: [],
    alternatives: [],
    uncertainties: [],
    recommendation: {
      disposition: 'INVESTIGATE',
      responsibility: 'Compare the available source evidence.',
      rationale: 'The source observations support a bounded comparison.',
      scope: 'within-activity',
      evidenceIds: ['E1'],
      uncertaintyIds: ['U1'],
    },
    requestedAt: '2026-11-20T09:59:00.000Z',
    recordedAt: `2026-11-${String(20 + revision).padStart(2, '0')}T10:02:00.000Z`,
    ...overrides,
  }
}

function observed(
  workspaceId: string,
  title: string,
  revision: string,
  workingTree: 'clean' | 'dirty' | 'unknown',
  sourceChanged: boolean | null,
  observedAtStart: string,
  observedAtEnd: string | null,
): ActivityStrategicEpisode['repositories'][number] {
  return { workspaceId, title, status: 'observed', revision, workingTree, sourceChanged, observedAtStart, observedAtEnd }
}

function unavailable(workspaceId: string, title: string): ActivityStrategicEpisode['repositories'][number] {
  return { workspaceId, title, status: 'unavailable', revision: null, workingTree: 'unknown', sourceChanged: null, observedAtStart: null, observedAtEnd: null }
}

function reference(
  id: string,
  workspaceId: string,
  revision: string,
  path: string,
  lineStart?: number,
  lineEnd?: number,
): ActivityStrategicEpisode['evidence'][number] {
  return { id, workspaceId, revision, path, ...(lineStart === undefined ? {} : { lineStart }), ...(lineEnd === undefined ? {} : { lineEnd }), note: `Evidence note ${id}.` }
}
