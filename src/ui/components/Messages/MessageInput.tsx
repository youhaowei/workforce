/**
 * MessageInput - Chat input component with auto-resizing textarea.
 */

import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Send, Square } from 'lucide-react';

interface MessageInputProps {
  onSubmit: (message: string) => void;
  onCancel?: () => void;
  isStreaming: boolean;
  placeholder?: string;
}

export default function MessageInput({ onSubmit, onCancel, isStreaming, placeholder }: MessageInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed && !isStreaming) {
      onSubmit(trimmed);
      setValue('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  }, [value, isStreaming, onSubmit]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      } else if (e.key === 'Escape') {
        if (isStreaming && onCancel) {
          onCancel();
        } else {
          setValue('');
        }
      }
    },
    [handleSubmit, isStreaming, onCancel],
  );

  const handleCancel = useCallback(() => {
    onCancel?.();
  }, [onCancel]);

  return (
    <div className="flex-shrink-0 px-6 py-3 border-t bg-background/80 backdrop-blur-sm">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-stretch gap-3 rounded-xl border bg-card px-4 py-2 shadow-sm focus-within:ring-1 focus-within:ring-ring transition-all">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder ?? 'Ask Workforce anything...'}
            disabled={isStreaming}
            rows={1}
            className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground resize-none outline-none text-sm min-h-[36px] max-h-[200px] disabled:opacity-50 py-2"
          />

          <div className="flex items-end">
            {isStreaming ? (
              <Button variant="outline" size="sm" onClick={handleCancel}>
                <Square className="h-3.5 w-3.5 mr-1.5" />
                Stop
              </Button>
            ) : (
              <Button
                size="icon"
                onClick={handleSubmit}
                disabled={!value.trim()}
                className="h-9 w-9"
                title="Send (Enter)"
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            <kbd className="px-1.5 py-0.5 rounded bg-muted border font-mono text-[10px]">Enter</kbd>
            {' '}to send &middot;{' '}
            <kbd className="px-1.5 py-0.5 rounded bg-muted border font-mono text-[10px]">Shift+Enter</kbd>
            {' '}for newline
          </span>
          {isStreaming && (
            <span className="text-muted-foreground flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              Workforce is thinking...
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
