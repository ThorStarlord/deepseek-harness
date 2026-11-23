import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import HomeActivityService, { ActivityId } from '../src/index.ts'
import HomeActivityStrategicEpisodeService from '../src/strategic-episodes.ts'
import type { ActivityId as ActivityIdType } from '../src/types.ts'
import type { CreateActivityRequest } from '../src/types.ts'

const contexts: Context[] = []
const roots: string[] = []
const activityRequest: CreateActivityRequest = {
  name: 'Sensemaking integration',
  objective: 'Improve the practical integration of Sensemaking capabilities into DeepSeek Harness development workflows.',
  boundaries: { inScope: ['Assess DSH and Sensemaking source.'], outOfScope: ['Do not start implementation.'] },
}

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
  return ctx
}

function brief(activityId: ActivityIdType) {
  const firstRevision = 'a'.repeat(40)
  const secondRevision = 'b'.repeat(40)
  return {
    activityId,
    originSessionId: 'session-first',
    requestId: '00000000-0000-4000-8000-000000000021',
    skillDigests: [
      { name: 'using-sensemaking' as const, provider: 'filesystem', digest: '1'.repeat(64) },
      { name: 'multi-repository-strategic-analysis' as const, provider: 'filesystem', digest: '2'.repeat(64) },
    ],
    status: 'complete' as const,
    repositories: [
      { workspaceId: '00000000-0000-4000-8000-000000000011', title: 'Harness', status: 'observed' as const, revision: firstRevision, workingTree: 'clean' as const, sourceChanged: false, observedAtStart: '2026-11-22T10:00:00.000Z', observedAtEnd: '2026-11-22T10:00:10.000Z' },
      { workspaceId: '00000000-0000-4000-8000-000000000012', title: 'Sensemaking', status: 'observed' as const, revision: secondRevision, workingTree: 'clean' as const, sourceChanged: false, observedAtStart: '2026-11-22T10:00:00.000Z', observedAtEnd: '2026-11-22T10:00:10.000Z' },
    ] as const,
    evidence: [
      { id: 'E1', workspaceId: '00000000-0000-4000-8000-000000000011', revision: firstRevision, path: 'packages/home/activity/README.md', lineStart: 12, note: 'Activity records are separate from Session lifecycle.' },
      { id: 'E2', workspaceId: '00000000-0000-4000-8000-000000000012', revision: secondRevision, path: 'skills/multi-repository-strategic-analysis/SKILL.md', lineStart: 20, note: 'Analysis remains advisory.' },
    ] as const,
    findings: [
      { kind: 'source-observation' as const, category: 'capability' as const, statement: 'DSH supports durable Activity records.', evidenceIds: ['E1'] },
    ],
    alternatives: [
      { name: 'Reuse existing Skill invocation', consequence: 'Avoid a second strategic controller.', evidenceIds: ['E1', 'E2'], uncertaintyIds: ['U1'] },
      { name: 'Add a native adapter', consequence: 'Could improve direct retrieval but would add another integration surface.', evidenceIds: ['E1', 'E2'], uncertaintyIds: ['U1'] },
    ],
    uncertainties: [{ id: 'U1', statement: 'The selected DSH profile may not load the Sensemaking Skills.', evidenceIds: ['E2'] }],
    recommendation: {
      disposition: 'INVESTIGATE' as const,
      responsibility: 'Qualify the Skill-based assessment path.',
      rationale: 'Verify the existing Skill and repository-read interfaces before adding an adapter.',
      scope: 'within-activity' as const,
      evidenceIds: ['E1', 'E2'],
      uncertaintyIds: ['U1'],
    },
    requestedAt: '2026-11-22T09:59:00.000Z',
  }
}

