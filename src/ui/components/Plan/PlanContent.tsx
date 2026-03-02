/**
 * PlanContent - Renders the plan markdown file in the center of PlanPanel.
 */

import Markdown from '../Messages/Markdown';

interface PlanContentProps {
  content: string;
  error?: string | null;
}

export function PlanContent({ content, error }: PlanContentProps) {
  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-palette-danger text-sm px-6">
        Failed to load plan: {error}
      </div>
    );
  }

  if (!content) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-fg-subtle text-sm">
        Loading plan...
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4">
      <Markdown content={content} className="prose prose-sm dark:prose-invert max-w-none" />
    </div>
  );
}
