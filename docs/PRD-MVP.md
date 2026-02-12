# Workforce MVP - Product Requirements Document

_Last updated: February 9, 2026_
_Status: Draft (requirements-focused)_

---

## 1. Purpose

This PRD defines **what the Workforce MVP must deliver** for end users.
It intentionally avoids prescribing internal technical implementation details.

---

## 2. Product Summary

Workforce is a desktop product for running AI agents as coordinated teams.

Core user promise:
- Define reusable agents and workflows
- Execute one or many agents in parallel
- Observe progress and outputs clearly
- Intervene only when decisions require human judgment

MVP boundary:
- Single-user
- Local-first
- Human-in-the-loop agent orchestration

---

## 3. Problem Statement

Technical users have many repetitive or parallelizable tasks (for example code reviews, refactors, content pipelines) but current AI chat workflows are mostly linear and require constant manual supervision.

Workforce MVP solves this by turning AI work into supervised multi-agent execution with clear status, clear ownership, and explicit review checkpoints.

---

## 4. Target Users and Jobs-to-be-Done

### Primary User

- Technical individual contributor (engineering lead, staff engineer, technical founder)
- Comfortable with repository workflows and quality review
- Needs leverage across parallel workstreams

### Job-to-be-Done

"When I have a backlog of technical tasks, I want to delegate work to specialized agents, monitor progress centrally, and step in only when risk or ambiguity requires my decision."

---

## 5. Product Goals and Non-Goals

### Goals

1. Users can define reusable agent templates and workflow templates.
2. Users can run goal-driven agent work and open-ended chat work in one product.
3. Users can supervise multiple concurrent agents from a single operational view.
4. Users can resolve approval and clarification requests from a centralized queue.
5. Users can inspect each agent's reasoning context, actions, and outputs.

### Non-Goals (MVP)

1. Multi-user collaboration, permissions, and organization management.
2. Mandatory cloud sync across devices.
3. Marketplace/distribution ecosystem for templates or plugins.
4. Advanced visual workflow builder as the only authoring method.

---

## 6. Scope (MVP)

In scope:
1. Agent template management
2. Workflow template management
3. Chat sessions and goal-driven WorkAgents
4. Agent spawning (parent-child execution)
5. Board view for supervision
6. Feedback/review queue
7. Agent detail inspection and direct intervention
8. Parallel code work isolation via independent working contexts
9. Session and action history for auditability
10. Dogfooding loop: the product is usable to implement and review changes to itself

Out of scope for MVP is listed in Section 12.

---

## 7. Functional Requirements

### FR1. Organization and Project Context

#### Requirements

1. The system shall allow users to create and manage one or more organizations.
2. The system shall scope templates, sessions, and tool access to an organization.
3. The system shall persist organization state so users can resume work after restart.

#### Acceptance Criteria

1. User can open an organization and see its templates and active sessions.
2. Organization state is recovered after app restart without manual repair.

---

### FR2. Agent Template Management

#### Requirements

1. The system shall allow users to create, edit, duplicate, and archive agent templates.
2. The system shall support required agent attributes:
   - name
   - description
   - skills
   - tools
   - constraints
   - reasoning intensity (or equivalent control)
3. The system shall validate templates and show actionable errors before execution.
4. The system shall allow users to launch work directly from an agent template.

#### Acceptance Criteria

1. User can create a valid template and execute it in under 2 minutes.
2. Invalid templates are blocked from execution with explicit validation feedback.
3. Archived templates are hidden from default selection but remain recoverable.

---

### FR3. Workflow Template Management

#### Requirements

1. The system shall allow users to define multi-step workflows.
2. The system shall support sequencing, dependency, and parallel step semantics.
3. The system shall support explicit review gates in workflows.
4. The system shall allow users to save and rerun workflow templates.
5. The system shall support an auto-generated draft workflow from a natural-language goal.

#### Acceptance Criteria

1. User can run a saved workflow without manual reconstruction.
2. Parallel steps execute concurrently when dependencies permit.
3. Review-gated steps pause execution until user action is recorded.

