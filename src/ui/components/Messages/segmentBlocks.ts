/**
 * segmentBlocks — Splits a ContentBlock[] stream into typed segments.
 *
 * Walks the block array and groups consecutive blocks of the same "kind"
 * into segments. AskUserQuestion tool_use blocks become standalone question
 * segments. Text blocks break activity/thinking runs and vice versa.
 */

import type { ContentBlock } from "@/services/types";

export type Segment =
  | { kind: "thinking"; blocks: ContentBlock[] }
  | { kind: "activity"; blocks: ContentBlock[] }
  | { kind: "text"; blocks: ContentBlock[] }
  | { kind: "question"; block: ContentBlock & { type: "tool_use" } };

export function segmentBlocks(blocks: ContentBlock[]): Segment[] {
  const segments: Segment[] = [];
  let current: Segment | null = null;

  function flush() {
    if (current) {
      segments.push(current);
      current = null;
    }
  }

  for (const block of blocks) {
    if (block.type === "thinking") {
      if (current?.kind !== "thinking") {
        flush();
        current = { kind: "thinking", blocks: [] };
      }
      (current as { kind: "thinking"; blocks: ContentBlock[] }).blocks.push(block);
    } else if (block.type === "tool_use" && block.name === "AskUserQuestion") {
      flush();
      segments.push({ kind: "question", block });
    } else if (block.type === "tool_use") {
      if (current?.kind !== "activity") {
        flush();
        current = { kind: "activity", blocks: [] };
      }
      (current as { kind: "activity"; blocks: ContentBlock[] }).blocks.push(block);
    } else if (block.type === "text") {
      if (current?.kind !== "text") {
        flush();
        current = { kind: "text", blocks: [] };
      }
      (current as { kind: "text"; blocks: ContentBlock[] }).blocks.push(block);
    }
  }
  flush();
  return segments;
}
