/**
 * StreamingMessage - Live streaming message indicator with content preview.
 */

import { useMessagesStore } from '@/ui/stores/useMessagesStore';
import { Loader2 } from 'lucide-react';

export default function StreamingMessage() {
  const content = useMessagesStore((s) => s.streamingContent);
  const isStreaming = useMessagesStore((s) => s.isStreaming);

  if (!content && !isStreaming) return null;

  return (
    <div className="py-4 px-6 bg-neutral-bg-dim/30">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-semibold text-palette-primary">assistant</span>
          <div className="text-xs text-neutral-fg-subtle flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>streaming...</span>
          </div>
        </div>

        <div className="text-sm leading-relaxed text-neutral-fg whitespace-pre-wrap border-l-2 border-palette-primary pl-3">
          {content}
          <span className="inline-block w-2 h-4 bg-palette-primary animate-pulse ml-0.5 align-text-bottom" />
        </div>
      </div>
    </div>
  );
}
