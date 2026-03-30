/**
 * DiffFileList - File change summary with +/- badges.
 *
 * Shows a list of changed files from a branch diff. Clicking a file
 * opens its diff in the artifact panel.
 */

import type { BranchDiffFile } from '@/services/git';

function shortenPath(path: string) {
  const parts = path.split('/');
  return parts.length > 2
    ? `.../${parts[parts.length - 2]}/${parts[parts.length - 1]}`
    : path;
}

export interface DiffFileListProps {
  files: BranchDiffFile[];
  activeFile?: string | null;
  onSelectFile: (path: string) => void;
}

export function DiffFileList({ files, activeFile, onSelectFile }: DiffFileListProps) {
  if (files.length === 0) return null;

  const totalAdded = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeleted = files.reduce((sum, f) => sum + f.deletions, 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-neutral-fg-subtle">
          Changes ({files.length})
        </span>
        <span className="text-[10px] font-mono text-neutral-fg-subtle">
          <span className="text-palette-success">+{totalAdded}</span>
          {' '}
          <span className="text-palette-danger">-{totalDeleted}</span>
        </span>
      </div>
      <div className="space-y-0.5">
        {files.map((file) => (
          <button
            key={file.path}
            onClick={() => onSelectFile(file.path)}
            className={`w-full text-left text-xs rounded px-2 py-1.5 flex items-center gap-1.5 transition-colors ${
              file.path === activeFile
                ? 'bg-palette-primary/10 text-neutral-fg'
                : 'bg-neutral-bg-dim/50 hover:bg-neutral-bg-dim text-neutral-fg-subtle'
            }`}
            title={file.path}
          >
            <span className="font-mono truncate flex-1">{shortenPath(file.path)}</span>
            <span className="flex items-center gap-1 text-[10px] font-mono flex-shrink-0">
              {file.additions > 0 && (
                <span className="text-palette-success">+{file.additions}</span>
              )}
              {file.deletions > 0 && (
                <span className="text-palette-danger">-{file.deletions}</span>
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
