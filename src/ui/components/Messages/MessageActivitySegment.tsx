import { useMemo, useState } from "react";
import { Check, ChevronRight, Loader2, X } from "lucide-react";
import type { ContentBlock } from "@/services/types";
import { Button } from "@/components/ui/button";
import ContentBlockRenderer from "./ContentBlockRenderer";
import { Chip } from "@/ui/components/Chip";

type GroupedItem =
  | { kind: "block"; block: ContentBlock }
  | { kind: "task"; block: ContentBlock & { type: "tool_use" }; children: ContentBlock[] };

function groupActivities(blocks: ContentBlock[]): GroupedItem[] {
  const items: GroupedItem[] = [];
  let currentTask: (ContentBlock & { type: "tool_use" }) | null = null;
  let currentChildren: ContentBlock[] = [];

  function flushTask() {
    if (!currentTask) return;
    items.push({ kind: "task", block: currentTask, children: currentChildren });
    currentTask = null;
    currentChildren = [];
  }

  for (const block of blocks) {
    if (block.type === "tool_use" && (block.name === "Task" || block.name === "Agent")) {
      flushTask();
      currentTask = block;
      currentChildren = [];
    } else if (currentTask) {
      if (block.type === "text") {
        flushTask();
        items.push({ kind: "block", block });
      } else {
        currentChildren.push(block);
      }
    } else {
      items.push({ kind: "block", block });
    }
  }
  flushTask();
  return items;
}

function TaskStatusIcon({ status }: { status: "running" | "complete" | "error" }) {
  if (status === "running")
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-palette-primary shrink-0" />;
  if (status === "error") {
    return (
      <span className="shrink-0 w-4 h-4 rounded-full bg-palette-danger/15 inline-flex items-center justify-center">
        <X className="h-2.5 w-2.5 text-palette-danger" />
      </span>
    );
  }
  return (
    <span className="shrink-0 w-4 h-4 rounded-full bg-palette-success/15 inline-flex items-center justify-center">
      <Check className="h-2.5 w-2.5 text-palette-success" />
    </span>
  );
}

