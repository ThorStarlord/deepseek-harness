/**
 * Target-Session progress reporting for explicitly dispatched Activity responsibilities.
 * @module @deepseek-ai/dsh-command-home-activity/responsibility-status
 */

import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { SessionEventsPage, SessionPageRequest } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ActivityId } from '@deepseek-ai/dsh-home-activity'
import type { ActivityResponsibilityId } from '@deepseek-ai/dsh-home-activity/responsibility-types'
import { brandString } from '@deepseek-ai/dsh-brand'
import { z } from 'zod'
import type {} from '@deepseek-ai/dsh-home-activity/responsibilities'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'

const TOOL_NAME = 'report_activity_responsibility_status'

const OUTPUT = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
}

/** Register a target-only report tool that cannot dispatch or change responsibility decisions.
 * @param ctx - Application context with live Agent and Activity responsibility services.
 * @returns The tool-registration disposer.
 */
export function registerActivityResponsibilityStatusTool(ctx: Context): () => void {
  return ctx.tools.register(defineTool({
    name: TOOL_NAME,
    description: 'Append one bounded progress, waiting, ready, blocked, or failed report for an assignment already delivered to this exact DSH Session. Reports are self-reported and never mark work verified, accepted, or complete.',
    parameters: {
      activityId: { type: 'string', required: true, description: 'Exact Activity UUID from the assignment prompt.' },
      responsibilityId: { type: 'string', required: true, description: 'Exact responsibility UUID from the assignment prompt.' },
      status: { type: 'string', enum: ['progress', 'waiting', 'ready', 'blocked', 'failed'], required: true },
      summary: { type: 'string', required: true, description: 'One concise line of current progress or blocker; do not include secrets.' },
    },
    output: OUTPUT,
    async execute(args, exec) {
      const activityId = ActivityId(z.uuid().parse(args.activityId))
      const responsibilityId = brandString<ActivityResponsibilityId>(z.uuid().parse(args.responsibilityId))
      const agent = requireLiveAgent(ctx, exec)
      const sourceEventSeq = exec.sourceEventSeq
      if (sourceEventSeq === undefined || exec.parent !== undefined) {
        throw new Error('Activity progress reports require a directly logged call in the target DSH Session.')
      }
      exec.signal.throwIfAborted()
      const history = ctx.homeActivityResponsibilities.get(activityId, responsibilityId)
      const attempt = history?.facts.find(fact => fact.kind === 'dispatch-attempted')
      if (history === undefined || attempt === undefined) {
        throw new Error('No dispatched Activity responsibility matches this report.')
      }
      const matchingPrompt = await findDispatchedPrompt(
        ctx,
        agent.session.id,
        attempt.promptRequestId,
        sourceEventSeq,
        exec.callId,
        args,
        exec.signal,
      )
      if (!matchingPrompt) {
        throw new Error('The exact dispatched Activity prompt is not present before this report in the target Session.')
      }
      const report = await ctx.homeActivityResponsibilities.recordTargetStatusReport({
        activityId,
        responsibilityId,
        callerSessionId: agent.session.id,
        sourceEventSeq,
        status: args.status,
        summary: args.summary,
      })
      return `Saved target-reported ${report.status} for Activity responsibility ${report.responsibilityId}. This report is not independently verified, user-accepted, or a completion record.`
    },
  }), {
    when: ({ agent }) => ctx.agents.get(agent.id) === agent
      && agent.id === agent.session.id
      && ctx.homeActivityResponsibilities.hasReportableTargetSession(agent.session.id),
  })
}

async function findDispatchedPrompt(
  ctx: Context,
  sessionId: SessionId,
  promptRequestId: string,
  sourceEventSeq: number,
  callId: ToolRunContext['callId'],
  args: unknown,
  signal: AbortSignal,
): Promise<boolean> {
  let beforeSeq: number | undefined
  while (true) {
    signal.throwIfAborted()
    const request: SessionPageRequest = {
      address: { kind: 'session', sessionId },
      throughSeq: sourceEventSeq,
      ...(beforeSeq === undefined ? {} : { beforeSeq }),
    }
    const page: SessionEventsPage = await ctx.sessionController.events(request, signal)
    const events = page.records.map(record => record.event)
    if (beforeSeq === undefined) {
      const callEvent = events.find(event => event.seq === sourceEventSeq)
      if (callEvent?.type !== 'tool/call' || !isRecord(callEvent.data)
        || callEvent.data.name !== TOOL_NAME || callEvent.data.callId !== callId
        || typeof callEvent.data.arguments !== 'string' || !sameLoggedArguments(callEvent.data.arguments, args)) {
        throw new Error('This report is not bound to the current logged tool call.')
      }
    }
    if (events.some(event => event.type === 'user/message'
      && event.seq < sourceEventSeq && isDispatchedPrompt(event.data, promptRequestId))) return true
    const firstSeq = events[0]?.seq
    if (!page.hasMore || firstSeq === undefined) return false
    beforeSeq = firstSeq
  }
}

function isDispatchedPrompt(data: unknown, promptRequestId: string): boolean {
  if (!isRecord(data) || !isRecord(data.source)) return false
  return data.source.kind === 'user'
    && typeof data.source.rpcId === 'string'
        && data.source.rpcId === promptRequestId
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireLiveAgent(ctx: Context, exec: ToolRunContext): NonNullable<ToolRunContext['agent']> {
  const agent = exec.agent
  if (agent === undefined || ctx.agents.get(agent.id) !== agent || agent.id !== agent.session.id) {
    throw new Error('Activity progress reporting requires the live target DSH Agent.')
  }
  return agent
}

function sameLoggedArguments(raw: string, args: unknown): boolean {
  try {
    return isDeepStrictEqual(JSON.parse(raw), args)
  } catch (_error: unknown) {
    return false
  }
}