---

### FR4. Session Types and Lifecycle

#### Requirements

1. The system shall support two session types:
   - Chat Session (open-ended)
   - WorkAgent (goal-driven)
2. The system shall support lifecycle states at minimum:
   - created
   - active
   - paused
   - completed
   - failed
   - cancelled
3. The system shall record pause reasons and resume events.
4. The system shall allow manual cancellation of any running WorkAgent.

#### Acceptance Criteria

1. User can distinguish session type and current state at a glance.
2. Paused sessions always display a human-readable pause reason.
3. State transitions are recorded in history for post-run review.

---

### FR5. Multi-Agent Orchestration

#### Requirements

1. The system shall allow a WorkAgent to create child WorkAgents.
2. The system shall maintain parent-child relationships across execution.
3. The system shall support manager-style orchestration as a behavior pattern.
4. The system shall surface aggregate progress for parent agents.

#### Acceptance Criteria

1. A parent agent can spawn at least two children and track their states.
2. Parent-child relationships remain intact after restart.
3. Parent completion reflects required child outcomes.

---

### FR6. Supervision Board

#### Requirements

1. The system shall provide a board view with status-based groupings.
2. The board shall include at minimum: Active, Paused, Completed, Failed.
3. Each agent card shall show goal, status, progress, and relationship summary.
4. The board shall support filtering by status, workflow, and keyword.

#### Acceptance Criteria

1. User can locate and open a paused agent in no more than 2 interactions.
2. Board counts match actual session state totals.
3. Filters update results without requiring page reload.

---

### FR7. Feedback Queue and Human Review

#### Requirements

1. The system shall provide a centralized queue of items requiring human action.
2. Each review item shall include:
   - source agent
   - workflow context
   - summary/recommendation
   - available actions
3. Supported review actions shall include:
   - approve
   - reject
   - request edit
   - provide clarification
4. The system shall tie review outcomes to session state transitions.

#### Acceptance Criteria

1. Queue badge count matches unresolved item count.
2. User can resolve an item from the queue without navigating away.
3. Resolving a blocking item unblocks related agent execution when appropriate.

---

### FR8. Agent Transparency and Intervention

#### Requirements

1. The system shall provide an Agent Detail view with:
   - conversation history
   - runtime context
   - files/actions performed
   - debug/audit metadata
2. The system shall allow direct user-to-agent messaging from Agent Detail.
3. The system shall show change artifacts (for example file diffs) when relevant.

#### Acceptance Criteria

1. User can inspect why an agent paused using Agent Detail data.
2. User can send corrective guidance and resume the same agent.
3. Debug metadata is available for every model run in the session.

---

### FR9. Parallel Work Isolation

#### Requirements

1. The system shall isolate concurrent code-modifying agents to prevent destructive interference.
2. The system shall provide a completion decision flow for each isolated work output:
   - merge/apply
   - keep for later
   - archive
3. Failed executions shall preserve isolated outputs for debugging unless explicitly removed.

#### Acceptance Criteria

1. At least three concurrent code agents can run in one project without overwriting each other's work.
2. User can merge one completed output while others continue running.
3. User can inspect and recover archived outputs.

---

### FR10. Skills and Tool Access

#### Requirements

1. The system shall allow attaching skills and tools to agent templates.
2. The system shall enforce org-level tool permission boundaries.
3. The system shall provide clear error states for missing permission or missing capability.

#### Acceptance Criteria

1. User can verify active skills/tools at runtime for any agent.
2. Permission-denied failures include clear remediation guidance.

---

### FR11. History and Auditability

#### Requirements

1. The system shall persist session timelines, state transitions, and review decisions.
2. The system shall persist enough data to reconstruct what an agent did and why.
3. The system shall support post-run inspection of completed and failed sessions.

#### Acceptance Criteria

1. User can open a completed session and review full decision/action history.
2. Failure analysis is possible without rerunning the task.

---

## 8. MVP Priority Tiers (P0 vs P1)

### P0 (Must Have for MVP Release)

