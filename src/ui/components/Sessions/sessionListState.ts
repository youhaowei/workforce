import type { SessionSummary } from "@/services/types";
import type { GroupByMode, SessionGroup, SortDirection } from "./sessionListHelpers";

export type SortField = "default" | "created" | "active" | "title" | "messages";
export type StatusFilter = "all" | "active" | "completed" | "failed";
export type TypeFilterMode = "all" | "chat" | "workagent" | "external";

export const GROUP_BY_STORAGE_KEY = "workforce:sessions-group-by";
export const FILTERS_STORAGE_KEY = "workforce:sessions-filters";
export const SORT_STORAGE_KEY = "workforce:sessions-sort";

export const SORT_FIELD_OPTIONS: { value: SortField; label: string }[] = [
  { value: "default", label: "Same as group" },
  { value: "created", label: "Created" },
  { value: "active", label: "Last active" },
  { value: "title", label: "Title" },
  { value: "messages", label: "Messages" },
];

const VALID_STATUS = new Set<StatusFilter>(["all", "active", "completed", "failed"]);
const VALID_TYPE = new Set<TypeFilterMode>(["all", "chat", "workagent", "external"]);
const VALID_SORT_FIELDS = new Set<SortField>(["default", "created", "active", "title", "messages"]);
const VALID_SORT_DIRS = new Set<SortDirection>(["asc", "desc"]);

export function getInitialFilters(): { status: StatusFilter; type: TypeFilterMode } {
  const raw = localStorage.getItem(FILTERS_STORAGE_KEY);
  if (!raw) return { status: "all", type: "all" };

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return {
        status: VALID_STATUS.has(parsed.status) ? parsed.status : "all",
        type: VALID_TYPE.has(parsed.type) ? parsed.type : "all",
      };
    }
  } catch (err) {
    console.warn("Failed to parse persisted session filters", {
      key: FILTERS_STORAGE_KEY,
      raw,
      err,
    });
  }
  return { status: "all", type: "all" };
}

export function getInitialSort(): {
  dir: SortDirection;
  secondary: { field: SortField; dir: SortDirection };
} {
  const raw = localStorage.getItem(SORT_STORAGE_KEY);
  if (!raw) return { dir: "desc", secondary: { field: "default", dir: "desc" } };

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const dir = VALID_SORT_DIRS.has(parsed.dir) ? parsed.dir : "desc";
      const secField = VALID_SORT_FIELDS.has(parsed.secondary?.field)
        ? parsed.secondary.field
        : "default";
      const secDir = VALID_SORT_DIRS.has(parsed.secondary?.dir) ? parsed.secondary.dir : "desc";
      return { dir, secondary: { field: secField, dir: secDir } };
    }
  } catch (err) {
    console.warn("Failed to parse persisted session sort", {
      key: SORT_STORAGE_KEY,
      raw,
      err,
    });
  }
  return { dir: "desc", secondary: { field: "default", dir: "desc" } };
}

export type FlatItem =
  | {
      kind: "header";
      label: string;
      key: string;
      count: number;
      collapsible: boolean;
      collapsed: boolean;
    }
  | { kind: "session"; session: SessionSummary };

function compareByField(
  a: SessionSummary,
  b: SessionSummary,
  field: SortField,
  dir: SortDirection,
  groupBy: GroupByMode,
): number {
  const mul = dir === "desc" ? -1 : 1;
  let resolvedField = field;
  if (field === "default") {
    resolvedField = groupBy === "active" ? "active" : "created";
  }
  switch (resolvedField) {
    case "created":
      return mul * (a.createdAt - b.createdAt);
    case "active":
      return mul * (a.updatedAt - b.updatedAt);
    case "title":
      return mul * (a.title ?? "").localeCompare(b.title ?? "");
    case "messages":
      return mul * (a.messageCount - b.messageCount);
    default:
      return 0;
  }
}

export function flattenGroups(
  groups: SessionGroup[] | null,
  groupBy: GroupByMode,
  collapsedGroups: Set<string>,
  secondary?: { field: SortField; dir: SortDirection },
): FlatItem[] {
  if (!groups) return [];

  const items: FlatItem[] = [];
  const collapsible = groupBy !== "date";

  for (const group of groups) {
    const collapsed = collapsible && collapsedGroups.has(group.key);
    const sorted = secondary
      ? [...group.sessions].sort((a, b) =>
          compareByField(a, b, secondary.field, secondary.dir, groupBy),
        )
      : group.sessions;
    items.push({
      kind: "header",
      label: group.label,
      key: group.key,
      count: sorted.length,
      collapsible,
      collapsed,
    });
    if (!collapsed) {
      for (const session of sorted) {
        items.push({ kind: "session", session });
      }
    }
  }
  return items;
}
