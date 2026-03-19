/**
 * ArtifactContent - Rendered markdown with hoverable blocks for inline comments.
 *
 * Renders the full markdown content as one block (preserving multi-line constructs
 * like code fences, tables, and lists). Comments appear in a list below the content.
 */

import { useState, useCallback, useMemo } from 'react';
import { Plus, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Markdown from '../Messages/Markdown';
import type { ArtifactComment } from '@/services/types';

type CommentSeverity = ArtifactComment['severity'];

interface ArtifactContentProps {
  content: string;
  comments: ArtifactComment[];
  onAddComment: (line: number, text: string, severity: CommentSeverity) => void;
}

const SEVERITY_STYLES: Record<CommentSeverity, { chip: string; border: string; label: string }> = {
  suggestion: { chip: 'bg-palette-info/15 text-palette-info', border: 'border-l-palette-info', label: 'suggestion' },
  issue: { chip: 'bg-palette-danger/15 text-palette-danger', border: 'border-l-palette-danger', label: 'issue' },
  question: { chip: 'bg-palette-warning/15 text-palette-warning', border: 'border-l-palette-warning', label: 'question' },
  praise: { chip: 'bg-palette-success/15 text-palette-success', border: 'border-l-palette-success', label: 'praise' },
};

const SEVERITY_OPTIONS: CommentSeverity[] = ['suggestion', 'issue', 'question', 'praise'];

function InlineComment({ comment }: { comment: ArtifactComment }) {
  const isAgent = comment.author.type === 'agent';
  const sev = SEVERITY_STYLES[comment.severity];

  return (
    <div className={`ml-4 my-1 bg-neutral-bg-subtle border border-neutral-border rounded-md px-2.5 py-1.5 border-l-[3px] ${sev.border}`}>
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className={`text-[10px] font-semibold ${isAgent ? 'text-palette-warning' : 'text-palette-primary'}`}>
          {isAgent ? 'Agent' : 'You'}
        </span>
        <span className={`text-[9px] px-1 py-px rounded ${sev.chip} font-medium`}>
          {sev.label}
        </span>
      </div>
      <p className="text-xs leading-snug text-neutral-fg">{comment.content}</p>
    </div>
  );
}

function CommentForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (text: string, severity: CommentSeverity) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const [severity, setSeverity] = useState<CommentSeverity>('suggestion');

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed, severity);
  }, [text, severity, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
      if (e.key === 'Escape') onCancel();
    },
    [handleSubmit, onCancel],
  );

  return (
    <div className="my-2 bg-neutral-bg-subtle border border-neutral-border rounded-md p-2">
      <div className="flex gap-1 mb-1.5">
        {SEVERITY_OPTIONS.map((s) => (
          <button
            key={s}
            onClick={() => setSeverity(s)}
            className={`text-[10px] px-1.5 py-0.5 rounded font-medium transition-colors ${
              severity === s ? SEVERITY_STYLES[s].chip : 'text-neutral-fg-subtle hover:text-neutral-fg'
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Add a comment..."
        className="w-full bg-neutral-bg border border-neutral-border rounded px-2 py-1.5 text-xs text-neutral-fg placeholder:text-neutral-fg-subtle/40 resize-none outline-none focus:border-palette-primary min-h-[48px]"
        rows={2}
      />
      <div className="flex gap-1.5 mt-1.5">
        <Button size="xs" onClick={handleSubmit} disabled={!text.trim()}>
          Comment
        </Button>
        <Button size="xs" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * Render the full markdown content as a single block to preserve multi-line
 * constructs (code fences, tables, blockquotes, lists). All comments — both
 * anchored and general — appear in a list below the content. A "+" button in
 * the top-right corner of the content block adds a new general comment.
 */
export function ArtifactContent({ content, comments, onAddComment }: ArtifactContentProps) {
  const [showCommentForm, setShowCommentForm] = useState(false);

  const { anchoredComments, generalComments } = useMemo(() => {
    const anchored: ArtifactComment[] = [];
    const general: ArtifactComment[] = [];
    for (const c of comments) {
      if (c.anchor?.line != null) {
        anchored.push(c);
      } else {
        general.push(c);
      }
    }
    // Keep anchored comments in document order
    anchored.sort((a, b) => (a.anchor?.line ?? 0) - (b.anchor?.line ?? 0));
    return { anchoredComments: anchored, generalComments: general };
  }, [comments]);

  if (!content) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-fg-subtle text-sm">
        No content
      </div>
    );
  }

  const hasComments = anchoredComments.length > 0 || generalComments.length > 0;

  return (
    <div className="flex-1 overflow-y-auto p-3">
      {/* Full markdown rendered as one block — preserves code fences, tables, lists */}
      <div className="group relative">
        <Markdown
          content={content}
          className="prose prose-sm dark:prose-invert max-w-none [&>*]:relative [&>*:hover]:bg-palette-primary/5 [&>*]:rounded [&>*]:transition-colors"
        />
        <button
          onClick={() => setShowCommentForm(true)}
          className="absolute right-1 top-1 w-[18px] h-[18px] rounded-full bg-palette-primary text-white text-[11px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          title="Add comment"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>

      {showCommentForm && (
        <CommentForm
          onSubmit={(text, severity) => {
            onAddComment(0, text, severity);
            setShowCommentForm(false);
          }}
          onCancel={() => setShowCommentForm(false)}
        />
      )}

      {hasComments && (
        <div className="mt-4 pt-3 border-t border-neutral-border space-y-1">
          <div className="flex items-center gap-1.5 mb-2 text-neutral-fg-subtle">
            <MessageSquare className="h-3.5 w-3.5" />
            <span className="text-[10px] font-medium uppercase tracking-wider">Comments</span>
          </div>
          {anchoredComments.map((c) => (
            <InlineComment key={c.id} comment={c} />
          ))}
          {generalComments.map((c) => (
            <InlineComment key={c.id} comment={c} />
          ))}
        </div>
      )}
    </div>
  );
}
