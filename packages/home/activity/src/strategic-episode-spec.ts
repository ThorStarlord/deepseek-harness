/**
 * Versioned StorageDomain for append-only Activity Strategic Brief episodes.
 * @module @deepseek-ai/dsh-home-activity/strategic-episode-spec
 */

import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type {
  ActivityStrategicAlternative,
  ActivityStrategicEpisode,
  ActivityStrategicEpisodeId,
  ActivityStrategicEvidenceReference,
  ActivityStrategicFinding,
  ActivityStrategicRecommendation,
  ActivityStrategicRepositoryObservation,
  ActivityStrategicUncertainty,
} from './strategic-episode-types.ts'
import type { ActivityId } from './types.ts'

const episodeIdSchema = z.uuid().transform(value => brandString<ActivityStrategicEpisodeId>(value))
const activityIdSchema = z.uuid().transform(value => brandString<ActivityId>(value))
const workspaceIdSchema = z.uuid()
const revisionSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu)
const textSchema = z.string().trim().min(1).max(4_000)
const evidenceIdsSchema = z.array(z.string().regex(/^E[1-9][0-9]{0,2}$/u)).max(256)

/** Maximum saved strategic episodes per Activity. */
export const MAX_HOME_ACTIVITY_STRATEGIC_EPISODES_PER_ACTIVITY = 128
/** Maximum bytes in one model-authored brief before persistence. */
export const MAX_HOME_ACTIVITY_STRATEGIC_EPISODE_BYTES = 64 * 1024

const repositorySchema = z.object({
  workspaceId: workspaceIdSchema,
  title: textSchema.max(240),
  status: z.enum(['observed', 'unavailable']),
  revision: revisionSchema.nullable(),
  workingTree: z.enum(['clean', 'dirty', 'unknown']),
  sourceChanged: z.boolean().nullable(),
  observedAtStart: z.iso.datetime().nullable(),
  observedAtEnd: z.iso.datetime().nullable(),
}).strict().superRefine((value, context) => {
  if (value.status === 'observed' && value.revision === null) {
    context.addIssue({ code: 'custom', message: 'observed repositories require a Git revision' })
  }
  if (value.status === 'observed' && (value.observedAtStart === null || value.observedAtEnd === null)) {
    context.addIssue({ code: 'custom', message: 'observed repositories require observation times' })
  }
  if (value.status === 'observed' && value.observedAtStart !== null && value.observedAtEnd !== null
    && Date.parse(value.observedAtEnd) < Date.parse(value.observedAtStart)) {
    context.addIssue({ code: 'custom', message: 'repository observation times must be ordered' })
  }
  if (value.status === 'unavailable' && value.revision !== null) {
    context.addIssue({ code: 'custom', message: 'unavailable repositories cannot claim an observed revision' })
  }
  if (value.status === 'unavailable' && value.workingTree !== 'unknown') {
    context.addIssue({ code: 'custom', message: 'unavailable repositories cannot claim a working-tree state' })
  }
  if (value.status === 'unavailable' && (value.sourceChanged !== null || value.observedAtStart !== null || value.observedAtEnd !== null)) {
    context.addIssue({ code: 'custom', message: 'unavailable repositories cannot claim an observation' })
  }
}) satisfies z.ZodType<ActivityStrategicRepositoryObservation>

const evidenceSchema = z.object({
  id: z.string().regex(/^E[1-9][0-9]{0,2}$/u),
  workspaceId: workspaceIdSchema,
  revision: revisionSchema,
  path: z.string().min(1).max(512).regex(/^(?!\/)(?![A-Za-z]:)[^\\\0]+$/u),
  lineStart: z.number().int().positive().max(10_000_000).optional(),
  lineEnd: z.number().int().positive().max(10_000_000).optional(),
  note: textSchema.max(1_000),
}).strict().superRefine((value, context) => {
  if (value.path.split('/').some(part => part === '..' || part === '.')) {
    context.addIssue({ code: 'custom', message: 'source paths must stay repository-relative' })
  }
  if (value.lineStart !== undefined && value.lineEnd !== undefined && value.lineEnd < value.lineStart) {
    context.addIssue({ code: 'custom', message: 'source line range must be ordered' })
  }
}) satisfies z.ZodType<ActivityStrategicEvidenceReference>

const findingSchema = z.object({
  kind: z.enum(['source-observation', 'source-claim', 'interpretation', 'hypothesis']),
  category: z.enum(['capability', 'constraint', 'ownership', 'opportunity']),
  statement: textSchema,
  evidenceIds: evidenceIdsSchema,
}).strict() satisfies z.ZodType<ActivityStrategicFinding>

