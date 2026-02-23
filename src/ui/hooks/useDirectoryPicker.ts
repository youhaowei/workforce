/**
 * useDirectoryPicker — Opens a native folder picker via tRPC, no-op on web.
 *
 * Returns `pick()` which resolves to the selected directory path, or null
 * if the user cancelled. On web, `pick` is null (callers should hide the
 * browse button).
 */

import { useCallback, useState } from 'react';
import { usePlatform } from '@/ui/context/PlatformProvider';
import { trpc } from '@/bridge/trpc';

interface UseDirectoryPickerResult {
  /** Call to open the native folder picker. null when not available (web). */
  pick: (() => Promise<string | null>) | null;
  /** True while the native dialog is open. */
  isPicking: boolean;
}

export function useDirectoryPicker(): UseDirectoryPickerResult {
  const { isDesktop } = usePlatform();
  const [isPicking, setIsPicking] = useState(false);

  const pick = useCallback(async (): Promise<string | null> => {
    setIsPicking(true);
    try {
      const result = await trpc.dialog.openDirectory.mutate();
      return result.path;
    } catch (err) {
      console.warn('Directory picker failed:', err);
      return null;
    } finally {
      setIsPicking(false);
    }
  }, []);

  return { pick: isDesktop ? pick : null, isPicking };
}
