/**
 * CC Source Watcher — Watches a CC JSONL file for changes and emits events.
 * Debounces start to prevent file handle leaks on rapid session switches.
 */

import { watch } from "fs/promises";
import { getEventBus } from "@/shared/event-bus";
import { createLogger } from "tracey";

const log = createLogger("Session");
const DEBOUNCE_MS = 300;

export class CCSourceWatcher {
  private abort: AbortController | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  start(sessionId: string, ccSourcePath: string) {
    this.stop();

    // Debounce: wait before starting watcher to avoid leaks on rapid switches
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      const abort = new AbortController();
      this.abort = abort;

      (async () => {
        try {
          const watcher = watch(ccSourcePath, { signal: abort.signal });
          for await (const event of watcher) {
            if (event.eventType === "change") {
              log.info({ sessionId }, "CC source file changed");
              getEventBus().emit({
                type: "SessionChange",
                sessionId,
                action: "cc_source_changed",
                timestamp: Date.now(),
              });
            }
          }
        } catch (err) {
          if ((err as Error).name !== "AbortError") {
            log.warn({ sessionId, err }, "CC source watcher error");
          }
        }
      })();
    }, DEBOUNCE_MS);
  }

  stop() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.abort?.abort();
    this.abort = null;
  }
}
