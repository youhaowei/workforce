import { trpcClient } from '@bridge/index';
import type { WorkAgentState } from '@services/types';

export type SessionListItem = Awaited<ReturnType<typeof trpcClient.sessions.list.query>>[number];
export type SessionDetail = Awaited<ReturnType<typeof trpcClient.sessions.get.query>>;
export type TodoItem = Awaited<ReturnType<typeof trpcClient.todos.list.query>>[number];
export type AgentTemplate = Awaited<ReturnType<typeof trpcClient.agentTemplates.list.query>>[number];
export type WorkflowTemplate = Awaited<ReturnType<typeof trpcClient.workflowTemplates.list.query>>[number];
export type WorkAgent = Awaited<ReturnType<typeof trpcClient.workagents.list.query>>[number];
export type ReviewItem = Awaited<ReturnType<typeof trpcClient.reviews.list.query>>[number];
export type OutputItem = Awaited<ReturnType<typeof trpcClient.outputs.list.query>>[number];
export type EventItem = Awaited<ReturnType<typeof trpcClient.history.list.query>>[number];

export interface BoardData {
  counts: Record<WorkAgentState, number>;
  lanes: Record<WorkAgentState, WorkAgent[]>;
}
