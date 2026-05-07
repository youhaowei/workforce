interface StatusBarProps {
  cumulativeUsage: {
    inputTokens: number;
    outputTokens: number;
    totalCostUsd: number;
  };
  currentQueryStats: { durationMs: number } | null;
  messageCount: number;
}

export default function StatusBar({
  cumulativeUsage,
  currentQueryStats,
  messageCount,
}: StatusBarProps) {
  return (
    <footer className="flex-shrink-0 px-6 py-1.5">
      <div className="max-w-3xl mx-auto flex items-center justify-between text-[11px] text-neutral-fg-subtle/50 tabular-nums">
        <div className="flex items-center gap-3">
          {(cumulativeUsage.inputTokens > 0 || cumulativeUsage.outputTokens > 0) && (
            <span title="Input / Output tokens">
              {cumulativeUsage.inputTokens.toLocaleString()} in ·{" "}
              {cumulativeUsage.outputTokens.toLocaleString()} out
            </span>
          )}
          {cumulativeUsage.totalCostUsd > 0 && (
            <span title="Estimated cost">${cumulativeUsage.totalCostUsd.toFixed(4)}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {currentQueryStats && (
            <span title="Last query duration">
              {(currentQueryStats.durationMs / 1000).toFixed(1)}s
            </span>
          )}
          <span>{messageCount} msg</span>
        </div>
      </div>
    </footer>
  );
}
