/**
 * MessageItem — Individual message display.
 *
 * User messages: right-aligned bubble with actions below.
 * Assistant messages: chunked segments (thinking, activity, text, question).
 * Task tools rendered as collapsible group headers within activity segments.
 */

import { useState, useMemo, type MouseEvent } from 'react';
import { History, GitBranch, ChevronRight, Loader2, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useMessagesStore } from '@/ui/stores/useMessagesStore';
import type { ContentBlock, ToolActivity } from '@/services/types';
import ToolOutput from '../Tools/ToolOutput';
import ContentBlockRenderer from './ContentBlockRenderer';
import QuestionCard from './QuestionCard';
import Markdown from './Markdown';
import { segmentBlocks } from './segmentBlocks';

export interface ForkInfo {
  sessionId: string;
  title?: string;
}

interface MessageItemProps {
  message: {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
    isStreaming: boolean;
    toolCalls?: Array<{ id: string; name: string; args: unknown }>;
    toolResults?: Array<{ toolCallId: string; result?: unknown; error?: string }>;
    toolActivities?: ToolActivity[];
    contentBlocks?: ContentBlock[];
  };
  messageIndex?: number;
  forks?: ForkInfo[];
  onRewind?: (messageIndex: number) => void;
  onFork?: (messageIndex: number) => void;
  onSelectSession?: (sessionId: string) => void;
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─── Hover action buttons (emphasized) ───────────────────────────────────────

function MessageActions({ messageIndex, isStreaming, onRewind, onFork }: {
  messageIndex: number;
  isStreaming: boolean;
  onRewind?: (messageIndex: number) => void;
  onFork?: (messageIndex: number) => void;
}) {
  const disabled = isStreaming;
  const handleRewind = (e: MouseEvent) => { e.stopPropagation(); onRewind?.(messageIndex); };
  const handleFork = (e: MouseEvent) => { e.stopPropagation(); onFork?.(messageIndex); };

  return (
    <span className="inline-flex items-center gap-1 opacity-0 group-hover/msg:opacity-100 transition-opacity">
      {onRewind && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline" size="sm"
              className="h-6 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground border-border/60"
              disabled={disabled} onClick={handleRewind} aria-label="Rewind to here"
            >
              <History className="h-3 w-3" />
              Rewind
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">Rewind to here</TooltipContent>
        </Tooltip>
      )}
      {onFork && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline" size="sm"
              className="h-6 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground border-border/60"
              disabled={disabled} onClick={handleFork} aria-label="Fork from here"
            >
              <GitBranch className="h-3 w-3" />
              Fork
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">Fork from here</TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}

function ForkIndicator({ forks, onSelectSession }: {
  forks: ForkInfo[];
  onSelectSession?: (sessionId: string) => void;
}) {
  if (forks.length === 0) return null;
  const handleClick = (e: MouseEvent) => { e.stopPropagation(); onSelectSession?.(forks[0].sessionId); };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors" onClick={handleClick}>
          <GitBranch className="h-3 w-3" />
          {forks.length > 1 && <span>{forks.length}</span>}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {forks.length === 1
          ? `Fork: ${forks[0].title ?? forks[0].sessionId.slice(0, 8)}`
          : forks.map((f) => f.title ?? f.sessionId.slice(0, 8)).join(', ')}
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Activity grouping (Task absorbs children) ──────────────────────────────

/** A grouped item: either a standalone block or a Task group with children. */
type GroupedItem =
  | { kind: 'block'; block: ContentBlock }
  | { kind: 'task'; block: ContentBlock & { type: 'tool_use' }; children: ContentBlock[] };

/** Group activity blocks: Task tool_use blocks absorb subsequent blocks until the next text or Task. */
function groupActivities(blocks: ContentBlock[]): GroupedItem[] {
  const items: GroupedItem[] = [];
  let currentTask: (ContentBlock & { type: 'tool_use' }) | null = null;
  let currentChildren: ContentBlock[] = [];

  function flushTask() {
    if (currentTask) {
      items.push({ kind: 'task', block: currentTask, children: currentChildren });
      currentTask = null;
      currentChildren = [];
    }
  }

  for (const block of blocks) {
    if (block.type === 'tool_use' && block.name === 'Task') {
      flushTask();
      currentTask = block;
      currentChildren = [];
    } else if (currentTask) {
      if (block.type === 'text') {
        flushTask();
        items.push({ kind: 'block', block });
      } else {
        currentChildren.push(block);
      }
    } else {
      items.push({ kind: 'block', block });
    }
  }
  flushTask();
  return items;
}

// ─── useMessageSegments hook ─────────────────────────────────────────────────

function useMessageSegments(message: MessageItemProps['message']) {
  const streamingContent = useMessagesStore((s) => s.streamingContent);
  const streamingBlocks = useMessagesStore((s) => s.streamingBlocks);

  const displayContent = useMemo(
    () => (message.isStreaming ? streamingContent : message.content),
    [message.isStreaming, message.content, streamingContent],
  );

  const allBlocks = useMemo(
    () => (message.isStreaming ? streamingBlocks : message.contentBlocks) ?? [],
    [message.isStreaming, streamingBlocks, message.contentBlocks],
  );

  const segments = useMemo(() => segmentBlocks(allBlocks), [allBlocks]);

  return { segments, displayContent, allBlocks };
}

// ─── Status Icons ────────────────────────────────────────────────────────────

function TaskStatusIcon({ status }: { status: 'running' | 'complete' | 'error' }) {
  if (status === 'running') return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />;
  if (status === 'error') {
    return (
      <span className="shrink-0 w-4 h-4 rounded-full bg-destructive/15 inline-flex items-center justify-center">
        <X className="h-2.5 w-2.5 text-destructive" />
      </span>
    );
  }
  return (
    <span className="shrink-0 w-4 h-4 rounded-full bg-emerald-500/15 inline-flex items-center justify-center">
      <Check className="h-2.5 w-2.5 text-emerald-500" />
    </span>
  );
}

// ─── Task Group Row ──────────────────────────────────────────────────────────

function TaskGroupRow({ block, children, isStreaming }: {
  block: ContentBlock & { type: 'tool_use' };
  children: ContentBlock[];
  isStreaming: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const args = (block.inputRaw ?? {}) as Record<string, unknown>;
  const subagentType = args.subagent_type ? String(args.subagent_type) : null;
  const description = String(args.description ?? block.input ?? 'Task');

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((p) => !p)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded((p) => !p); } }}
        className="group/row flex items-center gap-2 py-0.5 text-[13px] cursor-pointer hover:text-foreground transition-colors"
      >
        <ChevronRight className={`h-3 w-3 text-muted-foreground/60 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        <TaskStatusIcon status={block.status} />
        {subagentType && (
          <span className="shrink-0 px-1.5 py-0.5 rounded bg-muted text-[10px] font-medium text-muted-foreground">
            {subagentType}
          </span>
        )}
        <span className="truncate flex-1 min-w-0 text-muted-foreground font-medium">{description}</span>
        {block.status === 'error' && (
          <span className="shrink-0 px-1.5 py-0.5 rounded bg-destructive/10 text-[10px] font-medium text-destructive">Error</span>
        )}
      </div>
      {expanded && children.length > 0 && (
        <div className="pl-5 ml-[7px] border-l-2 border-muted space-y-0">
          <ContentBlockRenderer blocks={children} isStreaming={isStreaming} inline />
        </div>
      )}
    </div>
  );
}

// ─── Activity header derivation ──────────────────────────────────────────────

function deriveStreamingHeader(activityBlocks: ContentBlock[]) {
  for (let i = activityBlocks.length - 1; i >= 0; i--) {
    const b = activityBlocks[i];
    if (b.type === 'tool_use' && b.status === 'running') return `Running ${b.name}...`;
  }
  const lastTool = [...activityBlocks].reverse().find((b) => b.type === 'tool_use');
  if (lastTool && lastTool.type === 'tool_use') return `Running ${lastTool.name}...`;
  return 'Working...';
}

function pluralize(n: number, singular: string, plural: string) {
  return n > 0 ? `${n} ${n > 1 ? plural : singular}` : '';
}

function buildCompletedParts(counts: Record<string, number>): string[] {
  const r = counts.Read ?? 0;
  const e = (counts.Edit ?? 0) + (counts.Write ?? 0);
  const s = (counts.Grep ?? 0) + (counts.Glob ?? 0);

  const entries: Array<[number, string, string, string?]> = [
    [r, 'file', 'files', 'read '],
    [e, 'file', 'files', 'edited '],
    [s, 'search', 'searches'],
    [counts.Bash ?? 0, 'command', 'commands'],
    [counts.Task ?? 0, 'task', 'tasks'],
  ];

  return entries
    .filter(([n]) => n > 0)
    .map(([n, sg, pl, prefix]) => `${prefix ?? ''}${pluralize(n, sg, pl)}`);
}

function deriveCompletedHeader(activityBlocks: ContentBlock[]) {
  const tools = activityBlocks.filter((b): b is ContentBlock & { type: 'tool_use' } => b.type === 'tool_use');
  if (tools.length === 0) return 'Completed';

  const counts: Record<string, number> = {};
  for (const t of tools) counts[t.name] = (counts[t.name] ?? 0) + 1;

  const parts = buildCompletedParts(counts);
  return parts.length > 0 ? parts.join(', ') : `Used ${tools.length} tool${tools.length > 1 ? 's' : ''}`;
}

function deriveHeaderText(activityBlocks: ContentBlock[], isStreaming: boolean) {
  return isStreaming ? deriveStreamingHeader(activityBlocks) : deriveCompletedHeader(activityBlocks);
}

// ─── Segment Components ──────────────────────────────────────────────────────

function ThinkingSegment({ blocks }: { blocks: ContentBlock[] }) {
  return (
    <>
      {blocks.map((block, i) => {
        if (block.type !== 'thinking') return null;
        const isActive = block.status === 'running';
        if (!block.text.trim() && !isActive) return null;
        return <ContentBlockRenderer key={`thinking-${i}`} blocks={[block]} isStreaming={isActive} inline />;
      })}
    </>
  );
}

function ActivitySegment({ blocks, isStreaming }: {
  blocks: ContentBlock[];
  isStreaming: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const grouped = useMemo(() => groupActivities(blocks), [blocks]);
  const anyRunning = blocks.some((b) => b.status === 'running');
  const headerText = useMemo(() => deriveHeaderText(blocks, isStreaming && anyRunning), [blocks, isStreaming, anyRunning]);
  const errorCount = useMemo(() => blocks.filter((b) => b.type === 'tool_use' && b.status === 'error').length, [blocks]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="flex items-center gap-2 w-full py-1 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight className={`h-3 w-3 shrink-0 transition-transform text-muted-foreground/40 ${expanded ? 'rotate-90' : ''}`} />
        {isStreaming && anyRunning ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
        ) : (
          <span className="shrink-0 w-4 h-4 rounded-full bg-emerald-500/15 inline-flex items-center justify-center">
            <Check className="h-2.5 w-2.5 text-emerald-500" />
          </span>
        )}
        <span className="truncate flex-1 min-w-0 text-left">{headerText}</span>
        {errorCount > 0 && (
          <span className="shrink-0 px-1.5 py-0.5 rounded bg-destructive/10 text-[10px] font-medium text-destructive">
            {errorCount} failed
          </span>
        )}
      </button>

      {expanded && (
        <div className="pl-4 space-y-0 border-l-2 border-muted ml-[5px]">
          {grouped.map((item, i) => {
            if (item.kind === 'task') {
              return (
                <TaskGroupRow
                  key={`task-${item.block.id}`}
                  block={item.block}
                  children={item.children}
                  isStreaming={isStreaming}
                />
              );
            }
            const block = item.block;
            const key = block.type === 'tool_use' ? `tool-${block.id}` : `${block.type}-${i}`;
            return <ContentBlockRenderer key={key} blocks={[block]} isStreaming={isStreaming} inline />;
          })}
        </div>
      )}
    </div>
  );
}

function TextSegment({ blocks, isStreaming }: {
  blocks: ContentBlock[];
  isStreaming: boolean;
}) {
  const nonEmpty = blocks.filter((b) => b.type === 'text' && b.text.trim().length > 0);
  if (nonEmpty.length === 0) return null;

  return (
    <div className="bg-background border border-border/50 rounded-lg shadow-sm px-5 py-3">
      <div className="text-sm leading-relaxed">
        <ContentBlockRenderer blocks={nonEmpty} isStreaming={isStreaming} />
      </div>
    </div>
  );
}

// ─── Legacy tool calls ───────────────────────────────────────────────────────

function getToolResult(toolCallId: string, toolResults?: Array<{ toolCallId: string; result?: unknown; error?: string }>) {
  return toolResults?.find((r) => r.toolCallId === toolCallId);
}

function LegacyToolCalls({ toolCalls, toolResults }: {
  toolCalls: NonNullable<MessageItemProps['message']['toolCalls']>;
  toolResults: MessageItemProps['message']['toolResults'];
}) {
  return (
    <div className="space-y-1">
      {toolCalls.map((toolCall) => {
        const result = getToolResult(toolCall.id, toolResults);
        return (
          <ToolOutput
            key={toolCall.id}
            toolName={toolCall.name}
            args={toolCall.args}
            result={result?.result}
            error={result?.error}
            status={result ? 'success' : 'running'}
          />
        );
      })}
    </div>
  );
}

// ─── User Bubble ─────────────────────────────────────────────────────────────

function UserBubble({ content, timestamp, messageIndex, forks, isStreaming, onRewind, onFork, onSelectSession }: {
  content: string;
  timestamp: number;
  messageIndex?: number;
  forks?: ForkInfo[];
  isStreaming: boolean;
  onRewind?: (i: number) => void;
  onFork?: (i: number) => void;
  onSelectSession?: (id: string) => void;
}) {
  const showActions = messageIndex !== undefined && !isStreaming && !!(onRewind || onFork);

  return (
    <div className="flex justify-end">
      <div className="max-w-[85%]">
        <div className="bg-primary text-primary-foreground rounded-2xl rounded-br-md px-4 py-3">
          <div className="text-sm leading-relaxed whitespace-pre-wrap">{content}</div>
        </div>
        <div className="flex items-center justify-end gap-2 mt-1 pr-1">
          {forks && forks.length > 0 && (
            <ForkIndicator forks={forks} onSelectSession={onSelectSession} />
          )}
          {showActions && messageIndex !== undefined && (
            <MessageActions
              messageIndex={messageIndex}
              isStreaming={isStreaming}
              onRewind={onRewind}
              onFork={onFork}
            />
          )}
          <span className="text-[10px] text-muted-foreground/50">
            {formatTime(timestamp)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Assistant Turn ──────────────────────────────────────────────────────────

function AssistantTurn({ message }: {
  message: MessageItemProps['message'];
}) {
  const { segments, displayContent } = useMessageSegments(message);

  const hasSegments = segments.length > 0;
  const hasLegacyTools = !hasSegments && !!message.toolCalls?.length;

  return (
    <div className="space-y-2">
      {/* Render each segment in order */}
      {segments.map((seg, i) => {
        switch (seg.kind) {
          case 'thinking':
            return <ThinkingSegment key={`thinking-${i}`} blocks={seg.blocks} />;
          case 'activity':
            return <ActivitySegment key={`activity-${i}`} blocks={seg.blocks} isStreaming={message.isStreaming} />;
          case 'text':
            return <TextSegment key={`text-${i}`} blocks={seg.blocks} isStreaming={message.isStreaming} />;
          case 'question':
            return <QuestionCard key={`question-${seg.block.id}`} block={seg.block} />;
        }
      })}

      {/* Legacy tool calls (messages without content blocks) */}
      {hasLegacyTools && (
        <LegacyToolCalls toolCalls={message.toolCalls!} toolResults={message.toolResults} />
      )}

      {/* Streaming fallback: show displayContent when no segments yet */}
      {message.isStreaming && !hasSegments && !hasLegacyTools && (
        displayContent.trim()
          ? (
            <div className="bg-background border border-border/50 rounded-lg shadow-sm px-5 py-3">
              <div className="text-sm leading-relaxed">
                <Markdown content={displayContent} />
              </div>
            </div>
          )
          : (
            <div className="flex items-center gap-2 py-1 text-[13px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              <span>Thinking...</span>
            </div>
          )
      )}
    </div>
  );
}

// ─── Root Component ──────────────────────────────────────────────────────────

export default function MessageItem({
  message, messageIndex, forks, onRewind, onFork, onSelectSession,
}: MessageItemProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`group/msg py-3 px-6`}>
      <div className="max-w-3xl mx-auto">
        {isUser ? (
          <UserBubble
            content={message.content}
            timestamp={message.timestamp}
            messageIndex={messageIndex}
            forks={forks}
            isStreaming={message.isStreaming}
            onRewind={onRewind}
            onFork={onFork}
            onSelectSession={onSelectSession}
          />
        ) : (
          <AssistantTurn message={message} />
        )}
      </div>
    </div>
  );
}
