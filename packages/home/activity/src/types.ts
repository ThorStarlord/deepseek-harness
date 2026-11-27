/** Host Home Activity context service declarations. @module @deepseek-ai/dsh-home-activity/types */

export type { Activity, ActivityBoundaries, ActivityId, CreateActivityRequest } from './activity-types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Durable user-directed Activities, independent of Session lifecycle. */
    homeActivities: import('./index.ts').HomeActivityService
    /** Separately persisted Home Activity delegation facts. */
    homeActivityDelegations: import('./delegations.ts').HomeActivityDelegationService
  }
}
