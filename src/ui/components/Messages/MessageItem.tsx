/**
 * MessageItem — Individual message display.
 *
 * User messages: right-aligned bubble with actions below.
 * Assistant messages: chunked segments (thinking, activity, text, question).
 * Task tools rendered as collapsible group headers within activity segments.
 */

import { memo, useMemo, useCallback, type MouseEvent } from "react";
import { History, GitBranch, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMessagesStore } from "@/ui/stores/useMessagesStore";
import type { ContentBlock, ToolActivity } from "@/services/types";
import ToolOutput from "../Tools/ToolOutput";
import ContentBlockRenderer from "./ContentBlockRenderer";
import QuestionCard from "./QuestionCard";
import Markdown from "./Markdown";
import { segmentBlocks } from "./segmentBlocks";
import { ActivitySegment } from "./MessageActivitySegment";

export interface ForkInfo {
  sessionId: string;
  title?: string;
}

interface MessageItemProps {
  message: {
    id: string;
    role: "user" | "assistant" | "system";
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
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ─── Hover action buttons (emphasized) ───────────────────────────────────────

function MessageActions({
  messageIndex,
  isStreaming,
  onRewind,
  onFork,
}: {
  messageIndex: number;
  isStreaming: boolean;
  onRewind?: (messageIndex: number) => void;
  onFork?: (messageIndex: number) => void;
}) {
  const disabled = isStreaming;
  const handleRewind = (e: MouseEvent) => {
    e.stopPropagation();
    onRewind?.(messageIndex);
  };
  const handleFork = (e: MouseEvent) => {
    e.stopPropagation();
    onFork?.(messageIndex);
  };

  return (
    <span className="inline-flex items-center gap-1 opacity-0 group-hover/msg:opacity-100 transition-opacity">
      {onRewind && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[11px] gap-1 text-neutral-fg-subtle hover:text-neutral-fg border-neutral-border/60"
              disabled={disabled}
              onClick={handleRewind}
              aria-label="Rewind to here"
            >
              <History className="h-3 w-3" />
              Rewind
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            Rewind to here
          </TooltipContent>
        </Tooltip>
      )}
      {onFork && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[11px] gap-1 text-neutral-fg-subtle hover:text-neutral-fg border-neutral-border/60"
              disabled={disabled}
              onClick={handleFork}
              aria-label="Fork from here"
            >
              <GitBranch className="h-3 w-3" />
              Fork
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            Fork from here
          </TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}

function ForkIndicator({
  forks,
  onSelectSession,
}: {
  forks: ForkInfo[];
  onSelectSession?: (sessionId: string) => void;
}) {
  if (forks.length === 0) return null;
  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    onSelectSession?.(forks[0].sessionId);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-neutral-fg-subtle hover:text-neutral-fg transition-colors"
          onClick={handleClick}
        >
          <GitBranch className="h-3 w-3" />
          {forks.length > 1 && <span>{forks.length}</span>}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {forks.length === 1
          ? `Fork: ${forks[0].title ?? forks[0].sessionId.slice(0, 8)}`
          : forks.map((f) => f.title ?? f.sessionId.slice(0, 8)).join(", ")}
      </TooltipContent>
    </Tooltip>
  );
}

// ─── useMessageSegments hook ─────────────────────────────────────────────────

function useMessageSegments(message: MessageItemProps["message"]) {
  const streamingContent = useMessagesStore(
    useCallback(
      (s) => (message.isStreaming && s.streamingMessageId === message.id ? s.streamingContent : ""),
      [message.id, message.isStreaming],
    ),
  );
  const streamingBlocks = useMessagesStore(
    useCallback(
      (s) =>
        message.isStreaming && s.streamingMessageId === message.id
          ? s.streamingBlocks
          : EMPTY_BLOCKS,
      [message.id, message.isStreaming],
    ),
  );

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

const EMPTY_BLOCKS: ContentBlock[] = [];

// ─── Segment Components ──────────────────────────────────────────────────────

function ThinkingSegment({ blocks }: { blocks: ContentBlock[] }) {
  return (
    <>
      {blocks.map((block, i) => {
        if (block.type !== "thinking") return null;
        const isActive = block.status === "running";
        if (!block.text.trim() && !isActive) return null;
        return (
          <ContentBlockRenderer
            key={`thinking-${i}`}
            blocks={[block]}
            isStreaming={isActive}
            inline
          />
        );
      })}
    </>
  );
}

function TextSegment({ blocks, isStreaming }: { blocks: ContentBlock[]; isStreaming: boolean }) {
  const nonEmpty = blocks.filter((b) => b.type === "text" && b.text.trim().length > 0);
  if (nonEmpty.length === 0) return null;

  return (
    <div className="px-1">
      <div className="text-[13.5px] leading-[1.7]">
        <ContentBlockRenderer blocks={nonEmpty} isStreaming={isStreaming} />
      </div>
    </div>
  );
}

// ─── Legacy tool calls ───────────────────────────────────────────────────────

function getToolResult(
  toolCallId: string,
  toolResults?: Array<{ toolCallId: string; result?: unknown; error?: string }>,
) {
  return toolResults?.find((r) => r.toolCallId === toolCallId);
}

function LegacyToolCalls({
  toolCalls,
  toolResults,
}: {
  toolCalls: NonNullable<MessageItemProps["message"]["toolCalls"]>;
  toolResults: MessageItemProps["message"]["toolResults"];
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
            status={result ? "success" : "running"}
          />
        );
      })}
    </div>
  );
}