function TaskGroupRow({
  block,
  children,
  isStreaming,
}: {
  block: ContentBlock & { type: "tool_use" };
  children: ContentBlock[];
  isStreaming: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const args = (block.inputRaw ?? {}) as Record<string, unknown>;
  const subagentType = args.subagent_type ? String(args.subagent_type) : null;
  const description = String(args.description ?? block.input ?? "Task");

  return (
    <div>
      <Button
        type="button"
        variant="ghost"
        color="neutral"
        aria-expanded={expanded}
        onClick={() => setExpanded((p) => !p)}
        className="group/row h-auto w-full justify-start gap-2 px-0 py-0.5 text-[13px] hover:bg-transparent"
      >
        <ChevronRight
          className={`h-3 w-3 text-neutral-fg-subtle/60 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
        />
        <TaskStatusIcon status={block.status} />
        {subagentType && <Chip>{subagentType}</Chip>}
        <span className="truncate flex-1 min-w-0 text-neutral-fg-subtle font-medium">
          {description}
        </span>
        {block.status === "error" && <Chip color="danger">Error</Chip>}
      </Button>
      {expanded && children.length > 0 && (
        <div className="pl-5 ml-[7px] border-l-2 border-neutral-border-subtle space-y-0">
          <ContentBlockRenderer blocks={children} isStreaming={isStreaming} inline />
        </div>
      )}
    </div>
  );
}

function deriveStreamingHeader(activityBlocks: ContentBlock[]) {
  for (let i = activityBlocks.length - 1; i >= 0; i--) {
    const b = activityBlocks[i];
    if (b.type === "tool_use" && b.status === "running") return `Running ${b.name}...`;
  }
  const lastTool = [...activityBlocks].reverse().find((b) => b.type === "tool_use");
  if (lastTool && lastTool.type === "tool_use") return `Running ${lastTool.name}...`;
  return "Working...";
}

function pluralize(n: number, singular: string, plural: string) {
  return n > 0 ? `${n} ${n > 1 ? plural : singular}` : "";
}

function deriveCompletedHeader(activityBlocks: ContentBlock[]) {
  const tools = activityBlocks.filter(
    (b): b is ContentBlock & { type: "tool_use" } => b.type === "tool_use",
  );
  if (tools.length === 0) return "Completed";

  const counts: Record<string, number> = {};
  for (const t of tools) counts[t.name] = (counts[t.name] ?? 0) + 1;

  const entries: Array<[number, string, string, string?]> = [
    [counts.Read ?? 0, "file", "files", "read "],
    [(counts.Edit ?? 0) + (counts.Write ?? 0), "file", "files", "edited "],
    [(counts.Grep ?? 0) + (counts.Glob ?? 0), "search", "searches"],
    [counts.Bash ?? 0, "command", "commands"],
    [counts.Task ?? 0, "task", "tasks"],
  ];
  const parts = entries
    .filter(([n]) => n > 0)
    .map(([n, sg, pl, prefix]) => `${prefix ?? ""}${pluralize(n, sg, pl)}`);
  return parts.length > 0
    ? parts.join(", ")
    : `Used ${tools.length} tool${tools.length > 1 ? "s" : ""}`;
}

function deriveHeaderText(activityBlocks: ContentBlock[], isStreaming: boolean) {
  return isStreaming
    ? deriveStreamingHeader(activityBlocks)
    : deriveCompletedHeader(activityBlocks);
}

export function ActivitySegment({
  blocks,
  isStreaming,
}: {
  blocks: ContentBlock[];
  isStreaming: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const grouped = useMemo(() => groupActivities(blocks), [blocks]);
  const anyRunning = blocks.some((b) => b.status === "running");
  const headerText = useMemo(
    () => deriveHeaderText(blocks, isStreaming && anyRunning),
    [blocks, isStreaming, anyRunning],
  );
  const errorCount = useMemo(
    () => blocks.filter((b) => b.type === "tool_use" && b.status === "error").length,
    [blocks],
  );

  if (grouped.length === 1) {
    if (grouped[0].kind === "block") {
      return <ContentBlockRenderer blocks={[grouped[0].block]} isStreaming={isStreaming} inline />;
    }
    const task = grouped[0];
    return (
      <TaskGroupRow block={task.block} isStreaming={isStreaming}>
        {task.children}
      </TaskGroupRow>
    );
  }

  return (
    <div>
      <Button
        type="button"
        variant="ghost"
        color="neutral"
        aria-expanded={expanded}
        onClick={() => setExpanded((p) => !p)}
        className="h-auto w-full justify-start gap-2 px-0 py-1 text-[13px] hover:bg-transparent"
      >
        <ChevronRight
          className={`h-3 w-3 shrink-0 transition-transform text-neutral-fg-subtle/40 ${expanded ? "rotate-90" : ""}`}
        />
        {isStreaming && anyRunning ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-palette-primary shrink-0" />
        ) : (
          <span className="shrink-0 w-4 h-4 rounded-full bg-palette-success/15 inline-flex items-center justify-center">
            <Check className="h-2.5 w-2.5 text-palette-success" />
          </span>
        )}
        <span className="truncate flex-1 min-w-0 text-left">{headerText}</span>
        {errorCount > 0 && <Chip color="danger">{errorCount} failed</Chip>}
      </Button>

      {expanded && (
        <div className="pl-4 space-y-0 border-l-2 border-neutral-border-subtle ml-[5px]">
          {grouped.map((item, i) => {
            if (item.kind === "task") {
              return (
                <TaskGroupRow
                  key={`task-${item.block.id}`}
                  block={item.block}
                  isStreaming={isStreaming}
                >
                  {item.children}
                </TaskGroupRow>
              );
            }
            const block = item.block;
            const key = block.type === "tool_use" ? `tool-${block.id}` : `${block.type}-${i}`;
            return (
              <ContentBlockRenderer key={key} blocks={[block]} isStreaming={isStreaming} inline />
            );
          })}
        </div>
      )}
    </div>
  );
}
