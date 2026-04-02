/**
 * UserStep — Step 1: Collect user display name.
 *
 * Shows a name input with live avatar preview (initials + deterministic color).
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/bridge/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowRight, Loader2 } from 'lucide-react';
import { colorFromName } from '@/shared/palette';

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

interface UserStepProps {
  onComplete: () => void;
}

export function UserStep({ onComplete }: UserStepProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');

  const createMutation = useMutation(
    trpc.user.create.mutationOptions({
      onSuccess: (user) => {
        // Synchronously update cache so SetupGate advances immediately
        queryClient.setQueryData(trpc.user.exists.queryKey(), true);
        queryClient.setQueryData(trpc.user.get.queryKey(), user);
        onComplete();
      },
      onError: (err) => {
        // User already exists (e.g., race with stale query) — update cache and advance
        if (err.data?.code === 'CONFLICT') {
          queryClient.setQueryData(trpc.user.exists.queryKey(), true);
          onComplete();
        }
      },
    }),
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    createMutation.mutate({ displayName: trimmed });
  };

  const initials = getInitials(name.trim());
  const color = name.trim() ? colorFromName(name.trim()) : '#94a3b8';

  return (
    <div className="w-full max-w-md px-6">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-semibold mb-2">Welcome to Workforce</h1>
        <p className="text-sm text-neutral-fg-subtle">What should we call you?</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Avatar preview */}
        <div className="flex justify-center">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center text-white text-xl font-semibold transition-colors"
            style={{ backgroundColor: color }}
          >
            {initials || '?'}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="user-name">Display Name</Label>
          <Input
            id="user-name"
            placeholder="Jane Doe"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>

        {createMutation.isError && createMutation.error?.data?.code !== 'CONFLICT' && (
          <p className="text-sm text-palette-danger">
            {createMutation.error?.message ?? 'Something went wrong. Please try again.'}
          </p>
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={!name.trim() || createMutation.isPending}>
            {createMutation.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                Continue
                <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
