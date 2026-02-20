/**
 * useDirectoryPicker — Opens a native folder picker on Tauri, no-op on web.
 *
 * Returns `pick()` which resolves to the selected directory path, or null
 * if the user cancelled. On web, `pick` is null (callers should hide the
 * browse button).
 */

import { useCallback, useState } from 'react';
import { usePlatform } from '@/ui/context/PlatformProvider';

interface UseDirectoryPickerResult {
  /** Call to open the native folder picker. null when not available (web). */
  pick: (() => Promise<string | null>) | null;
  /** True while the native dialog is open. */
  isPicking: boolean;
}

export function useDirectoryPicker(): UseDirectoryPickerResult {
  const { isTauri } = usePlatform();
  const [isPicking, setIsPicking] = useState(false);

  const pick = useCallback(async (): Promise<string | null> => {
    setIsPicking(true);
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ directory: true, multiple: false });
      // With directory: true, multiple: false → returns string | null
      return selected as string | null;
    } catch (err) {
      console.warn('Directory picker failed:', err);
      return null;
    } finally {
      setIsPicking(false);
    }
  }, []);

  return { pick: isTauri ? pick : null, isPicking };
}
