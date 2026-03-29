# Workforce — Vision Document

*February 2026*

---

## What Is Workforce?

Workforce is an orchestration platform that turns AI agents into an autonomous, scalable workforce. The user describes what they want done. Workforce figures out which agents to spin up, what tools they need, how to coordinate them, and how to report back. The user reviews results, not process.

Workforce doesn't build agents. The intelligence lives in Claude — via Claude Code, the Agent SDK, skill-configured sessions. Workforce provides the infrastructure that makes it all run together: lifecycle management, tool connectivity, work distribution, progress tracking, and the communication fabric between agents and between agents and humans.

The analogy: Workforce is to AI agents what an operating system is to programs. It doesn't do the work — it makes work possible.

---

## The User Is the CEO

The user's role is not to assign tasks, configure tools, or design prompts. The user is the CEO of a company that happens to be staffed entirely by AI agents.

What does a CEO do? They set direction ("launch a marketing campaign for our new product"), review deliverables ("does this campaign plan look right?"), make decisions at key moments ("yes, go with option B"), and monitor overall health ("are we on track? what's it costing?").

Everything else — figuring out who does what, how to break down the work, which tools to use, when to escalate — is the platform's job.

The UX is a conversation. The user says what they want. Workforce asks clarifying questions if needed, then gets to work. The CEO dashboard shows what's happening and surfaces things that need human attention. That's it.

---

## Two Kinds of Work

Not all work is orchestrated the same way. Workforce provides configurable **execution modes** that match how different kinds of work actually get done.

### Engineering Mode

For code, the research is clear: give agents constraints and a test environment, then get out of the way. Cursor's "self-driving codebases" and Anthropic's parallel C compiler project both converge on the same insight — the human's job is to engineer the environment (tests, CI, code review criteria), not to direct the coding.

Workforce's role in engineering mode is minimal: spawn Claude Code instances with the right repo, branch, and constraints. Provide simple coordination primitives (git, file locks) for multi-agent work. Surface results (test pass/fail, files changed, cost) to the dashboard. Don't micromanage.

### Knowledge Work Mode

Marketing campaigns, legal reviews, financial reconciliations, product specs, customer support — these are structured workflows with defined steps, compliance requirements, and specific deliverable formats. You can't just say "figure it out."

Workforce provides a workflow execution engine. Workflows are defined as data (YAML config files), not code. Each step gets an agent loaded with the right skill bundle — domain knowledge, tool connections, output templates. The agent follows the steps, reports progress at checkpoints, and pauses at review gates for human approval.

New workflows can be created by users or by agents themselves. A new "department" is just a new config file and skill bundle. No platform code changes needed.

### The Key Insight

Execution modes are a spectrum. Engineering sits at the "loose, environment-driven" end. Compliance-heavy legal work sits at the "structured, step-driven" end. Most knowledge work falls somewhere in between. The platform provides the primitives for the full spectrum; the configuration determines where any given workflow lands.

---

## Single-Responsibility Agents

Each agent does exactly one thing. This isn't a design preference — it's a constraint imposed by how LLMs actually work.

Context is a finite resource. An agent loaded with legal domain knowledge, contract templates, and compliance rules cannot simultaneously hold a codebase and reason about engineering tasks. Mixing domains doesn't just waste tokens — it actively degrades quality in both domains.

### Two Agent Types

**WorkAgent** — The worker. Loaded with exactly one skill bundle (domain knowledge + tools + templates). Executes one task. Short-to-medium lived. Doesn't know about other agents or the broader project. Produces a deliverable, reports back, terminates.

**Supervisor** — The team lead. Holds project-level context: goals, constraints, dependencies, progress so far. Breaks work into tasks, spawns WorkAgents, tracks their progress, synthesizes results, makes routing decisions. Does NOT hold domain-specific knowledge. Delegates everything.

### Context Handoff

The Supervisor sends each WorkAgent a **task envelope**: just enough context to do the job (task description, relevant constraints, input artifacts, expected output format). The WorkAgent returns a **result envelope**: deliverable, status, summary, exceptions. No agent ever needs the full context of another agent.

This is how you get quality at each node. The coordination overhead between nodes is the platform's job.

---

## Distributed by Design: The Hive Mind

Workforce is not a single desktop app. It's a distributed system where each running instance is a **node** in a shared **organization**.

### The Model

An **organization** is the shared "company" — it owns workspaces, projects, the work queue, and org-level configuration. A **node** is a running Workforce instance — your laptop, a cloud VM, a teammate's machine. Each node has its own Claude CLI auth, its own concurrency limit (how many agents it can run simultaneously), and its own hardware.

When a Supervisor creates tasks, they go into the organization's work queue. Available nodes pick up tasks based on capacity and capability. Results flow back through shared state. The CEO dashboard on any connected node shows the same unified view.

### Scaling

This is how you go from "one person's tool" to "an actual company that runs itself."

- **Solo user**: 1 node on your laptop, capacity of 2-3 agents. Good for trying things out.
- **Power user**: Laptop + 1 cloud VM, capacity of 5-10 agents total. Real work gets done.
- **Full workforce**: N cloud VMs running 24/7. Dozens of agents in parallel. The "company" never sleeps.

Adding capacity = adding nodes. Each node is stateless except for its auth. All project state lives in the organization's shared layer.

### Auth in the Distributed Model

