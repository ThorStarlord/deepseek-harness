/** Structured, append-only strategic assessments for Home Activities. @module @deepseek-ai/dsh-home-activity/strategic-episode-types */

import type { ActivityId } from './types.ts'
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable id assigned to one saved Activity Strategic Brief. */
export type ActivityStrategicEpisodeId = Branded<'ActivityStrategicEpisodeId'>

/** User-selected repository observation recorded with an assessment. */
export interface ActivityStrategicRepositoryObservation {
  readonly workspaceId: string
  readonly title: string
  readonly status: 'observed' | 'unavailable'
  readonly revision: string | null
  readonly workingTree: 'clean' | 'dirty' | 'unknown'
  readonly sourceChanged: boolean | null
  readonly observedAtStart: string | null
  readonly observedAtEnd: string | null
}

/** Exact, content-free source locator cited by a finding. */
export interface ActivityStrategicEvidenceReference {
  readonly id: string
  readonly workspaceId: string
  readonly revision: string
  readonly path: string
  readonly lineStart?: number | undefined
  readonly lineEnd?: number | undefined
  readonly note: string
}

/** Classification for an agent-authored finding. */
export type ActivityStrategicFindingKind = 'source-observation' | 'source-claim' | 'interpretation' | 'hypothesis'

/** Concise strategic finding with references to selected repository sources. */
export interface ActivityStrategicFinding {
  readonly kind: ActivityStrategicFindingKind
  readonly category: 'capability' | 'constraint' | 'ownership' | 'opportunity'
  readonly statement: string
  readonly evidenceIds: readonly string[]
}

/** Alternative development direction and its likely consequence. */
export interface ActivityStrategicAlternative {
  readonly name: string
  readonly consequence: string
  readonly evidenceIds: readonly string[]
  readonly uncertaintyIds: readonly string[]
}

/** Open uncertainty that could change the strategic judgment. */
export interface ActivityStrategicUncertainty {
  readonly id: string
  readonly statement: string
  readonly evidenceIds: readonly string[]
}

/** Recommendation or explicit no-selection, kept separate from execution authority. */
export interface ActivityStrategicRecommendation {
  readonly disposition: 'BUILD' | 'INVESTIGATE' | 'DEFER' | 'NO_CHANGE' | 'OWNER_DECISION' | 'THESIS_REVIEW'
  readonly responsibility: string | null
  readonly rationale: string
  readonly scope: 'within-activity' | 'owner-decision' | 'outside-activity'
  readonly evidenceIds: readonly string[]
  readonly uncertaintyIds: readonly string[]
}

/** Durable Activity Strategic Brief, preserving authorship and source observations. */
export interface ActivityStrategicEpisode {
  readonly id: ActivityStrategicEpisodeId
  readonly activityId: ActivityId
  readonly revision: number
  readonly supersedes?: ActivityStrategicEpisodeId | undefined
  readonly originSessionId: string
  readonly producer: 'dsh-active-agent'
  readonly requestId: string
  readonly objective: string
  readonly status: 'complete' | 'incomplete'
  readonly repositories: readonly ActivityStrategicRepositoryObservation[]
  readonly skillDigests: readonly { readonly name: string; readonly provider: string; readonly digest: string }[]
  readonly evidence: readonly ActivityStrategicEvidenceReference[]
  readonly findings: readonly ActivityStrategicFinding[]
  readonly alternatives: readonly ActivityStrategicAlternative[]
  readonly uncertainties: readonly ActivityStrategicUncertainty[]
  readonly recommendation: ActivityStrategicRecommendation
  readonly requestedAt: string
  readonly recordedAt: string
}

/** Model-authored fields accepted after an explicit Activity assessment request. */
export type RecordActivityStrategicEpisodeRequest = Omit<
  ActivityStrategicEpisode,
  'id' | 'revision' | 'supersedes' | 'activityId' | 'originSessionId' | 'producer' | 'skillDigests' | 'recordedAt' | 'objective'
> & {
  readonly activityId: ActivityId
  readonly originSessionId: string
  readonly requestId: string
  readonly skillDigests: ActivityStrategicEpisode['skillDigests']
}
