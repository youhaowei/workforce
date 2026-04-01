/**
 * Centralized lazy-init service factories for tRPC routers.
 *
 * Avoids circular imports between routers that need each other's services
 * (e.g., workflow ↔ orchestration).
 */

import { createOrchestrationService } from "@/services/orchestration";
import { createWorkflowService } from "@/services/workflow";
import { createReviewService } from "@/services/review";
import { createAuditService } from "@/services/audit";
import { getSessionService } from "@/services/session";
import { getTemplateService } from "@/services/template";
import { getWorktreeService } from "@/services/worktree";
import { getOrgService } from "@/services/org";

let _workflowService: ReturnType<typeof createWorkflowService> | null = null;
export function getWorkflowService() {
  return (_workflowService ??= createWorkflowService());
}

let _orchestrationService: ReturnType<typeof createOrchestrationService> | null = null;
export function getOrchestrationService() {
  if (!_orchestrationService) {
    _orchestrationService = createOrchestrationService(
      getSessionService(),
      getTemplateService(),
      getWorktreeService(),
      getWorkflowService(),
      getOrgService(),
      getReviewService(),
    );
  }
  return _orchestrationService;
}

let _reviewService: ReturnType<typeof createReviewService> | null = null;
export function getReviewService() {
  return (_reviewService ??= createReviewService());
}

let _auditService: ReturnType<typeof createAuditService> | null = null;
export function getAuditService() {
  return (_auditService ??= createAuditService());
}

/**
 * Reset all cached factory services.
 * Called by disposeAllServices() for clean test teardown.
 */
export function resetRouterServices(): void {
  _orchestrationService?.dispose();
  _orchestrationService = null;
  _workflowService?.dispose();
  _workflowService = null;
  _reviewService?.dispose();
  _reviewService = null;
  _auditService?.dispose();
  _auditService = null;
}
