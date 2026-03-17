/**
 * CC Session Reader — Parse Claude Code JSONL sessions into WF journal records.
 *
 * CC JSONL format uses `type` field (not `t`), emits one record per content
 * block for assistant messages, and uses `uuid`/`parentUuid` for tree structure.
 *
 * This module provides a lossless parse: every CC record is either mapped to
 * a WF journal record or explicitly skipped (counted in stats).
 */

import { readFile } from 'fs/promises';
import type {
  JournalRecord,
  JournalHeader,
  JournalMessage,
  JournalMessageFinal,
  JournalToolCall,
  JournalHook,
  JournalToolProgress,
  JournalQueryResult,
  JournalMeta,
  TokenUsage,
} from './types';

// =============================================================================
// Public API
// =============================================================================

export interface CCImportResult {
  header: JournalHeader;
  records: JournalRecord[];
  stats: {
    totalCCRecords: number;
    mappedRecords: number;
    skippedRecords: number;
    malformedLines: number;
  };
  ccMeta: {
    version?: string;
    gitBranch?: string;
    cwd?: string;
    slug?: string;
  };
}

// Re-export discovery API from dedicated module
export { discoverCCSessions, projectPathToSlug, type CCSessionSummary } from './cc-discovery';

export async function readCCSession(filePath: string, skipLines = 0): Promise<CCImportResult | null> {
  let raw: string;
  try { raw = await readFile(filePath, 'utf-8'); }
  catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null; throw err; }

  const allLines = raw.split('\n').filter((l) => l.trim().length > 0);
  if (allLines.length === 0) return null;
  const lines = skipLines > 0 ? allLines.slice(skipLines) : allLines;
  if (lines.length === 0) return null;
  return parseCCRecords(lines, filePath);
}

// =============================================================================
// CC Record Types (raw parsed shapes)
// =============================================================================

interface CCBase {
  type: string;
  parentUuid?: string | null;
  uuid?: string;
  timestamp?: string;
  sessionId?: string;
  version?: string;
  gitBranch?: string;
  cwd?: string;
  slug?: string;
  isMeta?: boolean;
}

interface CCUser extends CCBase {
  type: 'user';
  message: {
    role: 'user';
    content: string | CCContentBlock[];
  };
  toolUseResult?: {
    type: string;
    file?: { filePath: string; content: string };
  };
}

interface CCAssistant extends CCBase {
  type: 'assistant';
  message: {
    id: string;
    model?: string;
    role: 'assistant';
    content: CCContentBlock[];
    stop_reason: string | null;
    usage?: CCUsage;
  };
}

interface CCContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  signature?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | CCContentBlock[];
}

interface CCUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface CCProgress extends CCBase {
  type: 'progress';
  data?: {
    type?: string;
    hookEvent?: string;
    hookName?: string;
    toolUseID?: string;
    content?: string;
    output?: string;
    durationMs?: number;
    [key: string]: unknown;
  };
}

interface CCSystem extends CCBase {
  type: 'system';
  subtype?: string;
  durationMs?: number;
  hookCount?: number;
  hookInfos?: Array<{ command: string; durationMs: number }>;
  content?: string;
  compactMetadata?: { trigger?: string; preTokens?: number };
  [key: string]: unknown;
}

interface CCFileHistorySnapshot extends CCBase {
  type: 'file-history-snapshot';
  messageId?: string;
  snapshot?: {
    messageId?: string;
    trackedFileBackups?: Record<string, unknown>;
    timestamp?: string;
  };
}

interface CCQueueOperation extends CCBase {
  type: 'queue-operation';
  operation: string;
  content?: string;
}

interface CCPrLink extends CCBase {
  type: 'pr-link';
  prNumber?: number;
  prUrl?: string;
  prRepository?: string;
}

type CCRecord = CCUser | CCAssistant | CCProgress | CCSystem
  | CCFileHistorySnapshot | CCQueueOperation | CCPrLink | CCBase;

// =============================================================================
// Parser
// =============================================================================

