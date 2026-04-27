import type { ContentBlock } from "@/services/types";

/**
 * Transition any `running` blocks to `complete`.
 *
 * Streams that end without per-block transitions (cancel/abort/orphan replay) leave
 * blocks stuck in `running`; this normalizes them so persisted/rendered messages
 * never show in-flight status.
 */
export function completeRunningBlocks(blocks: ContentBlock[]): ContentBlock[];
export function completeRunningBlocks(
  blocks: ContentBlock[] | undefined,
): ContentBlock[] | undefined;
export function completeRunningBlocks(
  blocks: ContentBlock[] | undefined,
): ContentBlock[] | undefined {
  if (!blocks?.length) return blocks;
  return blocks.map((block) =>
    block.status === "running" ? { ...block, status: "complete" as const } : block,
  );
}
