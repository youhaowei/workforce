/**
 * MessageInput - Chat input component
 *
 * Harmony-themed input with:
 * - Clean white background with subtle shadow
 * - Gold accent on focus
 * - Burgundy send button
 */

import { createSignal, createEffect, Show, onMount } from 'solid-js';
import { useHotkeys } from '@ui/hotkeys';

interface MessageInputProps {
  onSubmit: (message: string) => void;
  onCancel?: () => void;
  isStreaming: boolean;
  placeholder?: string;
}

export default function MessageInput(props: MessageInputProps) {
  const hotkeys = useHotkeys();
  const [value, setValue] = createSignal('');
  let textareaRef: HTMLTextAreaElement | undefined;

  // Register input with hotkey system
  onMount(() => {
    if (textareaRef) {
      hotkeys.registerInput(textareaRef);
    }
  });

  const adjustHeight = () => {
    if (textareaRef) {
      textareaRef.style.height = 'auto';
      textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 200)}px`;
    }
  };

  createEffect(() => {
    value();
    adjustHeight();
  });

  const handleSubmit = () => {
    const trimmed = value().trim();
    if (trimmed && !props.isStreaming) {
      props.onSubmit(trimmed);
      setValue('');
      if (textareaRef) {
        textareaRef.style.height = 'auto';
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      if (props.isStreaming && props.onCancel) {
        props.onCancel();
      } else {
        setValue('');
      }
    }
  };

  const handleCancel = () => {
    if (props.onCancel) {
      props.onCancel();
    }
  };

  return (
    <div class="flex-shrink-0 px-6 py-3 border-t border-burgundy-500/10 bg-cream-50/80 backdrop-blur-sm">
      <div class="max-w-3xl mx-auto">
        {/* Input container - grows upward via flex-col-reverse wrapper */}
        <div class="flex flex-col-reverse">
          <div class="flex items-stretch gap-3 bg-white rounded-xl border border-burgundy-500/10 px-4 py-2 shadow-sm focus-within:border-gold-500/40 focus-within:shadow-md transition-all duration-200">
            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={value()}
              onInput={(e) => setValue(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              placeholder={props.placeholder ?? 'Ask Fuxi anything...'}
              disabled={props.isStreaming}
              rows={1}
              class="flex-1 bg-transparent text-charcoal-800 placeholder-charcoal-600/40 resize-none outline-none text-sm font-sans min-h-[36px] max-h-[200px] disabled:opacity-50 py-2"
            />

            {/* Action buttons - stretch to match textarea height */}
            <div class="flex items-end">
              <Show when={props.isStreaming}>
                <button
                  type="button"
                  onClick={handleCancel}
                  class="h-9 px-4 text-sm font-serif rounded-lg bg-burgundy-500/10 text-burgundy-500 border border-burgundy-500/20 hover:bg-burgundy-500/20 transition-all duration-200"
                >
                  Stop
                </button>
              </Show>

              <Show when={!props.isStreaming}>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!value().trim()}
                  class={`w-9 h-9 rounded-lg flex items-center justify-center transition-all duration-200 ${
                    value().trim()
                      ? 'bg-burgundy-500 text-white shadow-md shadow-burgundy-500/20 hover:bg-burgundy-600'
                      : 'bg-charcoal-600/10 text-charcoal-600/30'
                  }`}
                  title="Send (Enter)"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M22 2L11 13" />
                    <path d="M22 2L15 22L11 13L2 9L22 2Z" />
                  </svg>
                </button>
              </Show>
            </div>
          </div>
        </div>

        {/* Hint text */}
        <div class="mt-2 flex items-center justify-between text-xs text-charcoal-600/50">
          <span class="font-sans">
            <kbd class="px-1.5 py-0.5 rounded bg-cream-200/50 border border-burgundy-500/5 font-mono text-[10px]">Enter</kbd>
            {' '}to send · {' '}
            <kbd class="px-1.5 py-0.5 rounded bg-cream-200/50 border border-burgundy-500/5 font-mono text-[10px]">Shift+Enter</kbd>
            {' '}for newline
          </span>
          <Show when={props.isStreaming}>
            <span class="text-sage-500 flex items-center gap-1.5">
              <span class="w-1.5 h-1.5 rounded-full bg-sage-500 animate-pulse" />
              Fuxi is thinking...
            </span>
          </Show>
        </div>
      </div>
    </div>
  );
}
