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
  AgentTone,
  VerboseLevel,
  AgentDefaults,
  AgentService,
  RunOptions,
  AgentStreamEvent,
  ToolActivity,
  ToolCall,
  ToolResult,
  AgentResponse,
  // Session
  SessionService,
  Session,
  Message,
  SessionSearchResult,
  SessionType,
  LifecycleState,
  HydrationStatus,
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
  BackgroundTaskPriority,
  BackgroundTaskStatus,
  // Task
  TaskService,
  Task,
  TaskFilter,
  TaskStatus,
  // Org
  Org,
  OrgSettings,
  OrgService,
  // User
  User,
  UserService,
  // Project
  Project,
  ProjectNotFound,
  ProjectService,
  // Template
  AgentTemplate,
  TemplateValidation,
  TemplateService,
  // Worktree
  WorktreeInfo,
  WorktreeService,
  // Workflow
  WorkflowTemplate,
  WorkflowStep,
  WorkflowService,
  // Review
  ReviewItem,
  ReviewAction,
  ReviewService,
  // Audit
  AuditEntry,
  AuditEntryType,
  AuditService,
} from "./types";

// Service getters (lazy singletons)
import { getAgentService, resetAgentService } from "./agent";
import { getSessionService, resetSessionService } from "./session";
import { getToolService, resetToolService } from "./tool";
import { getOrchestratorService, resetOrchestratorService } from "./orchestrator";
import { getSkillService, resetSkillService } from "./skill";
import { getHookService, resetHookService } from "./hook";
import { getBackgroundService, resetBackgroundService } from "./background";
import { getTaskService, resetTaskService } from "./task";
import { getOrgService, resetOrgService } from "./org";
import { getUserService, resetUserService } from "./user";
import { getProjectService, resetProjectService } from "./project";
import { getTemplateService, resetTemplateService } from "./template";
import { getWorktreeService, resetWorktreeService } from "./worktree";
import { getArtifactService, resetArtifactService } from "./artifact";

// Factory functions (for services that require composition)
import { createOrchestrationService } from "./orchestration";
import { createWorkflowService } from "./workflow";
import { createReviewService } from "./review";
import { createAuditService } from "./audit";

// Router-level factory-cached services (orchestration, workflow, review, audit)
import { resetRouterServices } from "../server/routers/_services";

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
  getTaskService,
  resetTaskService,
  getOrgService,
  resetOrgService,
  getUserService,
  resetUserService,
  getProjectService,
  resetProjectService,
  getTemplateService,
  resetTemplateService,
  getWorktreeService,
  resetWorktreeService,
  getArtifactService,
  resetArtifactService,
  createOrchestrationService,
  createWorkflowService,
  createReviewService,
  createAuditService,
};

/**
 * Dispose all services and reset singletons.
 * Useful for cleanup in tests or application shutdown.
 */
export function disposeAllServices(): void {
  resetRouterServices(); // dispose factory-cached router services first (orchestration, workflow, review, audit)
  resetAgentService();
  resetSessionService();
  resetToolService();
  resetOrchestratorService();
  resetSkillService();
  resetHookService();
  resetBackgroundService();
  resetTaskService();
  resetOrgService();
  resetUserService();
  resetProjectService();
  resetTemplateService();
  resetWorktreeService();
  resetArtifactService();
}
