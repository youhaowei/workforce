/**
 * Shared color palette and name-to-color mapping.
 *
 * Used by ProjectService (server-side) and CreateProjectDialog (client-side)
 * to assign deterministic avatar colors based on project name.
 */

export const PALETTE = [
  "#E57373",
  "#81C784",
  "#64B5F6",
  "#FFB74D",
  "#BA68C8",
  "#4DB6AC",
  "#F06292",
  "#AED581",
  "#7986CB",
  "#FFD54F",
  "#A1887F",
  "#90A4AE",
];

export function colorFromName(name: string): string {
  let hash = 0;
  for (const ch of name) hash = ((hash << 5) - hash + (ch.codePointAt(0) ?? 0)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
