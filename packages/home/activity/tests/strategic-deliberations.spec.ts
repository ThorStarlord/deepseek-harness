import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import HomeActivityService from '../src/index.ts'
import HomeActivityStrategicEpisodeService from '../src/strategic-episodes.ts'
import HomeActivityStrategicDeliberationService from '../src/strategic-deliberations.ts'
import type { ActivityId } from '../src/types.ts'
import type { ActivityStrategicEpisode } from '../src/strategic-episode-types.ts'
import type { RecordActivityStrategicDeliberationRequest } from '../src/strategic-deliberation-types.ts'

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function harness(root: string) {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(HomeActivityService)
  await ctx.plugin(HomeActivityStrategicEpisodeService)
  await ctx.plugin(HomeActivityStrategicDeliberationService)
  return ctx
}

function brief(activityId: ActivityId) {
  const revisionA = 'a'.repeat(40)
  const revisionB = 'b'.repeat(40)
  return {
    activityId,
    originSessionId: 'session-brief',
    requestId: '00000000-0000-4000-8000-000000000051',
    skillDigests: [
      { name: 'using-sensemaking', provider: 'fixture', digest: '1'.repeat(64) },
      { name: 'multi-repository-strategic-analysis', provider: 'fixture', digest: '2'.repeat(64) },
    ],
    requestedAt: '2026-11-23T10:00:00.000Z',
    status: 'complete' as const,
    repositories: [
      { workspaceId: '00000000-0000-4000-8000-000000000011', title: 'Harness', status: 'observed' as const, revision: revisionA, workingTree: 'clean' as const, sourceChanged: false, observedAtStart: '2026-11-23T10:00:00.000Z', observedAtEnd: '2026-11-23T10:00:10.000Z' },
      { workspaceId: '00000000-0000-4000-8000-000000000012', title: 'Sensemaking', status: 'observed' as const, revision: revisionB, workingTree: 'clean' as const, sourceChanged: false, observedAtStart: '2026-11-23T10:00:00.000Z', observedAtEnd: '2026-11-23T10:00:10.000Z' },
    ],
    evidence: [
      { id: 'E1', workspaceId: '00000000-0000-4000-8000-000000000011', revision: revisionA, path: 'README.md', note: 'The existing Activity brief is durable.' },
      { id: 'E2', workspaceId: '00000000-0000-4000-8000-000000000012', revision: revisionB, path: 'skills/using-sensemaking/SKILL.md', note: 'The Skill asks the active agent to select a warranted direction.' },
    ],
    findings: [{ kind: 'source-observation' as const, category: 'capability' as const, statement: 'A prior brief exists.', evidenceIds: ['E1', 'E2'] }],
    alternatives: [
      { name: 'Use the existing method', consequence: 'Avoid another controller.', evidenceIds: ['E1', 'E2'], uncertaintyIds: ['U1'] },
      { name: 'Build an adapter', consequence: 'Adds a retrieval seam.', evidenceIds: ['E1', 'E2'], uncertaintyIds: ['U1'] },
    ],
    uncertainties: [{ id: 'U1', statement: 'Repeated reentry may show a context gap.', evidenceIds: ['E1', 'E2'] }],
    recommendation: { disposition: 'INVESTIGATE' as const, responsibility: 'Try the existing Skill in one strategic assessment.', rationale: 'The source does not yet establish a retrieval gap.', scope: 'within-activity' as const, evidenceIds: ['E1', 'E2'], uncertaintyIds: ['U1'] },
  }
}

function reconsider(activityId: ActivityId, source: ActivityStrategicEpisode): RecordActivityStrategicDeliberationRequest {
  return {
    activityId,
    originSessionId: 'session-later',
    requestId: '00000000-0000-4000-8000-000000000052',
    sourceEpisodeId: source.id,
    sourceEpisodeRevision: source.revision,
    decisionQuestion: 'Is the existing Skill interface sufficient for the next use?',
    outcome: 'next-responsibility',
    disposition: 'adapt',
    proposedResponsibility: 'Run one explicit assessment using the existing Skills and record retrieval gaps.',
    scope: 'within-activity',
    rationale: 'The historical evidence supports a bounded use, while the unresolved uncertainty remains open.',
    evidenceUses: [
      { evidenceId: 'E1', treatment: 'supports', rationale: 'It shows the brief can be recovered.' },
      { evidenceId: 'E2', treatment: 'limits', rationale: 'It defines a method but does not establish runtime retrieval quality.' },
    ],
    uncertaintyReviews: [{ uncertaintyId: 'U1', treatment: 'remains-open', rationale: 'No newer source observation was made.' }],
    newUncertainties: [{ id: 'N1', statement: 'A real later Session may reveal missing context.', evidenceIds: ['E1'] }],
    skillDigests: [
      { name: 'using-sensemaking', provider: 'fixture', digest: '3'.repeat(64) },
      { name: 'strategic-repository-analysis', provider: 'fixture', digest: '4'.repeat(64) },
    ],
    requestedAt: '2026-11-23T10:02:00.000Z',
  }
}

