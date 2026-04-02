/**
 * File Tool Formatters
 *
 * Formats output for Read, Write, and Edit tools.
 */

export interface FileReadResult {
  content: string;
  path: string;
  lineCount?: number;
}

export interface FileWriteResult {
  path: string;
  created?: boolean;
  bytesWritten?: number;
}

export interface FileEditResult {
  path: string;
  linesChanged?: number;
  oldContent?: string;
  newContent?: string;
}

export function formatFileRead(result: unknown): { summary: string; detail: string } {
  if (!result || typeof result !== 'object') {
    return { summary: 'File read', detail: String(result ?? '') };
  }

  const r = result as FileReadResult;
  const lines = r.content?.split('\n') ?? [];
  const lineCount = r.lineCount ?? lines.length;

  return {
    summary: `Read ${r.path} (${lineCount} lines)`,
    detail: r.content ?? '',
  };
}

export function formatFileWrite(result: unknown): { summary: string; detail: string } {
  if (!result || typeof result !== 'object') {
    return { summary: 'File written', detail: String(result ?? '') };
  }

  const r = result as FileWriteResult;
  const action = r.created ? 'Created' : 'Updated';
  const bytes = r.bytesWritten ? ` (${r.bytesWritten} bytes)` : '';

  return {
    summary: `${action} ${r.path}${bytes}`,
    detail: '',
  };
}

export function formatFileEdit(result: unknown): { summary: string; detail: string } {
  if (!result || typeof result !== 'object') {
    return { summary: 'File edited', detail: String(result ?? '') };
  }

  const r = result as FileEditResult;
  const changes = r.linesChanged ? `${r.linesChanged} line(s) changed` : 'Changes applied';

  let diff = '';
  if (r.oldContent && r.newContent) {
    diff = `- ${r.oldContent}\n+ ${r.newContent}`;
  }

  return {
    summary: `Edited ${r.path}: ${changes}`,
    detail: diff,
  };
}
