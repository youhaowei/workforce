import { router, createCallerFactory } from '../trpc';
import { healthRouter } from './health';
import { sessionRouter } from './session';
import { orgRouter } from './org';
import { templateRouter } from './template';
import { workflowRouter } from './workflow';
import { orchestrationRouter } from './orchestration';
import { reviewRouter } from './review';
import { auditRouter } from './audit';
import { worktreeRouter } from './worktree';
import { taskRouter } from './task';
import { agentRouter } from './agent';
import { eventsRouter } from './events';

export const appRouter = router({
  health: healthRouter,
  session: sessionRouter,
  org: orgRouter,
  template: templateRouter,
  workflow: workflowRouter,
  orchestration: orchestrationRouter,
  review: reviewRouter,
  audit: auditRouter,
  worktree: worktreeRouter,
  task: taskRouter,
  agent: agentRouter,
  events: eventsRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);

// Re-export for test cleanup
export { resetRouterServices } from './_services';
