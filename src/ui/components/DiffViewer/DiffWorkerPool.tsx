/**
 * DiffWorkerPool - Worker pool context provider for @pierre/diffs.
 *
 * Wraps the app in a WorkerPoolContextProvider so FileDiff/PatchDiff components
 * can offload syntax highlighting to web workers. Pool size adapts to CPU cores.
 */

import { type ReactNode, useMemo } from 'react';
import { WorkerPoolContextProvider } from '@pierre/diffs/react';
import DiffsWorker from '@pierre/diffs/worker/worker.js?worker';

export function DiffWorkerPool({ children }: { children: ReactNode }) {
  const poolSize = useMemo(() => {
    const cores = typeof navigator !== 'undefined'
      ? Math.max(1, navigator.hardwareConcurrency || 4)
      : 4;
    return Math.max(2, Math.min(4, Math.floor(cores / 2)));
  }, []);

  return (
    <WorkerPoolContextProvider
      poolOptions={{
        workerFactory: () => new DiffsWorker(),
        poolSize,
        totalASTLRUCacheSize: 120,
      }}
      highlighterOptions={{
        theme: 'pierre-dark',
        tokenizeMaxLineLength: 1000,
      }}
    >
      {children}
    </WorkerPoolContextProvider>
  );
}