function parseCCRecords(lines: string[], filePath: string): CCImportResult | null {
  const ccRecords: CCRecord[] = [];
  let malformedLines = 0;

  for (const line of lines) {
    try {
      ccRecords.push(JSON.parse(line) as CCRecord);
    } catch {
      malformedLines++;
    }
  }

  if (ccRecords.length === 0) return null;

  // Extract session metadata from the first record
  const first = ccRecords[0];
  const sessionId = first.sessionId ?? extractSessionIdFromPath(filePath);
  const ccMeta = {
    version: first.version,
    gitBranch: first.gitBranch,
    cwd: first.cwd,
    slug: first.slug,
  };

  let seq = 0;
  const wfRecords: JournalRecord[] = [];
  let skippedRecords = 0;

  // Group assistant records by message.id for assembly
  const assistantGroups = groupAssistantRecords(ccRecords);

  // Track which CC record indices are assistant records (handled in groups)
  const assistantIndices = new Set<number>();
  for (const indices of assistantGroups.values()) {
    for (const idx of indices) assistantIndices.add(idx);
  }

  // Track which message IDs have been emitted (to avoid double-emitting assistant groups)
  const emittedMessageIds = new Set<string>();

  for (let i = 0; i < ccRecords.length; i++) {
    const rec = ccRecords[i];

    // Skip assistant records — they're handled as groups
    if (assistantIndices.has(i)) {
      // Emit the group on the FIRST record of each message ID
      if (rec.type === 'assistant') {
        const mid = (rec as CCAssistant).message.id;
        if (!emittedMessageIds.has(mid)) {
          emittedMessageIds.add(mid);
          const indices = assistantGroups.get(mid)!;
          const groupRecs = indices.map((idx) => ccRecords[idx] as CCAssistant);
          const mapped = mapAssistantGroup(groupRecs, seq);
          seq += mapped.length;
          wfRecords.push(...mapped);
        }
      }
      continue;
    }

    const mapped = mapSingleRecord(rec, seq);
    if (mapped === 'skip') {
      skippedRecords++;
    } else if (mapped) {
      wfRecords.push(mapped);
      seq++;
    }
  }

  // Synthesize header
  const firstTs = parseTimestamp(first.timestamp);
  const header: JournalHeader = {
    t: 'header',
    v: '0.3.0',
    seq: 0,
    ts: firstTs,
    id: sessionId,
    createdAt: firstTs,
    metadata: {
      source: 'claude-code',
      ...ccMeta,
    },
  };

  return {
    header,
    records: wfRecords,
    stats: {
      totalCCRecords: ccRecords.length,
      mappedRecords: wfRecords.length,
      skippedRecords,
      malformedLines,
    },
    ccMeta,
  };
}

// =============================================================================
// Record Mappers
// =============================================================================

function mapSingleRecord(rec: CCRecord, seq: number): JournalRecord | 'skip' | null {
  switch (rec.type) {
    case 'user': return mapUserRecord(rec as CCUser, seq);
    case 'progress': return mapProgressRecord(rec as CCProgress, seq);
    case 'system': return mapSystemRecord(rec as CCSystem, seq);
    case 'file-history-snapshot': return mapFileHistorySnapshot(rec as CCFileHistorySnapshot, seq);
    case 'queue-operation': return mapQueueOperation(rec as CCQueueOperation, seq);
    case 'pr-link': return mapPrLink(rec as CCPrLink, seq);
    case 'agent-color': return 'skip';
    case 'last-prompt': return 'skip';
    default: return 'skip';
  }
}

function mapUserRecord(rec: CCUser, seq: number): JournalRecord | 'skip' {
  const ts = parseTimestamp(rec.timestamp);

  // isMeta user records are metadata, not actual user messages
  if (rec.isMeta) {
    return {
      t: 'meta', seq, ts,
      patch: { userMeta: rec.message.content },
    } satisfies JournalMeta;
  }

  const content = rec.message.content;

  // Array content
  if (Array.isArray(content)) {
    // Check if this is a tool-result-only message (API plumbing, not a real user message)
    const hasToolResults = content.some((b) => b.type === 'tool_result');
    const hasText = content.some((b) => b.type === 'text');
    const hasImage = content.some((b) => b.type === 'image');

    if (hasToolResults && !hasText && !hasImage) {
      // Tool-result-only → emit JournalToolResult records
      // But these are complex to match without context, so emit as meta
      return mapToolResultBlocks(content, rec, seq);
    }

    // Real user message with content blocks (may include images)
    const textParts = content
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('\n');

    return {
      t: 'message', seq, ts,
      id: rec.uuid ?? `cc-user-${seq}`,
      role: 'user',
      content: textParts,
      contentBlocks: content.map(mapContentBlock),
    } satisfies JournalMessage;
  }

  // Simple string content
  return {
    t: 'message', seq, ts,
    id: rec.uuid ?? `cc-user-${seq}`,
    role: 'user',
    content: typeof content === 'string' ? content : '',
  } satisfies JournalMessage;
}

