# Workforce MVP - Product Requirements Document

_Last updated: February 9, 2026_
_Status: Draft (implementation-ready)_

---

## 1. Executive Summary

**Workforce** is a desktop app for building and operating AI agent teams.

Core experience:
- Define reusable agents
- Define workflows that connect agents
- Run many agents in parallel
- Watch progress in real time
- Intervene only when needed

**MVP outcome**: a polished single-user desktop app where one person can run agent-driven workflows with full observability and control.

**Not MVP**: cloud sync, org/team collaboration, distributed runtime, marketplace ecosystem.

---

## 2. Product Goals and Non-Goals

### Goals

1. Users can create agent templates and workflow templates without writing backend code.
2. Users can execute both ad-hoc chat sessions and goal-driven WorkAgents.
3. Users can supervise multiple concurrent agents from one board.
4. Users can review/approve agent decisions through a centralized review queue.
5. Users can inspect every agent's context, tool activity, and file diffs.

### Non-Goals

1. Multi-user permissions, sharing, and role-based access.
2. Cross-device sync and cloud-hosted state.
3. Visual drag-and-drop workflow editor (YAML first for MVP).
4. Multi-runtime orchestration (ship Claude harness first, keep abstraction for later).

---

## 3. Target User and Job to Be Done

### Primary User

- Technical individual contributors (engineering leads, staff engineers, technical founders)
- Comfortable reviewing code and operating git workflows
- Need leverage for repetitive or parallelizable work

### Job to Be Done

"When I have a backlog of technical tasks, I want to spin up specialized agents, monitor progress, and only intervene at high-risk checkpoints so I can ship faster without losing control."

---

## 4. Core Concepts and Domain Model

### Terminology

| Term | Definition |
| --- | --- |
| **Agent Template** | Reusable definition of skills, tools, constraints, and behavior defaults. |
| **Workflow Template** | Reusable multi-step plan describing agent sequence, dependencies, and gates. |
| **Session** | Runtime conversation/execution container. |
| **Chat Session** | Open-ended manual session, no completion goal required. |
| **WorkAgent** | Goal-driven session that completes, fails, or is cancelled. |
| **Manager Agent** | A WorkAgent whose primary output is coordinating child WorkAgents. |
| **Review Item** | A queued request for human action (approval, clarification, exception handling). |
| **Workspace** | Project root and local configuration boundary. |
| **Worktree** | Isolated git working copy used by a WorkAgent for safe parallel changes. |

### Unified Session Model

```typescript
type SessionType = "chat" | "workagent";
type SessionStatus =
    | "created"
    | "active"
    | "paused"
    | "completed"
    | "failed"
    | "cancelled";
type StartMode = "manual" | "spawned";

interface AgentSession {
    id: string;
    workspaceId: string;
    name: string;
    type: SessionType;
    startMode: StartMode;

    // WorkAgent-only fields
    goal?: string;
    progress?: number; // 0-100

    // Shared config
    skills: string[];
    tools: string[];
    constraints: string[];
    thinking: "low" | "medium" | "high" | "max";

    // Runtime
    status: SessionStatus;
    pauseReason?: string;
    lastActivityAt: number;

    // Relationships
    parentId?: string;
    childIds: string[];

    // Execution backend
    harness: "claude-sdk";

    // Filesystem execution scope
    workingDirectory?: string;
    worktreeId?: string;
}
```

### Lifecycle Rules

1. Any session can pause and resume.
2. Only WorkAgents have required completion semantics.
3. WorkAgents may be started manually or spawned by another WorkAgent.
4. Manager behavior is not a separate runtime type; it is a WorkAgent pattern.

---

## 5. Functional Requirements (MVP)

### FR1. Agent and Workflow Definition (Team Builder)

### User Value
Users can encode repeatable operating patterns and run them consistently.

### Requirements

1. Create/edit/delete agent templates in workspace scope.
2. Create/edit/delete workflow templates in workspace scope.
3. Support YAML-based template authoring in MVP.
4. Allow "auto-build team from goal" flow that proposes an initial template/workflow.
5. Save templates for reuse.

### Acceptance Criteria

1. User can create an agent template with name, skills, tools, constraints, and thinking level.
2. User can create a workflow template with steps, dependencies, and review gates.
3. User can run a saved template from UI without manual file editing.
4. System validation rejects malformed YAML and shows actionable errors.

### Draft Agent Template

```yaml
id: code-reviewer-v1
name: "Code Reviewer"
description: "Reviews PRs for correctness, quality, and security issues"
skills: [code-review, security-audit]
tools: [github, filesystem, bash]
constraints:
  - "Never approve without evidence from tests or static checks"
  - "Flag hardcoded secrets and insecure auth patterns"
thinking: high
```

### Draft Workflow Template

