/**
 * Relative time formatting for session/task timestamps.
 *
 * Two styles:
 * - "compact": "3h", "2d" (for tight spaces like session list items)
 * - "verbose": "3h ago", "2d ago" (for dialogs, tooltips)
 *
 * Max granularity is days (e.g. "45d"). Add week/month buckets
 * if the session list regularly shows entries older than ~30 days.
 */
export function timeAgo(ts: number, style: 'compact' | 'verbose' = 'compact') {
  const diff = Date.now() - ts;
  if (diff < 0) return 'just now';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  const suffix = style === 'verbose' ? ' ago' : '';
  if (minutes < 60) return `${minutes}m${suffix}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h${suffix}`;
  const days = Math.floor(hours / 24);
  return `${days}d${suffix}`;
}
