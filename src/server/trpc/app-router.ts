import { t } from './core';
import { workspaceRouter } from './routers/workspace';
import { sessionsRouter } from './routers/sessions';
import { todosRouter } from './routers/todos';
import { agentTemplatesRouter } from './routers/agentTemplates';
import { workflowTemplatesRouter } from './routers/workflowTemplates';
import { workagentsRouter } from './routers/workagents';
import { reviewsRouter } from './routers/reviews';
import { boardRouter } from './routers/board';
import { outputsRouter } from './routers/outputs';
import { historyRouter } from './routers/history';
import { formDefinitionsRouter } from './routers/formDefinitions';
import { streamRouter } from './routers/stream';

export const appRouter = t.router({
  workspace: workspaceRouter,
  sessions: sessionsRouter,
  todos: todosRouter,
  agentTemplates: agentTemplatesRouter,
  workflowTemplates: workflowTemplatesRouter,
  workagents: workagentsRouter,
  reviews: reviewsRouter,
  board: boardRouter,
  outputs: outputsRouter,
  history: historyRouter,
  formDefinitions: formDefinitionsRouter,
  stream: streamRouter,
});

export type AppRouter = typeof appRouter;