it('retains source-attributed episodes across restart and never rewrites earlier recommendations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-strategic-episodes-')); roots.push(root)
  const first = await harness(root)
  const activity = await first.homeActivities.create(activityRequest)
  const initial = await first.homeActivityStrategicEpisodes.record(brief(activity.id))
  expect(await first.homeActivityStrategicEpisodes.record(brief(activity.id))).toEqual(initial)
  const later = await first.homeActivityStrategicEpisodes.record({
    ...brief(activity.id),
    originSessionId: 'session-second',
    requestId: '00000000-0000-4000-8000-000000000022',
    repositories: [
      { ...brief(activity.id).repositories[0], revision: 'c'.repeat(40) },
      brief(activity.id).repositories[1],
    ],
    evidence: [
      { ...brief(activity.id).evidence[0], revision: 'c'.repeat(40) },
      brief(activity.id).evidence[1],
    ],
    recommendation: {
      disposition: 'NO_CHANGE',
      responsibility: null,
      rationale: 'The available sources do not establish a need for additional infrastructure.',
      scope: 'within-activity',
      evidenceIds: ['E1', 'E2'],
      uncertaintyIds: ['U1'],
    },
  })
  expect(later).toMatchObject({ revision: 2, supersedes: initial.id, originSessionId: 'session-second' })
  expect(first.homeActivityStrategicEpisodes.list(activity.id)).toEqual([initial, later])
  expect(initial.repositories[0]?.revision).toBe('a'.repeat(40))
  expect(initial.recommendation.disposition).toBe('INVESTIGATE')
  await first.fiber.dispose()

  const reopened = await harness(root)
  expect(reopened.homeActivities.get(activity.id)?.objective).toBe(activityRequest.objective)
  expect(reopened.homeActivityStrategicEpisodes.list(activity.id)).toEqual([initial, later])
  expect(reopened.homeActivityStrategicEpisodes.list(activity.id)[0]?.repositories[0]?.revision).toBe('a'.repeat(40))
  expect(reopened.homeActivityStrategicEpisodes.list(activity.id)[1]?.repositories[0]?.revision).toBe('c'.repeat(40))
})

it('rejects uncited paths, mismatched source revisions, and unknown Activities', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-strategic-validation-')); roots.push(root)
  const ctx = await harness(root)
  const activity = await ctx.homeActivities.create(activityRequest)

  await expect(ctx.homeActivityStrategicEpisodes.record({
    ...brief(activity.id),
    evidence: [{ ...brief(activity.id).evidence[0], path: '../private.txt' }, brief(activity.id).evidence[1]],
  })).rejects.toMatchObject({ code: 'invalid-episode' })
  await expect(ctx.homeActivityStrategicEpisodes.record({
    ...brief(activity.id),
    repositories: [
      { ...brief(activity.id).repositories[0], revision: 'c'.repeat(40) },
      brief(activity.id).repositories[1],
    ],
  })).rejects.toMatchObject({ code: 'invalid-episode' })
  await expect(ctx.homeActivityStrategicEpisodes.record({
    ...brief(activity.id),
    activityId: ActivityId('00000000-0000-4000-8000-000000000099'),
  })).rejects.toMatchObject({ code: 'unknown-activity' })
  await expect(ctx.homeActivityStrategicEpisodes.record({
    ...brief(activity.id),
    requestId: '00000000-0000-4000-8000-000000000024',
    repositories: [
      { ...brief(activity.id).repositories[0], workingTree: 'dirty' },
      brief(activity.id).repositories[1],
    ],
  })).rejects.toMatchObject({ code: 'invalid-episode' })
  await expect(ctx.homeActivityStrategicEpisodes.record({
    ...brief(activity.id),
    requestId: '00000000-0000-4000-8000-000000000025',
    repositories: [
      { ...brief(activity.id).repositories[0], sourceChanged: true },
      brief(activity.id).repositories[1],
    ],
  })).rejects.toMatchObject({ code: 'invalid-episode' })
  expect(ctx.homeActivityStrategicEpisodes.list(activity.id)).toEqual([])
})

it('requires an unavailable repository to remain explicitly incomplete', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-strategic-incomplete-')); roots.push(root)
  const ctx = await harness(root)
  const activity = await ctx.homeActivities.create(activityRequest)
  const unavailable = {
    ...brief(activity.id),
    requestId: '00000000-0000-4000-8000-000000000023',
    repositories: [
      {
        ...brief(activity.id).repositories[0],
        status: 'unavailable' as const,
        revision: null,
        workingTree: 'unknown' as const,
        sourceChanged: null,
        observedAtStart: null,
        observedAtEnd: null,
      },
      brief(activity.id).repositories[1],
    ] as const,
  }
  await expect(ctx.homeActivityStrategicEpisodes.record(unavailable)).rejects.toMatchObject({ code: 'invalid-episode' })
  const incomplete = await ctx.homeActivityStrategicEpisodes.record({
    ...unavailable,
    status: 'incomplete',
    evidence: [brief(activity.id).evidence[1]],
    findings: [{ kind: 'source-observation', category: 'constraint', statement: 'One selected Workspace was unavailable.', evidenceIds: ['E2'] }],
    alternatives: [{ name: 'Wait for access', consequence: 'Gather both sources before selecting work.', evidenceIds: ['E2'], uncertaintyIds: ['U1'] }],
    uncertainties: [{ id: 'U1', statement: 'The unavailable repository may change the assessment.', evidenceIds: ['E2'] }],
    recommendation: {
      disposition: 'NO_CHANGE',
      responsibility: null,
      rationale: 'The missing repository prevents a complete decision.',
      scope: 'within-activity',
      evidenceIds: ['E2'],
      uncertaintyIds: ['U1'],
    },
  })
  expect(incomplete.status).toBe('incomplete')
})