function mapToolResultBlocks(blocks: CCContentBlock[], rec: CCUser, seq: number): JournalRecord {
  // For each tool_result block, emit metadata about the result
  const results = blocks
    .filter((b) => b.type === 'tool_result')
    .map((b) => ({
      toolUseId: b.tool_use_id,
      content: typeof b.content === 'string' ? b.content.slice(0, 500) : undefined,
    }));

  return {
    t: 'meta', seq, ts: parseTimestamp(rec.timestamp),
    patch: { toolResults: results },
  } satisfies JournalMeta;
}

function mapAssistantGroup(recs: CCAssistant[], startSeq: number): JournalRecord[] {
  if (recs.length === 0) return [];

  const result: JournalRecord[] = [];
  let seq = startSeq;
  const first = recs[0];
  const last = recs[recs.length - 1];
  const ts = parseTimestamp(last.timestamp ?? first.timestamp);
  const messageId = first.message.id;

  // Collect all content blocks across the group
  const allBlocks: CCContentBlock[] = [];
  for (const rec of recs) {
    allBlocks.push(...(rec.message.content ?? []));
  }

  // Extract tool_use blocks → JournalToolCall records
  const toolUseBlocks = allBlocks.filter((b) => b.type === 'tool_use');
  const textBlocks = allBlocks.filter((b) => b.type === 'text');
  // Assemble text content
  const textContent = textBlocks.map((b) => b.text ?? '').join('');

  // Build contentBlocks for UI rendering (preserve all types)
  const contentBlocks = allBlocks
    .filter((b) => b.type !== 'server_tool_use') // skip internal blocks
    .map(mapContentBlock);

  // Map usage from last record
  const usage = last.message.usage ? mapUsage(last.message.usage) : undefined;

  // Emit the message_final
  const messageFinal: JournalMessageFinal = {
    t: 'message_final', seq: seq++, ts,
    id: messageId,
    role: 'assistant',
    content: textContent,
    stopReason: last.message.stop_reason ?? 'end_turn',
    model: last.message.model,
    usage,
    ...(contentBlocks.length > 0 ? { contentBlocks } : {}),
  };
  result.push(messageFinal);

  // Emit JournalToolCall for each tool_use block
  for (const toolBlock of toolUseBlocks) {
    if (!toolBlock.id || !toolBlock.name) continue;
    const toolCall: JournalToolCall = {
      t: 'tool_call', seq: seq++, ts,
      actionId: toolBlock.id,
      messageId,
      name: toolBlock.name,
      input: (toolBlock.input as Record<string, unknown>) ?? {},
    };
    result.push(toolCall);
  }

  return result;
}

function mapProgressRecord(rec: CCProgress, seq: number): JournalRecord | 'skip' {
  const ts = parseTimestamp(rec.timestamp);
  const data = rec.data;
  if (!data) return 'skip';

  switch (data.type) {
    case 'hook_progress': {
      return {
        t: 'hook', seq, ts,
        hookId: rec.uuid ?? `cc-hook-${seq}`,
        hookName: data.hookName ?? 'unknown',
        hookEvent: data.hookEvent ?? 'unknown',
        actionId: data.toolUseID ?? undefined,
        outcome: 'success',
        output: data.output,
        durationMs: data.durationMs,
      } satisfies JournalHook;
    }

    case 'agent_progress': {
      return {
        t: 'meta', seq, ts,
        patch: { agentProgress: data },
      } satisfies JournalMeta;
    }

    case 'bash_progress':
    case 'mcp_progress': {
      return {
        t: 'tool_progress', seq, ts,
        actionId: data.toolUseID ?? `cc-progress-${seq}`,
        name: data.type,
        output: data.content ?? data.output,
      } satisfies JournalToolProgress;
    }

    case 'waiting_for_task': {
      return {
        t: 'meta', seq, ts,
        patch: { waitingForTask: data },
      } satisfies JournalMeta;
    }

    default:
      return 'skip';
  }
}

