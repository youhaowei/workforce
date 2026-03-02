/**
 * ContentBlockRenderer — Renders ContentBlock[] as flat activity rows.
 *
 * Text blocks render as inline text with icon (in activity context)
 * or as Markdown (in response context).
 * Tool_use blocks as flat InlineToolCard rows.
 * Thinking blocks as expandable "Thinking..." lines.
 */

import { useState } from 'react';
import { Loader2, MessageCircleDashed, ChevronRight, Check } from 'lucide-react';
import type { ContentBlock } from '@/services/types';
import { stripMarkdown } from '@/ui/formatters';
import Markdown from './Markdown';
import InlineToolCard from './InlineToolCard';

interface ContentBlockRendererProps {
  blocks: ContentBlock[];
  isStreaming?: boolean;
  /** When true, render text blocks as inline flat lines (activity context) */
  inline?: boolean;
}

function ThinkingRow({ text, isActive }: { text: string; isActive: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = text.trim().length > 0;

  return (
    <div>
      <div
        role={hasContent ? 'button' : undefined}
        tabIndex={hasContent ? 0 : undefined}
        onClick={() => hasContent && setExpanded((p) => !p)}
        onKeyDown={(e) => { if (hasContent && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setExpanded((p) => !p); } }}
        className={`flex items-center gap-2 py-0.5 text-[13px] text-neutral-fg-subtle ${hasContent ? 'cursor-pointer hover:text-neutral-fg' : ''}`}
      >
        {isActive
          ? <Loader2 className="h-3.5 w-3.5 animate-spin text-palette-primary shrink-0" />
          : <span className="shrink-0 w-4 h-4 rounded-full bg-emerald-500/15 inline-flex items-center justify-center">
              <Check className="h-2.5 w-2.5 text-emerald-500" />
            </span>}
        <span>{isActive ? 'Thinking...' : 'Thought'}</span>
        {hasContent && (
          <ChevronRight className={`h-3 w-3 text-neutral-fg-subtle/40 transition-transform shrink-0 ${expanded ? 'rotate-90' : ''}`} />
        )}
      </div>
      {expanded && hasContent && (
        <div className="ml-6 pl-2 border-l-2 border-neutral-border py-1.5 text-[12px] font-mono text-neutral-fg-subtle/80 whitespace-pre-wrap max-h-40 overflow-y-auto leading-relaxed">
          {text}
        </div>
      )}
    </div>
  );
}

export default function ContentBlockRenderer({ blocks, inline }: ContentBlockRendererProps) {
  return (
    <>
      {blocks.map((block, i) => {
        const key = block.type === 'tool_use' ? `tool-${block.id}` : `${block.type}-${i}`;

        switch (block.type) {
          case 'text': {
            if (!block.text.trim()) return null;
            const isActive = block.status === 'running';
            // Inline mode: flat line with icon (used in activity section)
            if (inline) {
              return (
                <div key={key} className="flex items-start gap-2 py-0.5 text-[13px] text-neutral-fg/75">
                  {isActive
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin text-palette-primary shrink-0 mt-0.5" />
                    : <MessageCircleDashed className="h-3.5 w-3.5 text-neutral-fg-subtle/50 shrink-0 mt-0.5" />}
                  <span className="line-clamp-2">{stripMarkdown(block.text)}</span>
                </div>
              );
            }
            // Full mode: rendered markdown (used in response section)
            return (
              <div key={key} className={isActive ? 'streaming-cursor' : ''}>
                <Markdown content={block.text} />
              </div>
            );
          }
          case 'tool_use':
            return <InlineToolCard key={key} block={block} />;
          case 'thinking': {
            const isActive = block.status === 'running';
            // Don't render empty thinking blocks (model may emit start+stop with no deltas)
            if (!block.text.trim() && !isActive) return null;
            return <ThinkingRow key={key} text={block.text} isActive={isActive} />;
          }
        }
      })}
    </>
  );
}
