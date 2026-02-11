interface StatusBarProps {
  isStreaming: boolean;
  cumulativeUsage: {
    inputTokens: number;
    outputTokens: number;
    totalCostUsd: number;
  };
  currentQueryStats: { durationMs: number } | null;
  messageCount: number;
}

export default function StatusBar({
  isStreaming,
  cumulativeUsage,
  currentQueryStats,
  messageCount,
}: StatusBarProps) {
  return (
    <footer className="flex-shrink-0 px-4 py-1.5 border-t bg-background">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isStreaming ? 'bg-primary status-active' : 'bg-muted-foreground/40'
            }`}
          />
          <span>{isStreaming ? 'Thinking...' : 'Ready'}</span>
        </div>
        <div className="flex items-center gap-3">
          {(cumulativeUsage.inputTokens > 0 || cumulativeUsage.outputTokens > 0) && (
            <span title="Input / Output tokens">
              {cumulativeUsage.inputTokens.toLocaleString()} / {cumulativeUsage.outputTokens.toLocaleString()} tokens
            </span>
          )}
          {cumulativeUsage.totalCostUsd > 0 && (
            <span className="text-foreground" title="Estimated cost">
              ${cumulativeUsage.totalCostUsd.toFixed(4)}
            </span>
          )}
          {currentQueryStats && (
            <span title="Last query duration">
              {(currentQueryStats.durationMs / 1000).toFixed(1)}s
            </span>
          )}
          <span>{messageCount} messages</span>
        </div>
      </div>
    </footer>
  );
}
