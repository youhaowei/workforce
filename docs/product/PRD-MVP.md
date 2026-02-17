# Workforce MVP — Product Requirements Overview

_Last updated: February 15, 2026_
_Status: Draft_

---

## Purpose

This document is the high-level product requirements overview for Workforce MVP. Detailed feature specifications live in Notion as child pages of the [Workforce project](https://www.notion.so/2ffd48ccaf5481d7bb33d67599423042).

---

## Product Summary

Workforce is a desktop product for running AI agents as coordinated teams. Single-user, local-first, human-in-the-loop.

Core promise: define reusable agents and workflows, execute in parallel, observe clearly, intervene only when human judgment is needed.

---

## Problem Statement

Technical users have repetitive or parallelizable tasks but current AI workflows are linear and require constant supervision. Workforce turns AI work into supervised multi-agent execution with clear status, ownership, and review checkpoints.

---

## Target Users

Technical IC (engineering lead, staff engineer, technical founder) needing leverage across parallel workstreams.

**Job-to-be-Done:** "Delegate work to specialized agents, monitor centrally, step in only when risk or ambiguity requires my decision."

---

## Goals

1. Define reusable agent templates and workflow templates
2. Run goal-driven agent work and open-ended chat in one product
3. Supervise multiple concurrent agents from a single view
4. Resolve approval and clarification requests from a centralized queue
5. Inspect each agent's reasoning, actions, and outputs

**Non-Goals (MVP):** Multi-user collaboration, mandatory cloud sync, template marketplace, visual-only workflow builder.

---

## MVP Feature Areas

Detailed specs for each area live in Notion under the Workforce project:

| Feature Area | FRs | Priority |
|---|---|---|
| [Sessions & Fork](https://www.notion.so/308d48ccaf54810096d5c1f7f6d49188) | FR4 + FR5 | P0 |
| [Agent & Workflow Templates](https://www.notion.so/308d48ccaf5481a9a890c96aa4f767a5) | FR2 + FR3 | P0 |
| [Supervision & Review](https://www.notion.so/308d48ccaf5481bc810fd86ac53a2b32) | FR6 + FR7 + FR8 | P0 |
| [Skills & Tools](https://www.notion.so/308d48ccaf548117b7bcccd31f0df6bd) | FR10 | P0 |
| [Parallel Work Isolation](https://www.notion.so/308d48ccaf5481f09569d5c5705769df) | FR9 | P0 |
| [Organization & Projects](https://www.notion.so/308d48ccaf5481818399ee2fb5c32c8d) | FR1 | P0 |
| [History & Auditability](https://www.notion.so/308d48ccaf54811b96a3e1def159766d) | FR11 | P0 |

---

## Non-Functional Requirements

1. **Usability** — Core flows learnable without external training
2. **Performance** — Views reflect state changes quickly enough for active supervision
3. **Reliability** — Data survives restart and unclean shutdown
4. **Safety** — Risky actions are reviewable and interruptible
5. **Observability** — Every execution produces auditable metadata

---

## Success Metrics

| Metric | Target |
|---|---|
| WorkAgent completion rate | > 85% |
| Multi-agent workflow success | > 70% |
| Pause-to-resolution median | < 2 min |
| Review coverage | 100% |
| Audit completeness | 100% |

---

## Release Criteria

All P0 requirements met. Three core journeys pass E2E: single WorkAgent, manager with children, review-gated workflow. Dogfooding Gate completed.

**Dogfooding Gate (mandatory):** Plan a change in Workforce, spawn WorkAgents to implement/test/review, resolve a queued review item, merge one output while others continue, audit decisions via history.

---

## Locked MVP Policies

1. **Pause:** Hybrid (workflow gates + agent self-pause)
2. **Merge:** Manual by default
3. **Retry:** Manual only
4. **Cost guardrails:** Warnings + optional hard caps
5. **Template portability:** Org-local; export/import is P1

---

## Out of Scope

Org-level collaboration, shared template marketplace, mandatory cloud sync, visual-only workflow builder, autonomous deployment without human review.

---

## Glossary

- **Agent Template** — Reusable specification for agent behavior and permissions
- **Workflow Template** — Reusable multi-step process involving one or more agents
- **Chat Session** — Open-ended conversation without required completion criteria
- **WorkAgent** — Goal-bound agent execution with explicit completion states
- **Review Item** — User decision request required to proceed or finalize
- **Organization (Org)** — Project boundary for state, permissions, and artifacts
