/**
 * QuestionCard — Inline interactive card for agent questions.
 *
 * Two modes:
 * 1. **Live** — Reads from useAgentQuestionStore.pending (active stream or reconnect).
 *    Submit calls agent.submitAnswer.
 * 2. **Cold replay** — No pending store state. Reads questions from the block's inputRaw.
 *    Submit sends the answer as a new message to continue the conversation.
 *
 * Uses IntersectionObserver to track visibility — when the card scrolls out
 * of view, the AgentQuestionDialog opens as a fallback (live mode only).
 */

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { MessageCircleQuestion, Check } from "lucide-react";
import { trpc as trpcClient } from "@/bridge/trpc";
import { useAgentQuestionStore } from "@/ui/stores/useAgentQuestionStore";
import { useMessagesStore } from "@/ui/stores/useMessagesStore";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { AgentQuestion, ContentBlock } from "@/services/types";
import { QuestionField } from "./QuestionField";
import { Chip } from "@/ui/components/Chip";
import { buildAnswerMap } from "./questionHelpers";

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractQuestionsFromBlock(block: ContentBlock & { type: "tool_use" }): AgentQuestion[] {
  const raw = block.inputRaw as { questions?: unknown[] } | undefined;
  if (!raw?.questions || !Array.isArray(raw.questions)) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return raw.questions.map((q: any, i: number) => ({
    id: q.id ?? `q_${i}`,
    header: q.header ?? "",
    question: typeof q === "string" ? q : (q.question ?? ""),
    freeform: q.freeform ?? true,
    secret: q.secret ?? false,
    multiSelect: q.multiSelect ?? false,
    options: Array.isArray(q.options)
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        q.options.map((o: any) => ({
          label: typeof o === "string" ? o : (o.label ?? ""),
          description: typeof o === "string" ? "" : (o.description ?? ""),
        }))
      : undefined,
  }));
}

function formatColdReplayAnswer(
  questions: AgentQuestion[],
  selections: Record<string, string[]>,
  feedbacks: Record<string, string>,
) {
  const parts: string[] = [];
  for (const q of questions) {
    const sel = selections[q.id] ?? [];
    const fb = feedbacks[q.id]?.trim();
    if (sel.length > 0) parts.push(`${q.question}\nAnswer: ${sel.join(", ")}`);
    if (fb) parts.push(`Additional feedback: ${fb}`);
  }
  return parts.join("\n\n");
}

// ─── Submitted view ─────────────────────────────────────────────────────────