const alternativeSchema = z.object({
  name: textSchema.max(240),
  consequence: textSchema,
  evidenceIds: evidenceIdsSchema,
  uncertaintyIds: z.array(z.string().regex(/^U[1-9][0-9]{0,2}$/u)).max(256),
}).strict() satisfies z.ZodType<ActivityStrategicAlternative>

const uncertaintySchema = z.object({
  id: z.string().regex(/^U[1-9][0-9]{0,2}$/u),
  statement: textSchema,
  evidenceIds: evidenceIdsSchema,
}).strict() satisfies z.ZodType<ActivityStrategicUncertainty>

const recommendationSchema = z.object({
  disposition: z.enum(['BUILD', 'INVESTIGATE', 'DEFER', 'NO_CHANGE', 'OWNER_DECISION', 'THESIS_REVIEW']),
  responsibility: textSchema.nullable(),
  rationale: textSchema,
  scope: z.enum(['within-activity', 'owner-decision', 'outside-activity']),
  evidenceIds: evidenceIdsSchema,
  uncertaintyIds: z.array(z.string().regex(/^U[1-9][0-9]{0,2}$/u)).max(256),
}).strict().superRefine((value, context) => {
  if (value.disposition === 'NO_CHANGE' && value.responsibility !== null) {
    context.addIssue({ code: 'custom', message: 'NO_CHANGE cannot select a responsibility' })
  }
  if (value.disposition !== 'NO_CHANGE' && value.responsibility === null) {
    context.addIssue({ code: 'custom', message: 'a selected disposition requires a responsibility' })
  }
}) satisfies z.ZodType<ActivityStrategicRecommendation>