function mapSystemRecord(rec: CCSystem, seq: number): JournalRecord | 'skip' {
  const ts = parseTimestamp(rec.timestamp);

  switch (rec.subtype) {
    case 'stop_hook_summary': {
      return {
        t: 'meta', seq, ts,
        patch: {
          stopHookSummary: {
            hookCount: rec.hookCount,
            hookInfos: rec.hookInfos,
          },
        },
      } satisfies JournalMeta;
    }

    case 'turn_duration': {
      // Try to find the corresponding assistant message for usage
      return {
        t: 'query_result', seq, ts,
        messageId: rec.parentUuid ?? `cc-turn-${seq}`,
        durationMs: rec.durationMs ?? 0,
      } satisfies JournalQueryResult;
    }

    case 'compact_boundary': {
      return {
        t: 'meta', seq, ts,
        patch: {
          compaction: {
            trigger: rec.compactMetadata?.trigger,
            preTokens: rec.compactMetadata?.preTokens,
          },
        },
      } satisfies JournalMeta;
    }

    case 'api_error': {
      return {
        t: 'meta', seq, ts,
        patch: { apiError: rec.content },
      } satisfies JournalMeta;
    }

    case 'local_command':
    case 'informational': {
      return {
        t: 'meta', seq, ts,
        patch: { [rec.subtype]: rec.content },
      } satisfies JournalMeta;
    }

    case 'bridge_status':
      return 'skip';

    default:
      return 'skip';
  }
}

function mapFileHistorySnapshot(rec: CCFileHistorySnapshot, seq: number): JournalRecord | 'skip' {
  const backups = rec.snapshot?.trackedFileBackups;
  // Skip empty snapshots
  if (!backups || Object.keys(backups).length === 0) return 'skip';

  return {
    t: 'meta', seq, ts: parseTimestamp(rec.timestamp ?? rec.snapshot?.timestamp),
    patch: {
      fileHistorySnapshot: {
        messageId: rec.messageId,
        fileCount: Object.keys(backups).length,
        files: Object.keys(backups),
      },
    },
  } satisfies JournalMeta;
}

function mapQueueOperation(rec: CCQueueOperation, seq: number): JournalRecord | 'skip' {
  if (rec.operation === 'enqueue') {
    return {
      t: 'meta', seq, ts: parseTimestamp(rec.timestamp),
      patch: { queueEnqueue: rec.content },
    } satisfies JournalMeta;
  }
  // dequeue, remove, popAll → skip
  return 'skip';
}

function mapPrLink(rec: CCPrLink, seq: number): JournalRecord {
  return {
    t: 'meta', seq, ts: parseTimestamp(rec.timestamp),
    patch: {
      prLink: {
        prNumber: rec.prNumber,
        prUrl: rec.prUrl,
        prRepository: rec.prRepository,
      },
    },
  } satisfies JournalMeta;
}

// =============================================================================
// Helpers
// =============================================================================

function groupAssistantRecords(records: CCRecord[]): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (rec.type !== 'assistant') continue;
    const mid = (rec as CCAssistant).message.id;
    if (!groups.has(mid)) groups.set(mid, []);
    groups.get(mid)!.push(i);
  }
  return groups;
}

function mapContentBlock(block: CCContentBlock): import('./types').ContentBlock {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text ?? '' };
    case 'thinking':
      return { type: 'thinking', text: block.thinking ?? '' };
    case 'tool_use':
      return {
        type: 'tool_use',
        id: block.id ?? '',
        name: block.name ?? '',
        input: JSON.stringify(block.input ?? {}),
        status: 'complete',
      };
    case 'tool_result':
      return {
        type: 'text',
        text: `[Tool Result: ${block.tool_use_id}]`,
      };
    case 'image':
      return { type: 'text', text: '[Image]' };
    default:
      return { type: 'text', text: `[${block.type}]` };
  }
}

function mapUsage(usage: CCUsage): TokenUsage {
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens,
  };
}

function parseTimestamp(ts?: string | null): number {
  if (!ts) return 0;
  const parsed = Date.parse(ts);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function extractSessionIdFromPath(filePath: string): string {
  const match = filePath.match(/([a-f0-9-]{36})\.jsonl$/);
  return match?.[1] ?? `cc-import-${Date.now()}`;
}