function SubmittedView({
  questions,
  answers,
}: {
  questions: AgentQuestion[];
  answers: Record<string, string[]>;
}) {
  return (
    <div className="space-y-2">
      {questions.map((q) => {
        const ans = answers[q.id] ?? [];
        return (
          <div key={q.id} className="space-y-1">
            {q.header && (
              <Chip color="muted" className="font-semibold">
                {q.header}
              </Chip>
            )}
            <p className="text-sm text-neutral-fg-subtle">{q.question}</p>
            <div className="flex items-center gap-1.5 text-sm">
              <Check className="h-3.5 w-3.5 text-palette-success shrink-0" />
              <span className="font-medium">{ans.join(", ") || "(no answer)"}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Card wrapper ───────────────────────────────────────────────────────────

function CardShell({
  cardRef,
  headerLabel,
  children,
}: {
  cardRef?: React.RefObject<HTMLDivElement | null>;
  headerLabel: string;
  children: React.ReactNode;
}) {
  const Icon = headerLabel === "Question Answered" ? Check : MessageCircleQuestion;
  const headerBg =
    headerLabel === "Question Answered" ? "bg-neutral-bg-subtle" : "bg-palette-primary/5";
  const headerBorder =
    headerLabel === "Question Answered" ? "border-neutral-border/30" : "border-palette-primary/10";
  const iconColor =
    headerLabel === "Question Answered" ? "text-palette-success" : "text-palette-primary";
  const textColor =
    headerLabel === "Question Answered" ? "text-neutral-fg-subtle" : "text-palette-primary";

  return (
    <Card ref={cardRef} variant="elevated" className="overflow-hidden">
      <div className={`flex items-center gap-2 px-4 py-2 ${headerBg} border-b ${headerBorder}`}>
        <Icon className={`h-4 w-4 ${iconColor} shrink-0`} />
        <span className={`text-xs font-medium ${textColor}`}>{headerLabel}</span>
      </div>
      {children}
    </Card>
  );
}

// ─── Answered card (read-only from block result) ────────────────────────────

function AnsweredCard({
  block,
  questions,
}: {
  block: ContentBlock & { type: "tool_use" };
  questions: AgentQuestion[];
}) {
  const result = block.result as Record<string, unknown> | string | null;
  // Backfilled from follow-up user message — extract and show just the answer portion
  if (result && typeof result === "object" && "_fromFollowUp" in result) {
    const raw = String(result.answer ?? "");
    // formatColdReplayAnswer produces "Question\nAnswer: selection" — extract answer lines
    const answerLines = raw
      .split("\n")
      .filter((l) => l.startsWith("Answer: ") || l.startsWith("Additional feedback: "));
    const answer =
      answerLines.length > 0
        ? answerLines.map((l) => l.replace(/^(Answer: |Additional feedback: )/, "")).join(", ")
        : raw;
    return (
      <CardShell headerLabel="Question Answered">
        <div className="px-4 py-3 space-y-2">
          {questions.map((q) => (
            <div key={q.id} className="space-y-1">
              {q.header && (
                <Chip color="muted" className="font-semibold">
                  {q.header}
                </Chip>
              )}
              <p className="text-sm text-neutral-fg-subtle">{q.question}</p>
            </div>
          ))}
          <div className="flex items-start gap-1.5 text-sm pt-1">
            <Check className="h-3.5 w-3.5 text-palette-success shrink-0 mt-0.5" />
            <span className="font-medium">{answer}</span>
          </div>
        </div>
      </CardShell>
    );
  }
  // Live SDK path: result is the raw answer string
  if (typeof result === "string") {
    // Format: 'User has answered your questions: "Q"="A". ...' — extract answer pairs
    const pairs = [...result.matchAll(/"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)"/g)];
    const answer = pairs.length > 0
      ? pairs.map(([, , a]) => a.replace(/\\(.)/g, "$1")).join(", ")
      : result;
    return (
      <CardShell headerLabel="Question Answered">
        <div className="px-4 py-3 space-y-2">
          {questions.map((q) => (
            <div key={q.id} className="space-y-1">
              {q.header && (
                <Chip color="muted" className="font-semibold">
                  {q.header}
                </Chip>
              )}
              <p className="text-sm text-neutral-fg-subtle">{q.question}</p>
            </div>
          ))}
          <div className="flex items-start gap-1.5 text-sm pt-1">
            <Check className="h-3.5 w-3.5 text-palette-success shrink-0 mt-0.5" />
            <span className="font-medium">{answer}</span>
          </div>
        </div>
      </CardShell>
    );
  }

  const resultAnswers =
    typeof result === "object" && result !== null ? (result as Record<string, string[]>) : {};
  return (
    <CardShell headerLabel="Question Answered">
      <div className="px-4 py-3">
        <SubmittedView questions={questions} answers={resultAnswers} />
      </div>
    </CardShell>
  );
}

// ─── Interactive card (live or cold-replay) ─────────────────────────────────

function InteractiveCard({
  block,
  questions,
  isLive,
  isColdReplay,
}: {
  block: ContentBlock & { type: "tool_use" };
  questions: AgentQuestion[];
  isLive: boolean;
  isColdReplay: boolean;
}) {
  const pending = useAgentQuestionStore((s) => s.pending);
  const submittedAnswers = useAgentQuestionStore((s) => s.submittedAnswers);
  const setCardVisible = useAgentQuestionStore((s) => s.setCardVisible);
  const submitStore = useAgentQuestionStore((s) => s.submit);
  const clear = useAgentQuestionStore((s) => s.clear);
  const sendMessage = useAgentQuestionStore((s) => s.sendMessage);
  const activeSessionId = useMessagesStore((s) => s.activeSessionId);
  const messages = useMessagesStore((s) => s.messages);

  const cardRef = useRef<HTMLDivElement>(null);
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [feedbacks, setFeedbacks] = useState<Record<string, string>>({});
  const [coldSubmitted, setColdSubmitted] = useState(false);

  useEffect(() => {
    if (pending) {
      setSelections({});
      setFeedbacks({});
    }
  }, [pending?.requestId]); // eslint-disable-line react-hooks/exhaustive-deps

  // IntersectionObserver (live mode only — drives dialog fallback)
  useEffect(() => {
    const el = cardRef.current;
    if (!el || !isLive) return;
    const observer = new IntersectionObserver(([entry]) => setCardVisible(entry.isIntersecting), {
      threshold: 0.3,
    });
    observer.observe(el);
    setCardVisible(true);
    return () => observer.disconnect();
  }, [pending?.requestId, isLive, setCardVisible]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = useCallback(() => {
    if (isLive && pending) {
      const mapped = buildAnswerMap(pending.questions, selections, feedbacks);
      submitStore(mapped);
      trpcClient.agent.submitAnswer
        .mutate({ requestId: pending.requestId, answers: mapped })
        .catch(() => {});
    } else if (isColdReplay && sendMessage) {
      const mapped = buildAnswerMap(questions, selections, feedbacks);
      // Persist the answer into the block's result so it loads correctly next time
      if (activeSessionId) {
        const msg = messages.find(
          (m) =>
            m.role === "assistant" &&
            m.contentBlocks?.some((b) => b.type === "tool_use" && b.id === block.id),
        );
        if (msg) {
          trpcClient.session.updateBlockResult
            .mutate({
              sessionId: activeSessionId,
              messageId: msg.id,
              blockId: block.id,
              result: mapped,
            })
            .catch(() => {});
          // Update the in-memory block so the card transitions to answered immediately
          const memBlock = msg.contentBlocks?.find(
            (b) => b.type === "tool_use" && b.id === block.id,
          );
          if (memBlock && memBlock.type === "tool_use") memBlock.result = mapped;
        }
      }
      const content = formatColdReplayAnswer(questions, selections, feedbacks);
      if (content.trim()) {
        sendMessage(content);
        setColdSubmitted(true);
      }
    }
  }, [
    isLive,
    isColdReplay,
    pending,
    questions,
    selections,
    feedbacks,
    submitStore,
    sendMessage,
    activeSessionId,
    messages,
    block.id,
  ]);

  const handleCancel = useCallback(() => {
    trpcClient.agent.cancel.mutate().catch(() => {});
    clear();
  }, [clear]);

  const isSubmitted = (isLive && submittedAnswers !== null) || coldSubmitted;
  const hasAnswer =
    !isSubmitted &&
    questions.some((q) => {
      const sel = selections[q.id] ?? [];
      const fb = feedbacks[q.id]?.trim();
      return sel.length > 0 || !!fb;
    });

  const submittedMap =
    isLive && submittedAnswers
      ? submittedAnswers
      : buildAnswerMap(questions, selections, feedbacks);

  return (
    <CardShell
      cardRef={cardRef}
      headerLabel={isColdReplay ? "Unanswered Question" : "Agent Question"}
    >
      <div className="px-4 py-3">
        {isSubmitted ? (
          <SubmittedView questions={questions} answers={submittedMap} />
        ) : (
          <div className="space-y-4">
            {questions.map((q) => (
              <QuestionField
                key={q.id}
                question={q}
                selected={selections[q.id] ?? []}
                onSelect={(vals) => setSelections((prev) => ({ ...prev, [q.id]: vals }))}
                feedback={feedbacks[q.id] ?? ""}
                onFeedbackChange={(val) => setFeedbacks((prev) => ({ ...prev, [q.id]: val }))}
                disabled={isSubmitted}
              />
            ))}
          </div>
        )}
      </div>
      {!isSubmitted && (
        <div className="flex justify-end gap-2 px-4 py-2 border-t border-neutral-border/50">
          {isLive && (
            <Button variant="ghost" size="sm" onClick={handleCancel}>
              Cancel
            </Button>
          )}
          <Button size="sm" onClick={handleSubmit} disabled={!hasAnswer}>
            {isColdReplay ? "Continue" : "Submit"}
          </Button>
        </div>
      )}
    </CardShell>
  );
}

// ─── Main QuestionCard (routing component) ──────────────────────────────────

export default function QuestionCard({ block }: { block: ContentBlock & { type: "tool_use" } }) {
  const pending = useAgentQuestionStore((s) => s.pending);

  const isLive = pending?.requestId === block.id;
  const hasAnswer = block.result !== undefined && block.result !== null;
  const isColdReplay = !isLive && !hasAnswer && block.name === "AskUserQuestion";
  const isAnswered = !isLive && hasAnswer;

  const questions = useMemo(() => {
    if (isLive && pending) return pending.questions;
    return extractQuestionsFromBlock(block);
  }, [isLive, pending, block]);

  if (questions.length === 0) return null;

  if (isAnswered) {
    return <AnsweredCard block={block} questions={questions} />;
  }

  if (isLive || isColdReplay) {
    return (
      <InteractiveCard
        block={block}
        questions={questions}
        isLive={isLive}
        isColdReplay={isColdReplay}
      />
    );
  }

  return null;
}