const skillDigestSchema = z.object({
  name: z.enum(['using-sensemaking', 'multi-repository-strategic-analysis']),
  provider: z.string().trim().min(1).max(100),
  digest: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict()

/** Strict durable record; changed fields require a versioned successor domain. */
export const activityStrategicEpisodeRecordSchema = z.object({
  id: episodeIdSchema,
  activityId: activityIdSchema,
  revision: z.number().int().positive().max(MAX_HOME_ACTIVITY_STRATEGIC_EPISODES_PER_ACTIVITY),
  supersedes: episodeIdSchema.optional(),
  originSessionId: z.string().min(1).max(200),
  producer: z.literal('dsh-active-agent'),
  requestId: z.uuid(),
  objective: textSchema,
  status: z.enum(['complete', 'incomplete']),
  repositories: z.array(repositorySchema).length(2),
  skillDigests: z.array(skillDigestSchema).length(2),
  evidence: z.array(evidenceSchema).max(256),
  findings: z.array(findingSchema).max(256),
  alternatives: z.array(alternativeSchema).max(32),
  uncertainties: z.array(uncertaintySchema).max(256),
  recommendation: recommendationSchema,
  requestedAt: z.iso.datetime(),
  recordedAt: z.iso.datetime(),
}).strict().superRefine((episode, context) => {
  const workspaceIds = new Set(episode.repositories.map(repository => repository.workspaceId))
  if (workspaceIds.size !== 2) context.addIssue({ code: 'custom', message: 'the two selected repositories must be distinct' })
  if (new Set(episode.skillDigests.map(skill => skill.name)).size !== 2) {
    context.addIssue({ code: 'custom', message: 'the two Sensemaking Skill digests must be distinct' })
  }
  const evidenceIds = new Set(episode.evidence.map(item => item.id))
  const uncertaintyIds = new Set(episode.uncertainties.map(item => item.id))
  if (evidenceIds.size !== episode.evidence.length) context.addIssue({ code: 'custom', message: 'evidence ids must be unique' })
  if (uncertaintyIds.size !== episode.uncertainties.length) context.addIssue({ code: 'custom', message: 'uncertainty ids must be unique' })
  for (const item of episode.evidence) {
    const repository = episode.repositories.find(row => row.workspaceId === item.workspaceId)
    if (repository?.status !== 'observed' || repository.revision !== item.revision) {
      context.addIssue({ code: 'custom', message: 'evidence must cite the observed revision of a selected repository' })
    }
  }
  for (const id of [
    ...episode.findings.flatMap(item => item.evidenceIds),
    ...episode.alternatives.flatMap(item => item.evidenceIds),
    ...episode.uncertainties.flatMap(item => item.evidenceIds),
    ...episode.recommendation.evidenceIds,
  ]) {
    if (!evidenceIds.has(id)) context.addIssue({ code: 'custom', message: `unknown evidence reference ${id}` })
  }
  for (const id of [
    ...episode.alternatives.flatMap(item => item.uncertaintyIds),
    ...episode.recommendation.uncertaintyIds,
  ]) {
    if (!uncertaintyIds.has(id)) context.addIssue({ code: 'custom', message: `unknown uncertainty reference ${id}` })
  }
  if (episode.repositories.some(repository => repository.status === 'unavailable') && episode.status !== 'incomplete') {
    context.addIssue({ code: 'custom', message: 'an unavailable selected repository makes the brief incomplete' })
  }
  if (episode.repositories.some(repository => repository.status !== 'observed'
    || repository.workingTree !== 'clean' || repository.sourceChanged !== false)
    && episode.status !== 'incomplete') {
    context.addIssue({ code: 'custom', message: 'a brief with unavailable, dirty, or unstable repository observations must remain incomplete' })
  }
}) satisfies z.ZodType<ActivityStrategicEpisode>

/** Validates agent-authored report content before DSH adds trusted episode metadata. */
export const recordActivityStrategicEpisodeRequestSchema = z.object({
  status: z.enum(['complete', 'incomplete']),
  repositories: z.array(repositorySchema).length(2),
  evidence: z.array(evidenceSchema).max(256),
  findings: z.array(findingSchema).max(256),
  alternatives: z.array(alternativeSchema).max(32),
  uncertainties: z.array(uncertaintySchema).max(256),
  recommendation: recommendationSchema,
}).strict().superRefine((request, context) => {
  const evidenceIds = new Set(request.evidence.map(item => item.id))
  const uncertaintyIds = new Set(request.uncertainties.map(item => item.id))
  if (evidenceIds.size !== request.evidence.length) context.addIssue({ code: 'custom', message: 'evidence ids must be unique' })
  if (uncertaintyIds.size !== request.uncertainties.length) context.addIssue({ code: 'custom', message: 'uncertainty ids must be unique' })
  for (const id of [
    ...request.findings.flatMap(item => item.evidenceIds),
    ...request.alternatives.flatMap(item => item.evidenceIds),
    ...request.uncertainties.flatMap(item => item.evidenceIds),
    ...request.recommendation.evidenceIds,
  ]) {
    if (!evidenceIds.has(id)) context.addIssue({ code: 'custom', message: `unknown evidence reference ${id}` })
  }
  for (const id of [
    ...request.alternatives.flatMap(item => item.uncertaintyIds),
    ...request.recommendation.uncertaintyIds,
  ]) {
    if (!uncertaintyIds.has(id)) context.addIssue({ code: 'custom', message: `unknown uncertainty reference ${id}` })
  }
  const workspaceIds = new Set(request.repositories.map(repository => repository.workspaceId))
  if (workspaceIds.size !== 2) context.addIssue({ code: 'custom', message: 'the two selected repositories must be distinct' })
  for (const reference of request.evidence) {
    const repository = request.repositories.find(row => row.workspaceId === reference.workspaceId)
    if (repository?.status !== 'observed' || repository.revision !== reference.revision) {
      context.addIssue({ code: 'custom', message: 'evidence must cite the observed revision of a selected repository' })
    }
  }
  if (request.repositories.some(repository => repository.status === 'unavailable') && request.status !== 'incomplete') {
    context.addIssue({ code: 'custom', message: 'an unavailable selected repository makes the brief incomplete' })
  }
  if (request.repositories.some(repository => repository.status !== 'observed'
    || repository.workingTree !== 'clean' || repository.sourceChanged !== false)
    && request.status !== 'incomplete') {
    context.addIssue({ code: 'custom', message: 'a brief with unavailable, dirty, or unstable repository observations must remain incomplete' })
  }
  if (request.status === 'complete' && (request.evidence.length === 0 || request.findings.length === 0 || request.alternatives.length < 2)) {
    context.addIssue({ code: 'custom', message: 'a complete brief requires source evidence, findings, and at least two alternatives' })
  }
})

/** The additive version-one Activity Strategic Brief domain. */
export const homeActivityStrategicEpisodesDomain = defineDomain({
  name: 'home_activity_strategic_episodes',
  version: 1,
  tables: {
    episodes: domainTable<ActivityStrategicEpisodeId, ActivityStrategicEpisode>(activityStrategicEpisodeRecordSchema),
  },
})
