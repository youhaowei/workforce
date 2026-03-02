/**
 * SetupGate — Sequential prerequisite gate before the main Shell.
 *
 * Checks four conditions in order and resolves each before advancing:
 *   1. USER — user identity exists
 *   2. ORG — at least one org exists (create if zero)
 *   3. SELECT — an org is currently active
 *   4. INIT — the active org has been initialized
 *
 * A returning user with an initialized org skips all steps.
 */

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/bridge/react';
import { useOrgStore } from '@/ui/stores/useOrgStore';
import { Loader2 } from 'lucide-react';
import type { Org } from '@/services/types';

import { SERVER_URL } from '@/bridge/config';
import { UserStep } from './UserStep';
import { CreateOrgStep } from './CreateOrgStep';
import { SelectOrgStep } from './SelectOrgStep';
import { InitOrgStep } from './InitOrgStep';

const HEALTH_URL = `${SERVER_URL}/health`;

type SetupStep = 'loading' | 'user' | 'create-org' | 'select-org' | 'init-org' | 'done';

function useServerHealth() {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (connected) return; // Already connected, stop polling
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(HEALTH_URL);
        if (res.ok && !cancelled) setConnected(true);
      } catch {
        // not ready yet
      }
    };
    check();
    const interval = setInterval(() => {
      if (!cancelled) check();
    }, 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [connected]);

  return connected;
}

function resolveStep(
  isLoading: boolean,
  userExists: boolean | undefined,
  orgList: Org[] | undefined,
  currentOrg: Org | null | undefined,
  orgId: string | null,
): SetupStep {
  if (isLoading) return 'loading';
  if (userExists === undefined) return 'loading';
  if (userExists === false) return 'user';

  const orgs = orgList ?? [];
  if (orgs.length === 0) return 'create-org';

  const activeOrg = currentOrg ?? (orgId ? orgs.find((o) => o.id === orgId) : null);
  if (!activeOrg) return 'select-org';
  if (!activeOrg.initialized) return 'init-org';

  // Shell uses useRequiredOrgId() which reads from Zustand.
  // The useEffect that syncs currentOrg.id → Zustand fires after render,
  // so wait until orgId is set before mounting Shell.
  if (!orgId) return 'loading';

  return 'done';
}

function StepRenderer({
  step,
  user,
  orgList,
  currentOrg,
  orgId,
  onComplete,
}: {
  step: SetupStep;
  user: { displayName: string } | null | undefined;
  orgList: Org[] | undefined;
  currentOrg: Org | null | undefined;
  orgId: string | null;
  onComplete: () => void;
}) {
  const resolvedOrg = currentOrg ?? (orgId && orgList ? orgList.find((o) => o.id === orgId) : null);

  switch (step) {
    case 'user':
      return <UserStep onComplete={onComplete} />;
    case 'create-org':
      return user ? <CreateOrgStep userName={user.displayName} onComplete={onComplete} /> : null;
    case 'select-org':
      return orgList ? <SelectOrgStep orgs={orgList} onComplete={onComplete} /> : null;
    case 'init-org':
      return resolvedOrg ? <InitOrgStep org={resolvedOrg} onComplete={onComplete} /> : null;
    default:
      return null;
  }
}

export function SetupGate({ children }: { children: React.ReactNode }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const setCurrentOrgId = useOrgStore((s) => s.setCurrentOrgId);
  const orgId = useOrgStore((s) => s.currentOrgId);
  const serverConnected = useServerHealth();

  // Eagerly preload models as soon as server is up so the model list is ready
  // by the time the user interacts with the model selector. We do NOT gate the
  // Shell on this — the UI falls back to seed/cached models from localStorage
  // and updates once the real list arrives.
  useQuery(
    trpc.agent.supportedModels.queryOptions(undefined, {
      enabled: serverConnected,
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    }),
  );

  // Data queries (enabled once server is up)
  const { data: userExists, isLoading: isLoadingUserExists } = useQuery(
    trpc.user.exists.queryOptions(undefined, { enabled: serverConnected }),
  );
  const { data: user, isLoading: isLoadingUser } = useQuery(
    trpc.user.get.queryOptions(undefined, { enabled: serverConnected && userExists === true }),
  );
  const { data: orgList, isLoading: isLoadingOrgs } = useQuery(
    trpc.org.list.queryOptions(undefined, { enabled: serverConnected && userExists === true }),
  );
  const { data: currentOrg, isLoading: isLoadingCurrent } = useQuery(
    trpc.org.getCurrent.queryOptions(undefined, { enabled: serverConnected && userExists === true }),
  );

  // Auto-set org from server if available (returning user)
  useEffect(() => {
    if (currentOrg?.id && !orgId) setCurrentOrgId(currentOrg.id);
  }, [currentOrg, orgId, setCurrentOrgId]);

  const isLoading = !serverConnected
    || isLoadingUserExists
    || (userExists === true && (isLoadingUser || isLoadingOrgs || isLoadingCurrent));

  const step = resolveStep(isLoading, userExists, orgList, currentOrg, orgId);

  const handleComplete = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['user'] });
    queryClient.invalidateQueries({ queryKey: ['org'] });
  }, [queryClient]);

  if (step === 'done') return <>{children}</>;

  if (step === 'loading') {
    return (
      <div className="h-screen flex items-center justify-center bg-neutral-bg">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 mx-auto animate-spin text-neutral-fg-subtle" />
          <p className="text-sm text-neutral-fg-subtle">
            {!serverConnected ? 'Connecting to server...' : 'Loading...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex items-center justify-center bg-neutral-bg">
      <StepRenderer
        step={step}
        user={user}
        orgList={orgList}
        currentOrg={currentOrg}
        orgId={orgId}
        onComplete={handleComplete}
      />
    </div>
  );
}
