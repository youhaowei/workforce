import { router, createCallerFactory } from '../trpc';
import { healthRouter } from './health';
import { sessionRouter } from './session';
import { orgRouter } from './org';
import { userRouter } from './user';
import { projectRouter } from './project';
import { templateRouter } from './template';
import { workflowRouter } from './workflow';
import { orchestrationRouter } from './orchestration';
import { reviewRouter } from './review';
import { auditRouter } from './audit';
import { worktreeRouter } from './worktree';
import { taskRouter } from './task';
import { agentRouter } from './agent';
import { eventsRouter } from './events';
import { dialogRouter } from './dialog';

export const appRouter = router({
  health: healthRouter,
  session: sessionRouter,
  org: orgRouter,
  user: userRouter,
  project: projectRouter,
  template: templateRouter,
  workflow: workflowRouter,
  orchestration: orchestrationRouter,
  review: reviewRouter,
  audit: auditRouter,
  worktree: worktreeRouter,
  task: taskRouter,
  agent: agentRouter,
  events: eventsRouter,
  dialog: dialogRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);

// Re-export for test cleanup
export { resetRouterServices } from './_services';
