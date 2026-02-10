/**
 * ToolCard - Compact tool status card for sidebars/overlays.
 */

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';
import type { ToolUIState } from '@ui/stores/useToolStore';

interface ToolCardProps {
  tool: ToolUIState;
  onClick?: () => void;
}

function statusVariant(status: ToolUIState['status']): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'running': return 'default';
    case 'success': return 'secondary';
    case 'failed':
    case 'cancelled': return 'destructive';
    default: return 'outline';
  }
}

export default function ToolCard({ tool, onClick }: ToolCardProps) {
  const formatDuration = (duration?: number) => {
    if (duration === undefined) return null;
    if (duration < 1000) return `${duration}ms`;
    return `${(duration / 1000).toFixed(1)}s`;
  };

  const getPreview = (): string => {
    if (tool.error) return `Error: ${tool.error}`;
    if (tool.result !== undefined) {
      const str = typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result);
      return str.slice(0, 100) + (str.length > 100 ? '...' : '');
    }
    if (tool.args) return `Args: ${JSON.stringify(tool.args).slice(0, 80)}...`;
    return '';
  };

  const preview = getPreview();

  return (
    <Card
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? `View ${tool.name} details` : undefined}
      className="cursor-pointer transition-all hover:shadow-md"
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {tool.status === 'running' && <Loader2 className="h-3 w-3 animate-spin" />}
            {tool.status === 'success' && <CheckCircle className="h-3 w-3 text-primary" />}
            {(tool.status === 'failed' || tool.status === 'cancelled') && <XCircle className="h-3 w-3 text-destructive" />}
            <span className="font-mono text-sm font-medium">{tool.name}</span>
            <Badge variant={statusVariant(tool.status)} className="text-[10px]">{tool.status}</Badge>
          </div>
          {tool.duration !== undefined && (
            <span className="text-xs text-muted-foreground">{formatDuration(tool.duration)}</span>
          )}
        </div>
        {preview && (
          <div className="mt-2 text-xs text-muted-foreground truncate">{preview}</div>
        )}
      </CardContent>
    </Card>
  );
}