```yaml
id: pr-review-pipeline-v1
name: "PR Review Pipeline"
trigger: "Review PR #{pr_number}"
steps:
  - id: code-review
    agent: code-reviewer-v1
    task: "Review code changes"
    outputs: [review_comments, approval_status]

  - id: security-scan
    agent: security-scanner-v1
    task: "Check for vulnerabilities"
    parallel: true

  - id: human-gate
    gate: human-approval
    condition: "security_issues.length > 0"
    prompt: "Security issues found. Approve anyway?"

  - id: merge
    agent: merge-bot-v1
    task: "Merge if approved"
    depends_on: [code-review, security-scan, human-gate]
```

---

### FR2. Execution Engine and Agent Spawning

### User Value
Users can run one or many agents in parallel and get predictable outcomes.

### Requirements

1. Support standalone WorkAgent execution from user goal input.
2. Support WorkAgent spawning child WorkAgents.
3. Persist session state and execution events in append-only JSONL.
4. Support pause/resume with explicit pause reason.
5. Surface completion, failure, and cancellation states.

### Acceptance Criteria

1. A WorkAgent can be created, executed, paused, resumed, and completed.
2. A Manager WorkAgent can spawn at least two child WorkAgents and track them.
3. Parent/child links are visible in both persisted state and UI.
4. System can recover session state after app restart without corruption.

---

### FR3. Board and Agent Detail

### User Value
Users can supervise the full system from one place and drill into any agent.

### Requirements

1. Board view with columns: `Active`, `Paused`, `Completed`, `Failed`.
2. Agent cards show goal, progress, parent/child count, and last activity.
3. Filters by status, workflow, and keyword.
4. Agent detail view includes tabs: `Conversation`, `Context`, `Files`, `Debug`.
5. Direct chat input from agent detail for guidance/corrections.

### Acceptance Criteria

1. User can find a paused agent and open its detail in <= 2 clicks.
2. User can send a direct message to a paused agent and resume it.
3. Files tab shows read/write list and patch-level diffs for modified files.
4. Debug tab shows token/cost/timing metadata for each model turn.

---

### FR4. Feedback Queue and Review UI

### User Value
Human review is centralized and low-friction.

### Requirements

1. Central queue for all pending human actions.
2. Each item includes: source agent, workflow context, recommendation, and actions.
3. Review types: `Approval Gate`, `Clarification`, `Exception`, `Quality Check`.
4. Actions supported: `Approve`, `Reject`, `Request Edit`, `Reply`.

### Acceptance Criteria

1. Badge count accurately reflects pending queue length.
2. User can resolve queue items without leaving the review panel.
3. Resolved review item transitions associated agent out of paused state when appropriate.

---

### FR5. Workspaces and Worktrees

### User Value
Parallel agent execution is safe and debuggable.

### Requirements

1. Workspace is root boundary for templates, sessions, and tool credentials.
2. WorkAgent requiring code access gets isolated git worktree by default.
3. Completion flow prompts user to merge, keep, or archive each worktree.
4. Failed agent keeps worktree for debugging unless user archives it.

### Worktree Model

```typescript
interface Worktree {
    id: string;
    workspaceId: string;
    agentId: string;
    path: string;
    branch: string;
    baseBranch: string;
    status: "active" | "completed" | "orphaned" | "archived";
    createdAt: number;
    archivedAt?: number;
}
```

### Acceptance Criteria

1. Two agents can modify same repo in parallel using separate worktrees.
2. Merge flow can merge one branch while other agents continue running.
3. Archived worktrees are recoverable until explicit deletion.

---

### FR6. Skills and Tool Connectivity

### Requirements

1. Workspace-level tool connections (filesystem, git, MCP tools, external services).
2. Agent templates declare required tool set.
3. Skills library supports built-in and user-defined skill packs.

### Acceptance Criteria

1. User can assign tools and skills to an agent template and see them in Context tab at runtime.
2. Tool permission failure is surfaced with a clear remediation path.

---

## 6. V0 Dogfood Scope (Build First)

Purpose: get a usable internal loop to help build the full MVP.

| Capability | V0 | MVP |
| --- | --- | --- |
| Chat sessions | Yes | Yes |
| Manual WorkAgent start | Yes | Yes |
| WorkAgent spawning | Limited/manual | Full |
| Pause/resume | Yes | Yes |
| Session list/board | Simple list | Full board |
| Agent detail | Conversation only | 4 tabs |
| Worktrees | Manual | Automatic |
| Review queue | Minimal | Full |
| Cost tracking | No | Yes |

**V0 target**: 1-2 weeks.

---

## 7. Technical Decisions

### Build On Existing Foundation

Keep:
1. Tauri 2 + Hono server model
2. EventBus architecture
3. Lazy-initialized services

Change:
1. UI framework to React 19.2
2. State stack to Zustand + Jotai + TanStack Query
3. Component primitives to shadcn/ui
4. Persistence from per-file JSON to append-only JSONL
5. Config model to workspace-scoped settings

