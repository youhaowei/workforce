/**
 * Markdown text utilities for plain-text display contexts (sidebar, previews).
 */

/**
 * Strip common markdown syntax to produce readable plain text.
 * Handles: bold, italic, strikethrough, code, links, images, headers, lists, blockquotes.
 */
export function stripMarkdown(text: string): string {
  return (
    text
      // Fenced code blocks: ```lang\ncode\n``` or ~~~code~~~
      .replace(/```[\s\S]*?```/g, "")
      .replace(/~~~[\s\S]*?~~~/g, "")
      // Images: ![alt](url) → alt
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      // Links: [text](url) → text
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      // Bold/italic: only strip when delimiters are at word boundaries
      // (preceded by whitespace/start, followed by whitespace/punctuation/end)
      // to avoid corrupting identifiers like foo_bar_baz or filenames
      .replace(/(^|\s)\*{1,3}([^*]+)\*{1,3}(?=[\s.,;:!?)\]]|$)/gm, "$1$2")
      .replace(/(^|\s)_{1,3}([^_]+)_{1,3}(?=[\s.,;:!?)\]]|$)/gm, "$1$2")
      // Strikethrough: ~~text~~
      .replace(/~~([^~]+)~~/g, "$1")
      // Inline code: `code`
      .replace(/`([^`]+)`/g, "$1")
      // Headers: ## Heading
      .replace(/^#{1,6}\s+/gm, "")
      // Blockquotes: > text
      .replace(/^>\s+/gm, "")
      // Unordered list markers: - item, * item
      .replace(/^[\s]*[-*+]\s+/gm, "")
      // Ordered list markers: 1. item
      .replace(/^[\s]*\d+\.\s+/gm, "")
      // Horizontal rules: --- or ***
      .replace(/^[-*]{3,}\s*$/gm, "")
      // Collapse multiple whitespace/newlines
      .replace(/\n{2,}/g, " ")
      .replace(/\n/g, " ")
      .trim()
  );
}
