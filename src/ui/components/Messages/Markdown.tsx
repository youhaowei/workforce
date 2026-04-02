/**
 * Markdown - Lightweight markdown renderer using marked + DOMPurify
 *
 * Features:
 * - Full GFM support (tables, strikethrough, task lists)
 * - XSS-safe via DOMPurify sanitization
 * - Memoized for streaming performance
 */

import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

// Configure marked for GFM
marked.setOptions({
  gfm: true,
  breaks: true,
});

interface MarkdownProps {
  content: string;
  className?: string;
}

export default function Markdown({ content, className }: MarkdownProps) {
  const html = useMemo(() => {
    if (!content) return "";
    const parsed = marked.parse(content, { async: false }) as string;
    return DOMPurify.sanitize(parsed);
  }, [content]);

  return (
    <div
      className={`markdown-content ${className ?? ""}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
