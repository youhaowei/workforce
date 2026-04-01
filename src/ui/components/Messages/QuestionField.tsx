/**
 * QuestionField — Shared interactive field for agent questions.
 *
 * Used by both QuestionCard (inline) and AgentQuestionDialog (fallback overlay).
 * Supports single/multi select, freeform "Other" option, and feedback input.
 */

import { useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Chip } from "@/ui/components/Chip";
import type { AgentQuestion } from "@/services/types";

export function QuestionField({
  question,
  selected,
  onSelect,
  feedback,
  onFeedbackChange,
  disabled,
}: {
  question: AgentQuestion;
  selected: string[];
  onSelect: (values: string[]) => void;
  feedback: string;
  onFeedbackChange: (value: string) => void;
  disabled: boolean;
}) {
  const isMulti = question.multiSelect ?? false;
  const [useOther, setUseOther] = useState(false);
  const [otherText, setOtherText] = useState("");

  const handleOptionToggle = useCallback(
    (label: string) => {
      if (isMulti) {
        const next = selected.includes(label)
          ? selected.filter((s) => s !== label)
          : [...selected, label];
        // Keep "Other" text if active
        if (useOther && otherText) {
          const withoutOther = next.filter((s) => question.options?.some((o) => o.label === s));
          onSelect([...withoutOther, otherText]);
        } else {
          onSelect(next);
        }
      } else {
        setUseOther(false);
        onSelect([label]);
      }
    },
    [isMulti, selected, onSelect, useOther, otherText, question.options],
  );

  const effectiveSelected = useOther && !isMulti ? [] : selected;

  return (
    <div className="space-y-3">
      {question.header && <Chip color="muted">{question.header}</Chip>}
      <p className="text-sm font-medium">{question.question}</p>

      {question.options && question.options.length > 0 && (
        <div className="space-y-1.5">
          {question.options.map((opt) => {
            const isSelected = effectiveSelected.includes(opt.label);
            return (
              <label
                key={opt.label}
                className={`flex items-start gap-2.5 rounded-md border px-3 py-2 cursor-pointer transition-colors ${
                  isSelected
                    ? "border-palette-primary bg-palette-primary/5"
                    : "border-neutral-border hover:bg-neutral-bg-dim/50"
                } ${disabled ? "opacity-60 pointer-events-none" : ""}`}
              >
                <input
                  type={isMulti ? "checkbox" : "radio"}
                  name={question.id}
                  checked={isSelected}
                  onChange={() => handleOptionToggle(opt.label)}
                  disabled={disabled}
                  className="mt-0.5 accent-primary"
                />
                <div className="min-w-0">
                  <span className="text-sm font-medium">{opt.label}</span>
                  {opt.description && (
                    <p className="text-xs text-neutral-fg-subtle mt-0.5">{opt.description}</p>
                  )}
                </div>
              </label>
            );
          })}

          {question.freeform && (
            <label
              className={`flex items-start gap-2.5 rounded-md border px-3 py-2 cursor-pointer transition-colors ${
                useOther
                  ? "border-palette-primary bg-palette-primary/5"
                  : "border-neutral-border hover:bg-neutral-bg-dim/50"
              } ${disabled ? "opacity-60 pointer-events-none" : ""}`}
            >
              <input
                type={isMulti ? "checkbox" : "radio"}
                name={question.id}
                checked={useOther}
                onChange={() => {
                  setUseOther(true);
                  if (!isMulti) onSelect([]);
                }}
                disabled={disabled}
                className="mt-0.5 accent-primary"
              />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">Other</span>
                {useOther && (
                  <Input
                    autoFocus
                    value={otherText}
                    onChange={(e) => {
                      setOtherText(e.target.value);
                      if (isMulti) {
                        const optionSels = selected.filter((s) =>
                          question.options?.some((o) => o.label === s),
                        );
                        onSelect(e.target.value ? [...optionSels, e.target.value] : optionSels);
                      } else {
                        onSelect(e.target.value ? [e.target.value] : []);
                      }
                    }}
                    placeholder="Type your answer..."
                    className="mt-1.5 h-8 text-sm"
                    disabled={disabled}
                    type={question.secret ? "password" : "text"}
                  />
                )}
              </div>
            </label>
          )}
        </div>
      )}

      <Input
        value={feedback}
        onChange={(e) => onFeedbackChange(e.target.value)}
        placeholder="Additional feedback (optional)..."
        className="h-8 text-sm"
        disabled={disabled}
        type={question.secret ? "password" : "text"}
      />
    </div>
  );
}
