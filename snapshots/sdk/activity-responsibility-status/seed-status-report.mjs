// Synthetic fixture facts exercise replay attribution; they are not evidence of authenticated dispatch.
export const name = 'activity-responsibility-status-seed'
export const inject = ['storageDomain', 'homeActivities', 'homeActivityResponsibilities', 'agents', 'tools']

const ACTIVITY_ID = '15000000-0000-4000-8000-000000000001'
const RESPONSIBILITY_ID = '15000000-0000-4000-8000-000000000002'
const PROPOSAL_ID = '15000000-0000-4000-8000-000000000003'
const CONFIRMATION_ID = '15000000-0000-4000-8000-000000000004'
const PROMPT_REQUEST_ID = '15000000-0000-4000-8000-000000000005'
const SETTLEMENT_ID = '15000000-0000-4000-8000-000000000006'
const WORKSPACE_ID = '15000000-0000-4000-8000-000000000007'
const COORDINATOR_SESSION_ID = 'activity-status-coordinator'
const TARGET_SESSION_ID = 'fixture-root-session'
const RECORDED_AT = '2026-11-24T12:00:00.000Z'

export async function apply(ctx) {
  const activities = ctx.storageDomain.get('home_activities')
  const responsibilities = ctx.storageDomain.get('home_activity_responsibilities')
  if (activities === undefined || responsibilities === undefined) {
    throw new Error('Activity status snapshot requires the shipped Activity services')
  }

  await activities.table('activities').put(ACTIVITY_ID, {
    id: ACTIVITY_ID,
    name: 'Snapshot status report',
    objective: 'Record a target Session progress update without inferring task completion.',
    boundaries: { inScope: ['Report current progress.'], outOfScope: ['Do not claim verification or acceptance.'] },
    createdAt: RECORDED_AT,
  })

  const proposal = {
    target: { workspaceId: WORKSPACE_ID, sessionId: TARGET_SESSION_ID },
    task: 'Inspect the selected fixture and report the current progress.',
    inScope: ['Read the selected fixture.'],
    outOfScope: ['Do not change files or claim verification.'],
    expectedOutcome: 'One attributed progress update.',
    prerequisites: [],
    conflictingWork: [],
  }
  const facts = responsibilities.table('facts')
  await facts.put(PROPOSAL_ID, {
    id: PROPOSAL_ID,
    responsibilityId: RESPONSIBILITY_ID,
    activityId: ACTIVITY_ID,
    revision: 1,
    requestId: PROPOSAL_ID,
    recordedAt: RECORDED_AT,
    kind: 'proposed',
    proposal,
    source: { kind: 'coordinating-session', sessionId: COORDINATOR_SESSION_ID, eventSeq: 9 },
  })
  await facts.put(CONFIRMATION_ID, {
    id: CONFIRMATION_ID,
    responsibilityId: RESPONSIBILITY_ID,
    activityId: ACTIVITY_ID,
    revision: 2,
    previousFactId: PROPOSAL_ID,
    requestId: CONFIRMATION_ID,
    recordedAt: RECORDED_AT,
    kind: 'confirmed',
    proposalFactId: PROPOSAL_ID,
    proposal,
    actor: { kind: 'authenticated-user', principal: { kind: 'owner' } },
  })
  await facts.put(PROMPT_REQUEST_ID, {
    id: PROMPT_REQUEST_ID,
    responsibilityId: RESPONSIBILITY_ID,
    activityId: ACTIVITY_ID,
    revision: 3,
    previousFactId: CONFIRMATION_ID,
    requestId: PROMPT_REQUEST_ID,
    recordedAt: RECORDED_AT,
    kind: 'dispatch-attempted',
    promptRequestId: PROMPT_REQUEST_ID,
    targetSessionId: TARGET_SESSION_ID,
    source: 'session-controller.prompt',
  })
  await facts.put(SETTLEMENT_ID, {
    id: SETTLEMENT_ID,
    responsibilityId: RESPONSIBILITY_ID,
    activityId: ACTIVITY_ID,
    revision: 4,
    previousFactId: PROMPT_REQUEST_ID,
    requestId: SETTLEMENT_ID,
    recordedAt: RECORDED_AT,
    kind: 'dispatch-settled',
    promptRequestId: PROMPT_REQUEST_ID,
    targetSessionId: TARGET_SESSION_ID,
    outcome: 'accepted',
    source: 'session-controller.prompt',
  })

  if (!ctx.homeActivityResponsibilities.hasReportableTargetSession(TARGET_SESSION_ID)) {
    throw new Error('The seeded target Session is not eligible for Activity status reporting')
  }

  ctx.on('agent/created', ({ agent }) => {
    if (String(agent.session.id) !== TARGET_SESSION_ID) return
    agent.inbox.append('next-turn', {
      role: 'user',
      id: 'activity-status-dispatched-prompt',
      content: [{
        type: 'text',
        text: [
          'Activity: Snapshot status report',
          `Activity ID: ${ACTIVITY_ID}`,
          `Responsibility ID: ${RESPONSIBILITY_ID}`,
          'Objective: Record a target Session progress update without inferring task completion.',
          'Task: Inspect the selected fixture and report the current progress.',
          'Scope: Read the selected fixture.',
          'Out of scope: Do not change files or claim verification.',
          'Prerequisites: None recorded.',
          'Conflicting work to account for: None recorded.',
          'Expected outcome: One attributed progress update.',
          'Use this Session’s existing runtime, permissions, and repository context. Do not expand the task or change permissions. Do not commit, merge, deploy, publish, or release unless that exact action is separately authorized in this Session. For meaningful milestones or blockers, call report_activity_responsibility_status with these exact IDs and a concise one-line status. A status report is only your report; do not label work independently verified, user-accepted, or complete. Continue with the task and provide a final outcome when the turn finishes.',
        ].join('\n'),
      }],
      source: { kind: 'user', rpcId: PROMPT_REQUEST_ID },
    })
    if (agent.id !== agent.session.id || ctx.agents.get(agent.id) !== agent
      || !ctx.homeActivityResponsibilities.hasReportableTargetSession(agent.session.id)
      || ctx.tools.get('report_activity_responsibility_status', agent) === undefined) {
      throw new Error('The eligible SDK root Agent cannot use the Activity status-report tool')
    }
  })
}
