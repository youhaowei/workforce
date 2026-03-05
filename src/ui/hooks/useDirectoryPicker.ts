/**
 * useDirectoryPicker — Opens a native folder picker via Tauri command, no-op on web.
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
  const { openDirectory } = usePlatform();
  const [isPicking, setIsPicking] = useState(false);

  const pick = useCallback(async (): Promise<string | null> => {
    if (!openDirectory) return null;
    setIsPicking(true);
    try {
      return await openDirectory();
    } catch (err) {
      console.warn('Directory picker failed:', err);
      return null;
    } finally {
      setIsPicking(false);
    }
  }, [openDirectory]);

  return { pick: openDirectory ? pick : null, isPicking };
}
