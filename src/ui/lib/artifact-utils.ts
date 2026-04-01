/**
 * Shared artifact utilities — prompt generation, filename extraction, MIME colors, title extraction.
 */

import type { ArtifactComment, ArtifactMimeType, ArtifactStatus } from "@/services/types";

export const ARTIFACT_STATUS_STYLES: Record<ArtifactStatus, string> = {
  draft: "bg-neutral-bg-emphasis text-neutral-fg-subtle",
  pending_review: "bg-palette-warning/20 text-palette-warning",
  approved: "bg-palette-success/20 text-palette-success",
  rejected: "bg-palette-danger/20 text-palette-danger",
  executing: "bg-palette-info/20 text-palette-info",
  archived: "bg-neutral-bg-emphasis text-neutral-fg-subtle",
};

export const ARTIFACT_STATUS_LABELS: Record<ArtifactStatus, string> = {
  draft: "Draft",
  pending_review: "Review",
  approved: "Approved",
  rejected: "Changes",
  executing: "Running",
  archived: "Archived",
};

export const MIME_DOT_COLOR: Record<ArtifactMimeType, string> = {
  "text/markdown": "bg-palette-success",
  "text/html": "bg-palette-info",
  "text/csv": "bg-palette-secondary",
  "application/json": "bg-palette-warning",
  "image/svg+xml": "bg-palette-primary",
  "text/plain": "bg-neutral-fg-subtle",
};

export function extractFilename(path: string) {
  return path.split("/").pop() ?? path;
}

export function extractMarkdownTitle(content: string, fallback: string) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : fallback;
}

export function generateReviewPrompt(title: string, comments: ArtifactComment[], summary: string) {
  const parts: string[] = [`Review of ${title}:`];
  if (comments.length > 0) {
    parts.push("");
    comments.forEach((c, i) => {
      const anchor = c.anchor?.line != null ? ` L${c.anchor.line}` : "";
      parts.push(`${i + 1}. [${c.severity}]${anchor}: ${c.content}`);
    });
  }
  if (summary.trim()) {
    parts.push("", `General: ${summary.trim()}`);
  }
  return parts.join("\n");
}
