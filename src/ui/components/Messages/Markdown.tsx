/**
 * Markdown - Lightweight markdown renderer using marked + DOMPurify
 *
 * Features:
 * - Full GFM support (tables, strikethrough, task lists)
 * - XSS-safe via DOMPurify sanitization
 * - Memoized for streaming performance
 */

import { createMemo } from 'solid-js';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Configure marked for GFM
marked.setOptions({
  gfm: true,
  breaks: true,
});

interface MarkdownProps {
  content: string;
  class?: string;
}

export default function Markdown(props: MarkdownProps) {
  const html = createMemo(() => {
    if (!props.content) return '';
    const parsed = marked.parse(props.content, { async: false }) as string;
    return DOMPurify.sanitize(parsed);
  });

  return (
    <div
      class={`markdown-content ${props.class ?? ''}`}
      innerHTML={html()}
    />
  );
}
