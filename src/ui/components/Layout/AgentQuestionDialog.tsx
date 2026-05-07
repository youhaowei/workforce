/**
 * AgentQuestionDialog — Fallback dialog shown when the inline QuestionCard
 * scrolls out of view. Reuses QuestionField from QuestionCard.
 *
 * Only opens when `pending !== null && !cardVisible`.
 */

import { useState, useCallback, useEffect } from "react";
import { trpc as trpcClient } from "@/bridge/trpc";
import { useAgentQuestionStore } from "@/ui/stores/useAgentQuestionStore";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { QuestionField } from "../Messages/QuestionField";
import { buildAnswerMap } from "../Messages/questionHelpers";

export function AgentQuestionDialog() {
  const pending = useAgentQuestionStore((s) => s.pending);
  const cardVisible = useAgentQuestionStore((s) => s.cardVisible);
  const submittedAnswers = useAgentQuestionStore((s) => s.submittedAnswers);
  const submitStore = useAgentQuestionStore((s) => s.submit);
  const clear = useAgentQuestionStore((s) => s.clear);

  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [feedbacks, setFeedbacks] = useState<Record<string, string>>({});

  // Reset when a new question arrives
  useEffect(() => {
    if (pending) {
      setSelections({});
      setFeedbacks({});
    }
  }, [pending?.requestId]); // oxlint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = useCallback(() => {
    if (!pending) return;
    const mapped = buildAnswerMap(pending.questions, selections, feedbacks);
    submitStore(mapped);
    trpcClient.agent.submitAnswer
      .mutate({ requestId: pending.requestId, answers: mapped })
      .catch(() => {
        /* best-effort */
      });
  }, [pending, selections, feedbacks, submitStore]);

  const handleDismiss = useCallback(() => {
    trpcClient.agent.cancel.mutate().catch(() => {
      /* best-effort */
    });
    clear();
  }, [clear]);

  // Only show dialog when card is not visible and question is pending
  const isOpen = pending !== null && !cardVisible && submittedAnswers === null;

  if (!isOpen) return null;

  const hasAnswer = pending!.questions.some((q) => {
    const sel = selections[q.id] ?? [];
    const fb = feedbacks[q.id]?.trim();
    return sel.length > 0 || !!fb;
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) handleDismiss();
      }}
    >
      <DialogContent className="sm:max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Agent Question</DialogTitle>
          <DialogDescription className="sr-only">
            The agent is asking you a question
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {pending!.questions.map((q) => (
            <QuestionField
              key={q.id}
              question={q}
              selected={selections[q.id] ?? []}
              onSelect={(vals) => setSelections((prev) => ({ ...prev, [q.id]: vals }))}
              feedback={feedbacks[q.id] ?? ""}
              onFeedbackChange={(val) => setFeedbacks((prev) => ({ ...prev, [q.id]: val }))}
              disabled={false}
            />
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={handleDismiss}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={!hasAnswer}>
            Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
