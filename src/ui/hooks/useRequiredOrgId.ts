import { useOrgStore } from '@/ui/stores/useOrgStore';

/**
 * Returns the current org ID, guaranteed non-null.
 *
 * Only safe to call inside the SetupGate boundary (Shell and its descendants).
 * Throws if called before an org is selected — use the nullable
 * `useOrgStore((s) => s.currentOrgId)` outside the gate.
 */
export function useRequiredOrgId(): string {
  const orgId = useOrgStore((s) => s.currentOrgId);
  if (!orgId) throw new Error('useRequiredOrgId called outside SetupGate boundary');
  return orgId;
}
