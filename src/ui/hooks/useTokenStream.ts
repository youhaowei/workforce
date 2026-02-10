/**
 * useTokenStream — rAF-batched token accumulation for streaming.
 *
 * Tokens arrive faster than React can render. This hook accumulates
 * tokens in a ref and flushes to a callback on the next animation frame,
 * batching many deltas into a single state update.
 *
 * Pattern from craft-agents-oss: streaming via ref, not state.
 */

import { useCallback, useEffect, useRef } from 'react';

export function useTokenStream(onFlush: (batch: string) => void) {
  const bufferRef = useRef('');
  const rafRef = useRef<number | null>(null);
  const onFlushRef = useRef(onFlush);
  onFlushRef.current = onFlush;

  const push = useCallback((token: string) => {
    bufferRef.current += token;

    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        const batch = bufferRef.current;
        bufferRef.current = '';
        rafRef.current = null;
        onFlushRef.current(batch);
      });
    }
  }, []);

  // Cleanup pending rAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        // Flush remaining buffer
        if (bufferRef.current) {
          onFlushRef.current(bufferRef.current);
          bufferRef.current = '';
        }
      }
    };
  }, []);

  return push;
}
