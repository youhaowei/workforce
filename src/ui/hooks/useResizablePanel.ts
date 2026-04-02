/**
 * useResizablePanel — Drag-to-resize a sidebar panel with localStorage persistence.
 *
 * Returns the current pixel width, a boolean indicating active drag, and
 * an onMouseDown handler to attach to a resize handle element.
 *
 * Usage:
 *   const { width, isDragging, onResizeStart } = useResizablePanel({
 *     storageKey: 'workforce:sessions-panel-width',
 *     defaultWidth: 288,
 *     minWidth: 200,
 *     maxWidth: 500,
 *   });
 *   <div style={{ width }}>
 *     ...
 *     <div onMouseDown={onResizeStart} className="resize-handle" />
 *   </div>
 */

import { useState, useCallback, useRef, useEffect } from "react";

interface UseResizablePanelOptions {
  storageKey: string;
  defaultWidth: number;
  minWidth?: number;
  maxWidth?: number;
}

function readStoredWidth(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.min(max, Math.max(min, parsed));
      }
    }
  } catch {
    // localStorage unavailable — use fallback
  }
  return fallback;
}

export function useResizablePanel({
  storageKey,
  defaultWidth,
  minWidth = 200,
  maxWidth = 500,
}: UseResizablePanelOptions) {
  const [width, setWidth] = useState(() =>
    readStoredWidth(storageKey, defaultWidth, minWidth, maxWidth),
  );
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Clean up any active drag listeners if the component unmounts mid-drag
  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  // Persist width to localStorage on change (debounced to avoid writes during drag)
  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(persistTimeoutRef.current);
    persistTimeoutRef.current = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, String(Math.round(width)));
      } catch {
        /* noop */
      }
    }, 300);
    return () => clearTimeout(persistTimeoutRef.current);
  }, [width, storageKey]);

  const widthRef = useRef(width);
  widthRef.current = width;

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startXRef.current = e.clientX;
      startWidthRef.current = widthRef.current;
      setIsDragging(true);

      const onMouseMove = (moveEvent: MouseEvent) => {
        const dx = moveEvent.clientX - startXRef.current;
        const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidthRef.current + dx));
        setWidth(newWidth);
      };

      const detach = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        cleanupRef.current = null;
      };

      function onMouseUp() {
        setIsDragging(false);
        detach();
      }

      cleanupRef.current = detach;
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [minWidth, maxWidth],
  );

  return { width, isDragging, onResizeStart };
}
