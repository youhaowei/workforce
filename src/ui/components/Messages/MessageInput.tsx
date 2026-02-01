/**
 * MessageInput - User input component
 *
 * Features:
 * - Enter to submit, Shift+Enter for newline
 * - Escape to clear or cancel streaming
 * - Auto-resize textarea
 * - Disabled during streaming
 */

import { createSignal, createEffect, Show } from 'solid-js';

interface MessageInputProps {
  onSubmit: (message: string) => void;
  onCancel?: () => void;
  isStreaming: boolean;
  placeholder?: string;
}

const styles = {
  container: 'border-t border-gray-200 bg-white p-4',
  wrapper: 'max-w-3xl mx-auto',
  inputContainer: 'flex items-end gap-3',
  textareaWrapper: 'flex-1 relative',
  textarea:
    'w-full resize-none border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500',
  button:
    'px-4 py-3 rounded-lg font-medium text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2',
  submitButton: 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500 disabled:bg-gray-300 disabled:cursor-not-allowed',
  cancelButton: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
  hint: 'mt-2 text-xs text-gray-400',
};

export default function MessageInput(props: MessageInputProps) {
  const [value, setValue] = createSignal('');
  let textareaRef: HTMLTextAreaElement | undefined;

  // Auto-resize textarea
  const adjustHeight = () => {
    if (textareaRef) {
      textareaRef.style.height = 'auto';
      textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 200)}px`;
    }
  };

  createEffect(() => {
    // Trigger resize when value changes
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
    <div class={styles.container}>
      <div class={styles.wrapper}>
        <div class={styles.inputContainer}>
          <div class={styles.textareaWrapper}>
            <textarea
              ref={textareaRef}
              value={value()}
              onInput={(e) => setValue(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              placeholder={props.placeholder ?? 'Type a message...'}
              disabled={props.isStreaming}
              rows={1}
              class={styles.textarea}
            />
          </div>

          <Show
            when={!props.isStreaming}
            fallback={
              <button onClick={handleCancel} class={`${styles.button} ${styles.cancelButton}`}>
                Cancel
              </button>
            }
          >
            <button
              onClick={handleSubmit}
              disabled={!value().trim()}
              class={`${styles.button} ${styles.submitButton}`}
            >
              Send
            </button>
          </Show>
        </div>

        <div class={styles.hint}>
          <Show when={!props.isStreaming} fallback={<span>Press Escape to cancel</span>}>
            <span>Enter to send, Shift+Enter for newline</span>
          </Show>
        </div>
      </div>
    </div>
  );
}
