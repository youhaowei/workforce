/**
 * ContentBlockRenderer — Renders a ContentBlock[] sequentially.
 *
 * Text blocks render as Markdown, tool_use blocks as InlineToolCard,
 * and thinking blocks as a collapsible indicator.
 */

import type { ContentBlock } from '@/services/types';
import Markdown from './Markdown';
import InlineToolCard from './InlineToolCard';

interface ContentBlockRendererProps {
  blocks: ContentBlock[];
  isStreaming?: boolean;
}

export default function ContentBlockRenderer({ blocks, isStreaming }: ContentBlockRendererProps) {
  return (
    <>
      {blocks.map((block, i) => {
        const key = block.type === 'tool_use' ? `tool-${block.id}` : `${block.type}-${i}`;
        const isLastBlock = i === blocks.length - 1;

        switch (block.type) {
          case 'text':
            return (
              <div key={key} className={isStreaming && isLastBlock ? 'streaming-cursor' : ''}>
                <Markdown content={block.text} />
              </div>
            );
          case 'tool_use':
            return <InlineToolCard key={key} block={block} />;
          case 'thinking':
            return (
              <details key={key} className="my-1.5 text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  thinking...
                </summary>
                <div className="mt-1 pl-3 border-l border-border text-muted-foreground whitespace-pre-wrap">
                  {block.text}
                </div>
              </details>
            );
        }
      })}
    </>
  );
}
