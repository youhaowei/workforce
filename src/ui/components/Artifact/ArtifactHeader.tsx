/**
 * ArtifactHeader - Panel header with artifact tabs.
 *
 * Single artifact: filename + status badge + close button.
 * Multiple artifacts: row of tabs (dot + filename), active tab highlighted, close on far right.
 */

import { X, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ArtifactStatus, Artifact } from '@/services/types';
import { MIME_DOT_COLOR, extractFilename, ARTIFACT_STATUS_STYLES, ARTIFACT_STATUS_LABELS } from '@/ui/lib/artifact-utils';

interface ArtifactHeaderProps {
  title: string;
  filePath: string;
  status: ArtifactStatus;
  artifacts: Artifact[];
  activeArtifactId: string | null;
  onSelectArtifact: (id: string) => void;
  onClose: () => void;
}


function SingleHeader({ filePath, status, onClose }: { filePath: string; status: ArtifactStatus; onClose: () => void }) {
  const filename = extractFilename(filePath);
  return (
    <div className="flex items-center gap-2 px-3 h-10 flex-shrink-0">
      <FileText className="h-4 w-4 text-neutral-fg-subtle flex-shrink-0" />
      <span className="text-sm font-semibold text-neutral-fg truncate flex-1 font-mono" title={filePath}>
        {filename}
      </span>
      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0 ${ARTIFACT_STATUS_STYLES[status]}`}>
        {ARTIFACT_STATUS_LABELS[status]}
      </span>
      <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0" onClick={onClose} title="Close">
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function TabbedHeader({ artifacts, activeArtifactId, onSelectArtifact, onClose }: {
  artifacts: Artifact[];
  activeArtifactId: string | null;
  onSelectArtifact: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex items-end h-10 bg-neutral-bg-subtle flex-shrink-0 overflow-hidden">
      <div className="flex items-end gap-px flex-1 overflow-x-auto px-1 h-full scrollbar-none">
        {artifacts.map((a) => {
          const filename = extractFilename(a.filePath);
          const isActive = a.id === activeArtifactId;
          return (
            <button
              key={a.id}
              onClick={() => onSelectArtifact(a.id)}
              className={`flex items-center gap-1.5 px-2.5 h-[28px] mt-auto rounded-t-md text-[10px] font-mono whitespace-nowrap transition-colors flex-shrink-0 ${
                isActive
                  ? 'bg-neutral-bg text-neutral-fg'
                  : 'text-neutral-fg-subtle hover:text-neutral-fg hover:bg-neutral-bg/50'
              }`}
            >
              <span className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${MIME_DOT_COLOR[a.mimeType] ?? 'bg-neutral-fg-subtle'}`} />
              <span className="truncate max-w-[120px]">{filename}</span>
              {isActive && (
                <span className={`text-[8px] px-1.5 py-px rounded font-semibold ${ARTIFACT_STATUS_STYLES[a.status]}`}>
                  {ARTIFACT_STATUS_LABELS[a.status]}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0 mr-1 mb-0.5" onClick={onClose} title="Close">
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export function ArtifactHeader(props: ArtifactHeaderProps) {
  const { artifacts, activeArtifactId, onSelectArtifact, onClose, filePath, status } = props;

  if (artifacts.length > 1) {
    return <TabbedHeader artifacts={artifacts} activeArtifactId={activeArtifactId} onSelectArtifact={onSelectArtifact} onClose={onClose} />;
  }

  return <SingleHeader filePath={filePath} status={status} onClose={onClose} />;
}
