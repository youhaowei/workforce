/**
 * Service Layer Index
 *
 * Re-exports all services with lazy singleton getters.
 * Services are only instantiated when first accessed.
 */

// Type exports
export type {
  // Common
  Disposable,
  Result,
  StreamResult,
  // Agent
  AgentService,
  QueryOptions,
  TokenDelta,
  ToolCall,
  ToolResult,
  AgentResponse,
  // Session
  SessionService,
  Session,
  Message,
  SessionSearchResult,
  // Tool
  ToolService,
  ToolHandler,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
  // Orchestrator
  OrchestratorService,
  AgentProfile,
  RoutingDecision,
  // Skill
  SkillService,
  Skill,
  // Hook
  HookService,
  PreHook,
  PostHook,
  HookContext,
  PreHookResult,
  PostHookResult,
  // Background
  BackgroundService,
  BackgroundTask,
  BackgroundTaskOptions,
  TaskPriority,
  TaskStatus,
  // Todo
  TodoService,
  Todo,
  TodoFilter,
  TodoStatus,
  Workspace,
  AgentTemplate,
  WorkflowTemplate,
  WorkflowStep,
  WorkflowExecutionService,
  WorkflowExecutionResult,
  WorkAgentSession,
  WorkAgentState,
  WorkAgentOrchestrationService,
  AggregateProgress,
  ReviewItem,
  ReviewAction,
  ReviewStatus,
  WorkOutput,
  WorkOutputDecision,
  WorkOutputStatus,
  WorktreeStatus,
  WorktreeInfo,
  WorktreeService,
  SessionEvent,
  FieldWidgetType,
  UiSchema,
  FormDefinition,
} from './types';

// Service getters (lazy singletons)
import { getAgentService, resetAgentService } from './agent';
import { getSessionService, resetSessionService } from './session';
import { getToolService, resetToolService } from './tool';
import { getOrchestratorService, resetOrchestratorService } from './orchestrator';
import { getSkillService, resetSkillService } from './skill';
import { getHookService, resetHookService } from './hook';
import { getBackgroundService, resetBackgroundService } from './background';
import { getTodoService, resetTodoService } from './todo';
import { getWorkspaceService, resetWorkspaceService } from './workspace';
import { getDomainService, resetDomainService } from './domain';
import {
  getWorkAgentOrchestrationService,
  resetWorkAgentOrchestrationService,
} from './orchestration';
import {
  getWorkflowExecutionService,
  resetWorkflowExecutionService,
} from './workflow-execution';
import { getWorktreeService, resetWorktreeService } from './worktree';
import { getFormDefinitionService, resetFormDefinitionService } from './form-definition';
import { getStorageAdapter, setStorageAdapter } from './storage';

export {
  getAgentService,
  resetAgentService,
  getSessionService,
  resetSessionService,
  getToolService,
  resetToolService,
  getOrchestratorService,
  resetOrchestratorService,
  getSkillService,
  resetSkillService,
  getHookService,
  resetHookService,
  getBackgroundService,
  resetBackgroundService,
  getTodoService,
  resetTodoService,
  getWorkspaceService,
  resetWorkspaceService,
  getDomainService,
  resetDomainService,
  getWorkAgentOrchestrationService,
  resetWorkAgentOrchestrationService,
  getWorkflowExecutionService,
  resetWorkflowExecutionService,
  getWorktreeService,
  resetWorktreeService,
  getFormDefinitionService,
  resetFormDefinitionService,
  getStorageAdapter,
  setStorageAdapter,
};

/**
 * Dispose all services and reset singletons.
 * Useful for cleanup in tests or application shutdown.
 */
export function disposeAllServices(): void {
  resetAgentService();
  resetSessionService();
  resetToolService();
  resetOrchestratorService();
  resetSkillService();
  resetHookService();
  resetBackgroundService();
  resetTodoService();
  resetWorkspaceService();
  resetDomainService();
  resetWorkAgentOrchestrationService();
  resetWorkflowExecutionService();
  resetWorktreeService();
  resetFormDefinitionService();
}
