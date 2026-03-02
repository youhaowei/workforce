/**
 * DiffViewer - Monospace diff display with line coloring.
 */

import { ScrollArea } from '@/components/ui/scroll-area';

interface DiffViewerProps {
  diff: string;
}

export function DiffViewer({ diff }: DiffViewerProps) {
  if (!diff.trim()) {
    return <p className="text-xs text-neutral-fg-subtle py-4 text-center">No changes</p>;
  }

  return (
    <ScrollArea className="max-h-96 rounded-md border">
      <pre className="p-3 text-xs font-mono leading-relaxed">
        {diff.split('\n').map((line, i) => {
          let className = '';
          if (line.startsWith('+') && !line.startsWith('+++')) className = 'text-green-600 bg-green-500/10';
          else if (line.startsWith('-') && !line.startsWith('---')) className = 'text-red-600 bg-red-500/10';
          else if (line.startsWith('@@')) className = 'text-blue-600';
          else if (line.startsWith('diff')) className = 'text-neutral-fg-subtle font-bold';

          return (
            <div key={i} className={className}>
              {line}
            </div>
          );
        })}
      </pre>
    </ScrollArea>
  );
}
