import { describe, it, expect } from "vitest";
import { stripMarkdown } from "./markdown";

describe("stripMarkdown", () => {
  it("strips bold syntax", () => {
    expect(stripMarkdown("**bold text**")).toBe("bold text");
    expect(stripMarkdown("__bold text__")).toBe("bold text");
  });

  it("strips italic syntax", () => {
    expect(stripMarkdown("*italic text*")).toBe("italic text");
    expect(stripMarkdown("_italic text_")).toBe("italic text");
  });

  it("strips bold-italic syntax", () => {
    expect(stripMarkdown("***bold italic***")).toBe("bold italic");
    expect(stripMarkdown("___bold italic___")).toBe("bold italic");
  });

  it("strips strikethrough syntax", () => {
    expect(stripMarkdown("~~deleted~~")).toBe("deleted");
  });

  it("strips inline code", () => {
    expect(stripMarkdown("use `console.log` here")).toBe("use console.log here");
  });

  it("strips fenced code blocks", () => {
    expect(stripMarkdown("before\n```js\nconst x = 1;\n```\nafter")).toBe("before after");
  });

  it("strips tilde code blocks", () => {
    expect(stripMarkdown("before\n~~~\ncode\n~~~\nafter")).toBe("before after");
  });

  it("strips links, keeping text", () => {
    expect(stripMarkdown("[click here](https://example.com)")).toBe("click here");
  });

  it("strips images, keeping alt text", () => {
    expect(stripMarkdown("![logo](https://example.com/logo.png)")).toBe("logo");
  });

  it("strips headers", () => {
    expect(stripMarkdown("# Heading 1")).toBe("Heading 1");
    expect(stripMarkdown("## Heading 2")).toBe("Heading 2");
    expect(stripMarkdown("###### Heading 6")).toBe("Heading 6");
  });

  it("strips blockquotes", () => {
    expect(stripMarkdown("> quoted text")).toBe("quoted text");
  });

  it("strips unordered list markers (dash)", () => {
    expect(stripMarkdown("- item one\n- item two")).toBe("item one item two");
  });

  it("strips unordered list markers (plus)", () => {
    expect(stripMarkdown("+ item one\n+ item two")).toBe("item one item two");
  });

  it("strips ordered list markers", () => {
    expect(stripMarkdown("1. first\n2. second")).toBe("first second");
  });

  it("strips horizontal rules", () => {
    expect(stripMarkdown("above\n---\nbelow")).toBe("above below");
    expect(stripMarkdown("above\n***\nbelow")).toBe("above below");
  });

  it("collapses multiple newlines into spaces", () => {
    expect(stripMarkdown("line one\n\n\nline two")).toBe("line one line two");
  });

  it("handles nested syntax", () => {
    expect(stripMarkdown("**[bold link](url)**")).toBe("bold link");
  });

  it("returns empty string for empty input", () => {
    expect(stripMarkdown("")).toBe("");
  });

  it("returns plain text unchanged", () => {
    expect(stripMarkdown("just plain text")).toBe("just plain text");
  });

  it("preserves underscores in identifiers", () => {
    expect(stripMarkdown("foo_bar_baz")).toBe("foo_bar_baz");
    expect(stripMarkdown("my_file_name.py")).toBe("my_file_name.py");
    expect(stripMarkdown("SOME_CONSTANT_VALUE")).toBe("SOME_CONSTANT_VALUE");
  });

  it("preserves asterisks in identifiers", () => {
    expect(stripMarkdown("foo*bar*baz")).toBe("foo*bar*baz");
  });

  it("strips emphasis mid-sentence", () => {
    expect(stripMarkdown("hello **world** today")).toBe("hello world today");
    expect(stripMarkdown("hello __world__ today")).toBe("hello world today");
    expect(stripMarkdown("hello *world* today")).toBe("hello world today");
    expect(stripMarkdown("hello _world_ today")).toBe("hello world today");
  });

  it("strips emphasis followed by punctuation", () => {
    expect(stripMarkdown("**bold**.")).toBe("bold.");
    expect(stripMarkdown("**bold**, then more")).toBe("bold, then more");
  });

  it("strips multiple emphasis in one line", () => {
    expect(stripMarkdown("**hello** and **world**")).toBe("hello and world");
  });
});
