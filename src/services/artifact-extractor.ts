/**
 * Artifact Extractor — Extract plan artifacts from CC session journal records.
 *
 * Scans JournalToolCall records for the pattern:
 *   EnterPlanMode → Write(*.md) → ExitPlanMode
 *
 * The Write tool call's input contains { file_path, content }, so the plan
 * content is available even if the file was later deleted from disk.
 */

import type { AnyJournalRecord, JournalToolCall } from "./types";
import { createLogger } from "tracey";

const log = createLogger("ArtifactExtractor");

export interface ExtractedPlan {
  filePath: string;
  title: string;
  content: string;
  /** Timestamp of the Write tool call */
  timestamp: number;
}

/**
 * Extract plan artifacts from a sequence of journal records.
 *
 * Detects `EnterPlanMode → Write(*.md) → ExitPlanMode` sequences and
 * returns the plan file path + content from the last Write before ExitPlanMode.
 */
/** Deduplicate writes by path (last write wins) and extract plan metadata. */
function flushPendingWrites(
  writes: Array<{ filePath: string; content: string; ts: number }>,
): ExtractedPlan[] {
  const byPath = new Map<string, { filePath: string; content: string; ts: number }>();
  for (const w of writes) byPath.set(w.filePath, w);

  return [...byPath.values()].map((write) => {
    const titleMatch = write.content.match(/^#\s+(.+)$/m);
    const title = titleMatch
      ? titleMatch[1].trim()
      : (write.filePath.split("/").pop()?.replace(/\.md$/, "") ?? "Plan");
    return { filePath: write.filePath, title, content: write.content, timestamp: write.ts };
  });
}

export function extractPlansFromRecords(records: readonly AnyJournalRecord[]): ExtractedPlan[] {
  const plans: ExtractedPlan[] = [];
  const toolCalls = records.filter((r): r is JournalToolCall => r.t === "tool_call");

  let inPlanMode = false;
  let pendingWrites: Array<{ filePath: string; content: string; ts: number }> = [];

  for (const tc of toolCalls) {
    if (tc.name === "EnterPlanMode") {
      inPlanMode = true;
      pendingWrites = [];
      continue;
    }

    if (tc.name === "ExitPlanMode") {
      if (inPlanMode && pendingWrites.length > 0) {
        plans.push(...flushPendingWrites(pendingWrites));
      }
      inPlanMode = false;
      pendingWrites = [];
      continue;
    }

    if (inPlanMode && tc.name === "Write") {
      const filePath = tc.input?.file_path as string | undefined;
      const content = tc.input?.content as string | undefined;
      if (filePath && content && filePath.endsWith(".md")) {
        pendingWrites.push({ filePath, content, ts: tc.ts });
      }
    }
  }

  // Warn about interrupted plan mode sessions (EnterPlanMode + Write but no ExitPlanMode)
  if (inPlanMode && pendingWrites.length > 0) {
    log.debug(
      { writeCount: pendingWrites.length },
      "Plan mode session interrupted — pending writes dropped",
    );
  }

  if (plans.length > 0)
    log.info({ planCount: plans.length }, `Extracted ${plans.length} plan(s) from records`);
  return plans;
}
