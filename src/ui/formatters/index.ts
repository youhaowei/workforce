/**
 * Tool Output Formatters
 *
 * Provides formatted display for different tool types.
 */

export { formatFileRead, formatFileWrite, formatFileEdit } from "./file";
export { formatBash, truncateOutput, stripAnsi } from "./bash";
export { formatGlob, formatGrep, formatGrepMatch } from "./search";
export { stripMarkdown } from "./markdown";
export type { FileReadResult, FileWriteResult, FileEditResult } from "./file";
export type { BashResult } from "./bash";
export type { GlobResult, GrepResult, GrepMatch } from "./search";

/**
 * Get the appropriate formatter based on tool name.
 */
export type ToolFormatter = (result: unknown) => {
  summary: string;
  detail?: string;
  isError?: boolean;
};

import { formatFileRead, formatFileWrite, formatFileEdit } from "./file";
import { formatBash } from "./bash";
import { formatGlob, formatGrep } from "./search";

const TOOL_FORMATTERS: Record<string, ToolFormatter> = {
  Read: (r) => formatFileRead(r),
  Write: (r) => formatFileWrite(r),
  Edit: (r) => formatFileEdit(r),
  Bash: (r) => formatBash(r),
  Glob: (r) => ({ summary: formatGlob(r).summary, detail: formatGlob(r).files.join("\n") }),
  Grep: (r) => ({ summary: formatGrep(r).summary, detail: "" }),
};

export function getToolFormatter(toolName: string): ToolFormatter | undefined {
  return TOOL_FORMATTERS[toolName];
}

export function formatToolResult(
  toolName: string,
  result: unknown,
): { summary: string; detail: string; isError: boolean } {
  const formatter = TOOL_FORMATTERS[toolName];
  if (formatter) {
    const formatted = formatter(result);
    return {
      summary: formatted.summary,
      detail: formatted.detail ?? "",
      isError: formatted.isError ?? false,
    };
  }

  // Default formatting for unknown tools
  const detail = typeof result === "string" ? result : JSON.stringify(result, null, 2);
  return {
    summary: `${toolName} completed`,
    detail,
    isError: false,
  };
}
