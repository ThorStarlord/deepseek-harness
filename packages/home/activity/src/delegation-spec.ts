/** Strict durable record format for Home Activity delegation facts. @module @deepseek-ai/dsh-home-activity/delegation-spec */

import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentRunId } from '@deepseek-ai/dsh-subagent'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { ActivityDelegation, ActivityDelegationId } from './delegation-types.ts'
import type { ActivityId } from './types.ts'

const activityIdSchema = z.uuid().transform(value => brandString<ActivityId>(value))
const delegationIdSchema = z.uuid().transform(value => brandString<ActivityDelegationId>(value))
const sessionIdSchema = z.string().min(1).max(256).transform(value => brandString<SessionId>(value))
const runIdSchema = z.string().min(1).max(256).transform(value => brandString<SubagentRunId>(value))
const requestSchema = z.object({
  provider: z.literal('spawn'),
  task: z.string().trim().min(1).max(4_096)
    .refine(value => Buffer.byteLength(value, 'utf8') <= 4_096, 'task exceeds 4096 UTF-8 bytes'),
  parentSessionId: sessionIdSchema,
  requestedAt: z.iso.datetime(),
  source: z.literal('user-command'),
}).strict()
const admissionSchema = z.object({
  childSessionId: sessionIdSchema,
  activationName: z.string().min(1).max(128),
  runId: runIdSchema.optional(),
  admittedAt: z.iso.datetime(),
  source: z.literal('subagents.startActivation'),
}).strict()
const reportSchema = z.object({
  stopReason: z.string().min(1).max(128),
  outputText: z.string().max(16_384)
    .refine(value => Buffer.byteLength(value, 'utf8') <= 16_384, 'reported output exceeds 16384 UTF-8 bytes'),
  nonTextBlockTypes: z.array(z.string().min(1).max(64)).max(32),
  outputTruncated: z.boolean(),
  diagnostic: z.string().max(4_096)
    .refine(value => Buffer.byteLength(value, 'utf8') <= 4_096, 'diagnostic exceeds 4096 UTF-8 bytes').optional(),
  reportedAt: z.iso.datetime(),
  source: z.literal('subagent-activation-result'),
}).strict()
const failureSchema = z.object({
  message: z.string().min(1).max(512),
  source: z.literal('subagents.startActivation'),
}).strict()
const uncertaintySchema = z.object({
  reason: z.enum([
    'restart-before-admission-recorded',
    'restart-before-report-recorded',
    'admission-write-failed',
    'report-write-failed',
    'startup-result-rejected',
  ]),
  observedAt: z.iso.datetime(),
}).strict()

/** Validated persisted delegation record; lifecycle facts are separately sourced. */
export const activityDelegationRecordSchema = z.object({
  id: delegationIdSchema,
  activityId: activityIdSchema,
  request: requestSchema,
  status: z.enum(['requested', 'not-admitted', 'admitted', 'reported', 'unconfirmed']),
  admission: admissionSchema.optional(),
  report: reportSchema.optional(),
  failure: failureSchema.optional(),
  uncertainty: uncertaintySchema.optional(),
}).strict().superRefine((record, context) => {
  const hasAdmission = record.admission !== undefined
  const hasReport = record.report !== undefined
  const hasFailure = record.failure !== undefined
  const hasUncertainty = record.uncertainty !== undefined
  const valid = record.status === 'requested'
    ? !hasAdmission && !hasReport && !hasFailure && !hasUncertainty
    : record.status === 'not-admitted'
      ? !hasAdmission && !hasReport && hasFailure && !hasUncertainty
      : record.status === 'admitted'
        ? hasAdmission && !hasReport && !hasFailure && !hasUncertainty
        : record.status === 'reported'
          ? hasAdmission && hasReport && !hasFailure && !hasUncertainty
          : !hasReport && !hasFailure && hasUncertainty
  if (!valid) context.addIssue({ code: 'custom', message: 'delegation status does not match its recorded facts' })
})

/** The independently versioned sidecar for DSH-native Activity delegations. */
export const homeActivityDelegationDomain = defineDomain({
  name: 'home_activity_delegations',
  version: 1,
  tables: { delegations: domainTable<ActivityDelegation['id'], ActivityDelegation>(activityDelegationRecordSchema) },
})