Each node needs its own Claude CLI auth. This is actually natural for the distributed model — your laptop has your auth, cloud VMs get provisioned with service account auth. The org-level capacity becomes: how many authenticated nodes can you provision?

### Shared State

The organization needs a persistence layer all nodes can access. The right choice depends on scale. For MVP, something simple (file-based, git-based, or SQLite with replication). For production scale, a message queue or cloud-native solution. Start simple, prove the model, upgrade when scale demands it.

---

## What Workforce Provides

Everything below is a platform capability. The actual intelligence lives in Claude.

**Agent lifecycle management** — Spawn WorkAgents and Supervisors, monitor their execution, handle failures, clean up when done. Agents are ephemeral; the platform is persistent.

**Tool connectivity** — MCP servers, API sources, file systems, credentials. Everything an agent needs to interact with the outside world. The platform manages connections, auth, and health checks. Agents just use tools.

**Skill system** — Bundles of domain knowledge + tool connections + output templates. A skill makes any Claude session instantly competent in a workflow. Skills are config files (Markdown with YAML frontmatter). Users and agents can create new ones.

**Workflow engine** — Execute structured workflows defined as data. Steps, checkpoints, review gates, parallel branches. The engine runs the workflow; the agents do the work at each step.

**Work distribution** — The queue where Supervisors post tasks and nodes claim them. Handles priority, capability matching, reassignment on failure.

**Progress tracking & oversight** — The CEO dashboard. Active work across all nodes, deliverable status, review queue, cost monitoring, blocker detection, activity feed. Feels like getting briefed by your team, not managing a Jira board.

**Configuration system** — Workspaces, execution modes, workflows, constraints, permissions — all defined as data, all hot-reloadable, all improvable by users or agents.

**Communication fabric** — How context flows between Supervisors and WorkAgents (task/result envelopes), how agents share artifacts (shared workspace), how the platform notifies humans (review gates, blockers, completions).

---

## Design Principles

1. **Platform, not agents.** Workforce provides lifecycle, tools, configuration, and reporting. The intelligence lives in Claude. Don't rebuild what the model already does.

2. **Workflows are data.** Step definitions, skill assignments, approval gates — all config files. Users and agents can create, edit, and improve workflows. New departments = new config, not new code.

3. **Self-organization tools.** Give agents what they need to organize themselves: task discovery, tool registry, context sharing, progress reporting. Don't micromanage.

4. **Constraints over instructions.** The platform defines boundaries — what's allowed, what's forbidden, what needs approval. Agents use judgment within those boundaries.

5. **Single-responsibility agents.** One skill, one task. Context is finite. Quality comes from focus.

6. **Distributed by default.** Every architectural decision assumes multiple nodes. Shared state, not local state. Work queues, not direct calls.

7. **Simple UX.** The user says what they want. The platform figures out execution mode, agents, tools, workflow. The dashboard shows what's happening. That's the whole interface.

8. **Start simple, scale later.** File locks before message queues. Git repos before databases. Prove the model with the simplest infrastructure, then upgrade.

---

## What Success Looks Like

A user opens Workforce and says: "Prepare a quarterly business review. Pull the financial data from our accounting system, analyze trends, draft the executive summary, and create the slide deck."

Workforce creates a Supervisor that understands the goal. The Supervisor posts tasks to the queue. A WorkAgent with finance skills pulls accounting data and runs the analysis. Another with writing skills drafts the executive summary from the analysis output. A third with presentation skills builds the deck. Each works independently, using only its own domain knowledge and tools.

The user's dashboard shows progress in real time. When the executive summary is ready, a review gate pings the user for approval. Once approved, the deck agent incorporates it. The final deliverable appears in the dashboard. The user reviews, maybe asks for one revision ("make the tone more optimistic"), and it's done.

Total human involvement: one sentence of intent, one review gate approval, one revision note. The "company" did the rest.

---

## Technical Foundation

**Desktop runtime**: Electron (Node main process, Node.js server in-process)
**Frontend**: React 19.2 + Compiler, shadcn/ui, Streamdown, react-virtuoso
**State**: Zustand (global) + Jotai (per-entity streaming) + TanStack Query (server/API)
**Server**: Hono on Node.js via @hono/node-server (in-process in prod, external in dev)
**Agent SDK**: Claude Agent SDK + Claude Code (spawned as processes)
**Config**: Workspace-scoped folder structure (~/.workforce/workspaces/{id}/)
**Sessions**: JSONL persistence with async batched writes
**Shared state**: TBD for MVP (file-based or git-based), upgradeable to cloud-native

**Hard constraint**: Claude Agent SDK requires OS-level CLI auth. Each distributed node needs its own auth. GUI-launched apps need PATH repair to find CLI binaries.

---

## Key References

- **Craft Agents OSS** — Config-driven workspaces, JSONL persistence, three-layer permissions, source abstraction, skill system
- **OpenCode Desktop** — Electron desktop patterns, event coalescing, Platform abstraction, MCP OAuth, deep linking
- **Cursor: Self-Driving Codebases** — Constraints over instructions, accept turbulence, environment engineering, design for throughput
- **Anthropic: Building a C Compiler** — Simple coordination beats complex orchestration, tests as feedback, human = environment designer
- **Opus 4.6 Finance** — Subagent spinning, adaptive thinking, plugins as skill bundles + connectors