New:
1. Unified session model (`chat` + `workagent`)
2. Agent spawning and parent/child orchestration
3. Worktree lifecycle manager
4. Review queue UI and board UI

### Reference Implementation

Use Craft Agents OSS chat surface as implementation reference:
- `apps/electron/src/renderer/`
- `packages/ui/src/components/chat/`
- `packages/ui/src/components/markdown/`
- `packages/core/src/types/session.ts`

Reuse patterns, extend types instead of rewriting from scratch.

---

## 8. Milestones and Exit Criteria

### M0 (Weeks 1-2): Foundation

Deliverables:
1. React app shell with chat view running
2. EventBus ported and integrated
3. Hono backend connected end-to-end

Exit criteria:
1. User can start a basic chat session and receive streaming output.
2. App restart preserves chat session list.

### M1 (Weeks 3-4): WorkAgent Runtime

Deliverables:
1. WorkAgent lifecycle implementation
2. Session persistence in JSONL
3. Pause/resume mechanics

Exit criteria:
1. User can run a single WorkAgent to completion with persisted history.
2. User can pause/resume with visible reason.

### M2 (Weeks 5-6): Supervision UX

Deliverables:
1. Board view (4 columns)
2. Agent detail tabs
3. Review queue

Exit criteria:
1. User can triage queued review items and unblock agents.
2. User can inspect context/files/debug for any agent.

### M3 (Weeks 7-8): Multi-Agent + Worktrees

Deliverables:
1. Agent spawning with hierarchy
2. Automatic worktree management
3. Merge/keep/archive completion flow
4. Agent library baseline

Exit criteria:
1. User can run at least 3 parallel WorkAgents on one repo.
2. User can merge outputs individually without losing other in-flight work.

---

## 9. Non-Functional Requirements

1. **Performance**: idle memory < 150 MB on target machine profile.
2. **Reliability**: no session loss after unclean shutdown (JSONL replay).
3. **Observability**: every model turn has trace metadata (tokens, latency, cost).
4. **Security**: explicit tool permission boundary per workspace.
5. **UX latency**: board state update within 1 second of status changes.

---

## 10. Success Metrics

| Metric | Target | Definition |
| --- | --- | --- |
| WorkAgent completion rate | > 85% | % of WorkAgents ending `completed` vs `failed/cancelled` |
| Pause-to-resume median | < 2 min | Median time from pause event to user action |
| Multi-agent workflow success | > 70% | Parent and all required child agents complete |
| Cost visibility coverage | 100% | Sessions with visible token/cost/timing data |
| Idle memory | < 150 MB | Performance test scenario baseline |
| Test coverage | > 70% | Unit + component + service-level tests |

---

## 11. Risks and Mitigations

1. **Model unpredictability in autonomous runs**
   - Mitigation: strict constraints, review gates, clearer pause reasons, explicit cancellation controls.
2. **Git conflict complexity with parallel work**
   - Mitigation: isolated worktrees, merge one branch at a time, preserve failed worktrees.
3. **UI complexity from multi-agent visibility**
   - Mitigation: progressive disclosure (Board -> Agent detail -> tabs).
4. **Cost overrun in long-running managers**
   - Mitigation: per-agent token/cost budget warnings and hard stops.

---

## 12. Open Decisions for Final MVP Lock

1. **Default pause policy**
   - Option A: workflow-defined gates only
   - Option B: model decides only
   - Option C: both (recommended)

2. **Merge authority**
   - Option A: always manual merge by user
   - Option B: auto-merge low-risk changes
   - Option C: configurable per workflow (recommended)

3. **Retry policy for failed agents**
   - Option A: manual retry only
   - Option B: one automatic retry
   - Option C: configurable retry budget (recommended)

4. **Template portability format**
   - Option A: YAML files only
   - Option B: YAML + signed bundle export
   - Option C: YAML now, bundle in v1.5 (recommended)

5. **Cost guardrails**
   - Option A: visibility only
   - Option B: warnings at threshold
   - Option C: warnings + hard budget caps (recommended)

---

## Appendix A: Representative User Journeys

1. **Auto-build PR review team**
   - User asks to review several PRs.
   - Manager WorkAgent is created and spawns child reviewers.
   - One reviewer pauses for human security decision.
   - User resolves review item; workflow completes.

2. **Single WorkAgent task**
   - User asks for a focused code change.
   - WorkAgent executes in isolated worktree.
   - Agent pauses with "changes ready" review item.
   - User reviews diff and chooses merge.

3. **Manual chat with optional spawn**
   - User starts open-ended chat.
   - Later asks for parallel execution.
   - Chat session spawns WorkAgents while chat stays active.

---

## Appendix B: Current Foundation Snapshot

Completed in v1:
- EventBus with streaming
- Lazy service architecture
- Agent SDK integration
- Virtual scrolling UI
- Skills and hooks
- Background tasks and git workflows
- Session persistence and test coverage baseline

MVP focus is primarily UX and orchestration on top of this foundation.