P0 is the minimum capability set required for Workforce to be useful for day-to-day execution and for iterating on Workforce itself.

1. **FR1**: create/edit/run agent templates (archive optional in P1).
2. **FR2**: create/save/run workflows with dependency and gate support.
3. **FR4**: both session types and lifecycle state transitions.
4. **FR5**: parent-child orchestration with persistent relationship tracking.
5. **FR6**: supervision board with Active/Paused/Completed/Failed grouping.
6. **FR7**: centralized review queue with approve/reject/clarification actions.
7. **FR8**: agent detail with conversation, runtime context, and action/files evidence.
8. **FR9**: parallel work isolation + completion decision flow (merge/keep/archive).
9. **FR10**: org-level skills/tool assignment and permission boundary handling.
10. **FR11**: session and review history sufficient for post-run debugging.

### P0 Dogfooding Gate (Mandatory)

Before MVP release, the team must successfully run this loop using Workforce itself:

1. Plan a small product or code change in Workforce.
2. Spawn multiple WorkAgents to implement/test/review the change.
3. Resolve at least one queued human review item.
4. Merge at least one completed output while other agents continue.
5. Use session history to audit decisions after completion.

### P1 (Can Land After MVP)

1. Auto-generated workflow drafts from natural language with stronger quality guarantees.
2. Deeper board analytics and advanced filtering/sorting.
3. Richer template lifecycle (versioning, portability/export-import).
4. Expanded automation policies (conditional merge, retry budgets, guardrail tuning UX).
5. Enhanced debug/audit detail and reporting layers.

---

## 9. Non-Functional Requirements

1. **Usability**: Core flows (create template, run workflow, resolve review) must be learnable without external training.
2. **Performance**: Operational views must reflect state changes quickly enough for active supervision.
3. **Reliability**: Sessions and review data must survive restart and recover from unclean shutdown.
4. **Safety**: Risky actions must be reviewable and interruptible by the user.
5. **Observability**: Every execution must produce auditable metadata (timing, cost, outcomes).

---

## 10. Success Metrics

| Metric | Target | Definition |
| --- | --- | --- |
| WorkAgent completion rate | > 85% | Share of WorkAgents that end `completed` |
| Multi-agent workflow success | > 70% | Parent and required children complete successfully |
| Pause-to-resolution median | < 2 min | Time from blocking pause to user decision |
| Review coverage | 100% | Blocking review events appear in queue |
| Audit completeness | 100% | Sessions include traceable actions and outcomes |
| User control confidence | Qualitative improvement | Users report clear understanding of what agents did and why |

---

## 11. Release Criteria (MVP)

MVP is release-ready when:

1. All P0 requirements and acceptance criteria are met.
2. Core journeys pass end-to-end:
   - single WorkAgent execution
   - manager with child agents
   - review-gated workflow
3. P0 Dogfooding Gate is completed successfully.
4. No critical blockers remain in agent supervision, review, or state recovery.

---

## 12. Out of Scope (Explicit)

1. Organization-level collaboration features.
2. Shared template marketplace.
3. Mandatory cloud synchronization.
4. Fully visual-only workflow construction as MVP requirement.
5. Autonomous production deployment with no human review controls.

---

## 13. Locked MVP Policies

1. **Pause policy**: Hybrid (workflow-defined gates plus agent self-pause allowed).
2. **Merge authority**: Manual by default in MVP.
3. **Retry policy**: Manual retry only in MVP.
4. **Cost guardrails**: Warning thresholds plus optional hard org caps.
5. **Template portability**: Org-local in MVP; export/import is P1.

---

## Appendix A: Glossary

- **Agent Template**: reusable specification for agent behavior and permissions.
- **Workflow Template**: reusable multi-step process involving one or more agents.
- **Chat Session**: open-ended conversation without required completion criteria.
- **WorkAgent**: goal-bound agent execution with explicit completion states.
- **Review Item**: user decision request required to proceed or finalize.
- **Organization (Org)**: project boundary for state, permissions, and artifacts.
