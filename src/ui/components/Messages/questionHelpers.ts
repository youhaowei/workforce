import type { AgentQuestion } from "@/services/types";

export function buildAnswerMap(
  questions: AgentQuestion[],
  selections: Record<string, string[]>,
  feedbacks: Record<string, string>,
) {
  const mapped: Record<string, string[]> = {};
  for (const q of questions) {
    const sel = selections[q.id] ?? [];
    const fb = feedbacks[q.id]?.trim();
    const combined = fb ? [...sel, fb] : sel;
    if (combined.length > 0) mapped[q.id] = combined;
  }
  return mapped;
}
