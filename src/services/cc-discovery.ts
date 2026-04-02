/**
 * CC Session Discovery — Find Claude Code sessions via SDK.
 *
 * Uses the Claude Agent SDK's listSessions() for proper auto-generated titles
 * and rich metadata. Falls back to sessions-index.json if SDK is unavailable.
 */

import { readFile, readdir, stat } from "fs/promises";
import { join, resolve } from "path";
import { homedir } from "os";

export interface CCSessionSummary {
  sessionId: string;
  /** Display title: custom title > auto-generated summary > first prompt */
  title: string;
  firstPrompt?: string;
  lastModified: number;
  fileSize: number;
  gitBranch?: string;
  cwd?: string;
  /** Full path to the CC JSONL file (resolved from sessionId + project dir) */
  fullPath: string;
}

/**
 * Clean up a CC session summary into a useful display title.
 * Filters out slash commands, URLs, and other non-title content.
 */
function cleanTitle(summary: string, firstPrompt?: string): string {
  const candidate = summary || firstPrompt || "";
  if (!candidate || candidate === "No prompt" || candidate === "(session)") return "";
  if (candidate.startsWith("/")) return "";
  if (candidate.startsWith("http")) return "";
  if (candidate.length < 3) return "";
  return candidate;
}

/**
 * Discover CC sessions using the SDK's listSessions().
 * Returns sessions with proper auto-generated titles.
 */
export async function discoverCCSessions(projectPath?: string): Promise<CCSessionSummary[]> {
  try {
    const { listSessions } = await import("@anthropic-ai/claude-agent-sdk");
    const sdkSessions = await listSessions(projectPath ? { dir: projectPath } : undefined);

    const ccProjectsDir = join(homedir(), ".claude", "projects");

    return sdkSessions
      .filter((s) => (s.fileSize ?? 0) > 500) // skip near-empty sessions
      .map((s) => {
        const cwd = s.cwd ?? projectPath;
        const slug = cwd ? projectPathToSlug(cwd) : "";
        return {
          sessionId: s.sessionId,
          title:
            s.customTitle ||
            cleanTitle(s.summary, s.firstPrompt) ||
            (s.gitBranch && s.gitBranch !== "master" && s.gitBranch !== "main" ? s.gitBranch : ""),
          firstPrompt: s.firstPrompt,
          lastModified: s.lastModified,
          fileSize: s.fileSize ?? 0,
          gitBranch: s.gitBranch,
          cwd,
          fullPath: slug
            ? join(ccProjectsDir, slug, `${s.sessionId}.jsonl`)
            : join(ccProjectsDir, `${s.sessionId}.jsonl`),
        };
      });
  } catch {
    // SDK not available — fall back to sessions-index.json
    return discoverFromIndex(projectPath);
  }
}

// =============================================================================
// Fallback: sessions-index.json
// =============================================================================

interface CCSessionsIndexEntry {
  sessionId: string;
  fullPath: string;
  firstPrompt: string;
  messageCount: number;
  created: string;
  modified: string;
  gitBranch?: string;
  projectPath?: string;
}

async function discoverFromIndex(projectPath?: string): Promise<CCSessionSummary[]> {
  const ccProjectsDir = join(homedir(), ".claude", "projects");

  if (projectPath) {
    const slug = projectPathToSlug(projectPath);
    return readSessionsIndex(join(ccProjectsDir, slug));
  }

  let projectDirs: string[];
  try {
    const entries = await readdir(ccProjectsDir);
    projectDirs = entries.map((e) => join(ccProjectsDir, e));
  } catch {
    return [];
  }

  const results: CCSessionSummary[] = [];
  for (const dir of projectDirs) {
    try {
      const dirStat = await stat(dir);
      if (!dirStat.isDirectory()) continue;
      results.push(...(await readSessionsIndex(dir)));
    } catch {
      /* skip */
    }
  }
  return results;
}

async function readSessionsIndex(projectDir: string): Promise<CCSessionSummary[]> {
  const indexPath = join(projectDir, "sessions-index.json");
  try {
    const raw = await readFile(indexPath, "utf-8");
    const index = JSON.parse(raw) as { entries: CCSessionsIndexEntry[] };
    return (index.entries ?? []).map((e) => ({
      sessionId: e.sessionId,
      title: e.firstPrompt && e.firstPrompt !== "No prompt" ? e.firstPrompt : "Claude Code Session",
      firstPrompt: e.firstPrompt,
      lastModified: new Date(e.modified).getTime(),
      fileSize: 0,
      gitBranch: e.gitBranch,
      fullPath: e.fullPath,
    }));
  } catch {
    return [];
  }
}

/** Convert a project path to CC's directory slug format. */
export function projectPathToSlug(projectPath: string): string {
  return resolve(projectPath).replace(/\//g, "-");
}
