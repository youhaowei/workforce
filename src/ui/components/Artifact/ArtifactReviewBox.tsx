/**
 * ArtifactReviewBox - Review controls at the bottom of the artifact panel.
 *
 * Shows pending comment chips, general feedback textarea, action buttons
 * (Submit Review / Approve / Request Changes), and a generated prompt preview.
 */

import { useState, useMemo, useCallback } from 'react';
import { ChevronDown, ChevronUp, Check, X, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ArtifactComment } from '@/services/types';
import { generateReviewPrompt } from '@/ui/lib/artifact-utils';

interface ArtifactReviewBoxProps {
  comments: ArtifactComment[];
  artifactTitle: string;
  isPlanArtifact: boolean;
  onSubmitReview: (summary: string) => void;
  onApprove: () => void;
  onReject: () => void;
}

export function ArtifactReviewBox({
  comments,
  artifactTitle,
  isPlanArtifact: _isPlanArtifact,
  onSubmitReview,
  onApprove,
  onReject,
}: ArtifactReviewBoxProps) {
  const [summary, setSummary] = useState('');
  const [promptExpanded, setPromptExpanded] = useState(false);

  const prompt = useMemo(
    () => generateReviewPrompt(artifactTitle, comments, summary),
    [artifactTitle, comments, summary],
  );

  const handleSubmit = useCallback(() => {
    onSubmitReview(summary.trim());
    setSummary('');
  }, [summary, onSubmitReview]);

  return (
    <div className="border-t border-neutral-border bg-neutral-bg flex-shrink-0">
      {/* Header + comment count */}
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <span className="text-xs font-semibold text-neutral-fg">Your Review</span>
        <span className="text-[10px] text-neutral-fg-subtle">
          {comments.length > 0 ? `${comments.length} comment${comments.length === 1 ? '' : 's'}` : 'No comments yet'}
        </span>
      </div>

      {/* Comment chips */}
      {comments.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pb-1.5">
          {comments.map((c) => (
            <span
              key={c.id}
              className="text-[10px] px-1.5 py-0.5 rounded bg-palette-primary/10 text-palette-primary border border-palette-primary/15 max-w-[180px] truncate"
              title={c.content}
            >
              {c.content}
            </span>
          ))}
        </div>
      )}

      {/* General feedback textarea */}
      <div className="px-3 pb-1.5">
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="General feedback or instructions..."
          className="w-full bg-neutral-bg-subtle border border-neutral-border rounded-md text-xs text-neutral-fg px-2.5 py-1.5 resize-none outline-none focus:border-palette-primary placeholder:text-neutral-fg-subtle/40 min-h-[32px]"
          rows={2}
        />
      </div>

      {/* Action buttons — single Approve button (permission mode comes from toolbar) */}
      <div className="flex items-center gap-1.5 px-3 pb-2">
        <Button size="xs" onClick={handleSubmit} className="gap-1">
          <Send className="h-3 w-3" />
          Submit Review
        </Button>

        <Button size="xs" color="success" className="gap-1" onClick={onApprove}>
          <Check className="h-3 w-3" />
          Approve
        </Button>

        <Button size="xs" variant="soft" color="danger" className="gap-1" onClick={onReject}>
          <X className="h-3 w-3" />
          Request Changes
        </Button>

        <span className="ml-auto text-[9px] text-neutral-fg-subtle">Sends as next prompt</span>
      </div>

      {/* Generated prompt preview */}
      {(comments.length > 0 || summary.trim()) && (
        <div className="border-t border-neutral-border">
          <button
            onClick={() => setPromptExpanded(!promptExpanded)}
            className="flex items-center gap-1 px-3 py-1 text-[9px] text-neutral-fg-subtle uppercase tracking-wider hover:text-neutral-fg transition-colors w-full"
          >
            {promptExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
            Generated prompt
          </button>
          {promptExpanded && (
            <div className="px-3 pb-2 max-h-[100px] overflow-y-auto">
              <pre className="text-[10px] text-neutral-fg leading-relaxed font-mono whitespace-pre-wrap">
                {prompt}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