// ─── User Bubble ─────────────────────────────────────────────────────────────

function UserBubble({
  content,
  timestamp,
  messageIndex,
  forks,
  isStreaming,
  onRewind,
  onFork,
  onSelectSession,
}: {
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
        <div className="bg-neutral-fg/[0.06] rounded-2xl rounded-br-md px-4 py-3">
          <div className="text-[13.5px] leading-[1.7] whitespace-pre-wrap text-neutral-fg">
            {content}
          </div>
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
          <span className="text-[10px] text-neutral-fg-subtle/50">{formatTime(timestamp)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Assistant Turn ──────────────────────────────────────────────────────────

function AssistantTurn({ message }: { message: MessageItemProps["message"] }) {
  const { segments, displayContent } = useMessageSegments(message);

  const hasSegments = segments.length > 0;
  const hasLegacyTools = !hasSegments && !!message.toolCalls?.length;

  return (
    <div className="space-y-2">
      {/* Render each segment in order */}
      {segments.map((seg, i) => {
        switch (seg.kind) {
          case "thinking":
            return <ThinkingSegment key={`thinking-${i}`} blocks={seg.blocks} />;
          case "activity":
            return (
              <ActivitySegment
                key={`activity-${i}`}
                blocks={seg.blocks}
                isStreaming={message.isStreaming}
              />
            );
          case "text":
            return (
              <TextSegment
                key={`text-${i}`}
                blocks={seg.blocks}
                isStreaming={message.isStreaming}
              />
            );
          case "question":
            return <QuestionCard key={`question-${seg.block.id}`} block={seg.block} />;
        }
      })}

      {/* Legacy tool calls (messages without content blocks) */}
      {hasLegacyTools && (
        <LegacyToolCalls toolCalls={message.toolCalls!} toolResults={message.toolResults} />
      )}

      {/* Streaming fallback: show displayContent when no segments yet */}
      {message.isStreaming &&
        !hasSegments &&
        !hasLegacyTools &&
        (displayContent.trim() ? (
          <div className="px-1">
            <div className="text-[13.5px] leading-[1.7]">
              <Markdown content={displayContent} />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 py-1 text-[13px] text-neutral-fg-subtle">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-palette-primary" />
            <span>Thinking...</span>
          </div>
        ))}
    </div>
  );
}

// ─── Root Component ──────────────────────────────────────────────────────────

function MessageItem({
  message,
  messageIndex,
  forks,
  onRewind,
  onFork,
  onSelectSession,
}: MessageItemProps) {
  const isUser = message.role === "user";

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

function areForksEqual(a?: ForkInfo[], b?: ForkInfo[]) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]?.sessionId !== b[i]?.sessionId || a[i]?.title !== b[i]?.title) {
      return false;
    }
  }
  return true;
}

function areMessagePropsEqual(prev: MessageItemProps, next: MessageItemProps) {
  return (
    (prev.message === next.message ||
      (prev.message.id === next.message.id &&
        prev.message.role === next.message.role &&
        prev.message.content === next.message.content &&
        prev.message.timestamp === next.message.timestamp &&
        prev.message.isStreaming === next.message.isStreaming &&
        prev.message.toolCalls === next.message.toolCalls &&
        prev.message.toolResults === next.message.toolResults &&
        prev.message.toolActivities === next.message.toolActivities &&
        prev.message.contentBlocks === next.message.contentBlocks)) &&
    prev.messageIndex === next.messageIndex &&
    areForksEqual(prev.forks, next.forks) &&
    prev.onRewind === next.onRewind &&
    prev.onFork === next.onFork &&
    prev.onSelectSession === next.onSelectSession
  );
}

export default memo(MessageItem, areMessagePropsEqual);