it('appends source-linked deliberations and recovers them without rewriting historical briefs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-deliberation-')); roots.push(root)
  let ctx = await harness(root)
  const activity = await ctx.homeActivities.create({
    name: 'Strategic reentry', objective: 'Reconsider prior evidence in a later Session.',
    boundaries: { inScope: ['Produce advisory next-responsibility decisions.'], outOfScope: ['Do not implement automatically.'] },
  })
  const source = await ctx.homeActivityStrategicEpisodes.record(brief(activity.id))
  const request = reconsider(activity.id, source)
  const first = await ctx.homeActivityStrategicDeliberations.record(request)
  expect(first).toMatchObject({
    revision: 1,
    sourceEpisodeId: source.id,
    sourceEpisodeRevision: source.revision,
    sourceEpisodeRecordedAt: source.recordedAt,
    sourceEpisodeSessionId: source.originSessionId,
    originSessionId: 'session-later',
    producer: 'dsh-active-agent',
    outcome: 'next-responsibility',
    disposition: 'adapt',
  })
  expect(await ctx.homeActivityStrategicDeliberations.record(request)).toEqual(first)
  const followup = await ctx.homeActivityStrategicDeliberations.record({
    ...request,
    requestId: '00000000-0000-4000-8000-000000000053',
    outcome: 'insufficient-evidence',
    disposition: 'defer',
    proposedResponsibility: null,
    rationale: 'The old source observations are too stale to choose a current responsibility.',
    requestedAt: '2026-11-23T10:04:00.000Z',
  })
  expect(followup).toMatchObject({ revision: 2, supersedes: first.id, sourceEpisodeId: source.id, outcome: 'insufficient-evidence' })
  const rejectedRecommendation = await ctx.homeActivityStrategicDeliberations.record({
    ...request,
    requestId: '00000000-0000-4000-8000-000000000057',
    outcome: 'no-selection',
    disposition: 'reject',
    proposedResponsibility: null,
    rationale: 'The old recommendation does not answer the current decision question.',
    requestedAt: '2026-11-23T10:05:00.000Z',
  })
  expect(rejectedRecommendation).toMatchObject({ revision: 3, supersedes: followup.id, disposition: 'reject', outcome: 'no-selection' })
  const retainedRecommendation = await ctx.homeActivityStrategicDeliberations.record({
    ...request,
    requestId: '00000000-0000-4000-8000-000000000058',
    outcome: 'next-responsibility',
    disposition: 'retain',
    rationale: 'The bounded recommendation still answers the Activity question.',
    requestedAt: '2026-11-23T10:06:00.000Z',
  })
  expect(retainedRecommendation).toMatchObject({ revision: 4, supersedes: rejectedRecommendation.id, disposition: 'retain' })
  expect(ctx.homeActivityStrategicEpisodes.list(activity.id)).toEqual([source])
  await ctx.fiber.dispose()

  ctx = await harness(root)
  expect(ctx.homeActivityStrategicDeliberations.list(activity.id)).toEqual([
    first, followup, rejectedRecommendation, retainedRecommendation,
  ])
  expect(ctx.homeActivityStrategicEpisodes.list(activity.id)).toEqual([source])
})

it('rejects a missing exact source revision and evidence identifiers from another brief', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-deliberation-validation-')); roots.push(root)
  const ctx = await harness(root)
  const activity = await ctx.homeActivities.create({
    name: 'Strategic reentry', objective: 'Reconsider prior evidence in a later Session.',
    boundaries: { inScope: ['Produce advisory next-responsibility decisions.'], outOfScope: ['Do not implement automatically.'] },
  })
  const source = await ctx.homeActivityStrategicEpisodes.record(brief(activity.id))
  await expect(ctx.homeActivityStrategicDeliberations.record({
    ...reconsider(activity.id, source), sourceEpisodeRevision: 2,
  })).rejects.toMatchObject({ code: 'unknown-source-episode' })
  await expect(ctx.homeActivityStrategicDeliberations.record({
    ...reconsider(activity.id, source),
    requestId: '00000000-0000-4000-8000-000000000054',
    evidenceUses: [{ evidenceId: 'E9', treatment: 'supports', rationale: 'Not present in this brief.' }],
  })).rejects.toMatchObject({ code: 'invalid-deliberation' })
  await expect(ctx.homeActivityStrategicDeliberations.record({
    ...reconsider(activity.id, source),
    requestId: '00000000-0000-4000-8000-000000000055',
    outcome: 'next-responsibility',
    scope: 'outside-activity',
  })).rejects.toMatchObject({ code: 'invalid-deliberation' })
  await expect(ctx.homeActivityStrategicDeliberations.record({
    ...reconsider(activity.id, source),
    requestId: '00000000-0000-4000-8000-000000000056',
    outcome: 'owner-decision',
    disposition: 'adapt',
    scope: 'within-activity',
  })).rejects.toMatchObject({ code: 'invalid-deliberation' })
  expect(ctx.homeActivityStrategicDeliberations.list(activity.id)).toEqual([])
})
