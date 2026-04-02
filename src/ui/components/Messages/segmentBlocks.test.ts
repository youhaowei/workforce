import { describe, it, expect } from 'vitest';
import { segmentBlocks } from './segmentBlocks';
import type { ContentBlock } from '@/services/types';

function text(t: string, status: 'running' | 'complete' = 'complete'): ContentBlock {
  return { type: 'text', text: t, status };
}

function thinking(t: string, status: 'running' | 'complete' = 'complete'): ContentBlock {
  return { type: 'thinking', text: t, status };
}

function tool(name: string, status: 'running' | 'complete' | 'error' = 'complete'): ContentBlock {
  return { type: 'tool_use', id: `tool_${name}_${Math.random()}`, name, input: '', status };
}

function question(status: 'running' | 'complete' = 'running'): ContentBlock {
  return { type: 'tool_use', id: 'q1', name: 'AskUserQuestion', input: '', status, inputRaw: { questions: [{ question: 'Pick one' }] } };
}

describe('segmentBlocks', () => {
  it('returns empty array for no blocks', () => {
    expect(segmentBlocks([])).toEqual([]);
  });

  it('groups consecutive thinking blocks into one segment', () => {
    const blocks = [thinking('a'), thinking('b')];
    const result = segmentBlocks(blocks);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('thinking');
    if (result[0].kind === 'thinking') {
      expect(result[0].blocks).toHaveLength(2);
    }
  });

  it('groups consecutive tool_use blocks into one activity segment', () => {
    const blocks = [tool('Read'), tool('Grep'), tool('Read')];
    const result = segmentBlocks(blocks);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('activity');
    if (result[0].kind === 'activity') {
      expect(result[0].blocks).toHaveLength(3);
    }
  });

  it('groups consecutive text blocks into one text segment', () => {
    const blocks = [text('hello'), text('world')];
    const result = segmentBlocks(blocks);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('text');
    if (result[0].kind === 'text') {
      expect(result[0].blocks).toHaveLength(2);
    }
  });

  it('creates standalone question segment for AskUserQuestion', () => {
    const blocks = [tool('Read'), question(), text('follow-up')];
    const result = segmentBlocks(blocks);
    expect(result).toHaveLength(3);
    expect(result[0].kind).toBe('activity');
    expect(result[1].kind).toBe('question');
    expect(result[2].kind).toBe('text');
  });

  it('splits different block types into separate segments', () => {
    const blocks = [
      thinking('hmm'),
      tool('Read'),
      tool('Grep'),
      text('Here is what I found'),
      tool('Edit'),
      text('Done editing'),
    ];
    const result = segmentBlocks(blocks);
    expect(result.map((s) => s.kind)).toEqual([
      'thinking', 'activity', 'text', 'activity', 'text',
    ]);
  });

  it('handles realistic agent flow: think → tools → text → question → text', () => {
    const blocks = [
      thinking('Let me think...'),
      thinking('I should search for files'),
      tool('Glob'),
      tool('Read'),
      tool('Read'),
      text('I found the relevant files. Let me ask a question.'),
      question(),
      text('Based on your answer, here is the result.'),
    ];
    const result = segmentBlocks(blocks);
    expect(result.map((s) => s.kind)).toEqual([
      'thinking', 'activity', 'text', 'question', 'text',
    ]);
    // Thinking segment has both thinking blocks
    if (result[0].kind === 'thinking') {
      expect(result[0].blocks).toHaveLength(2);
    }
    // Activity segment has 3 tools
    if (result[1].kind === 'activity') {
      expect(result[1].blocks).toHaveLength(3);
    }
  });

  it('interleaved text and tools create alternating segments', () => {
    const blocks = [
      text('Planning...'),
      tool('Read'),
      text('Found file, now searching...'),
      tool('Grep'),
      tool('Grep'),
      text('Here are the results.'),
    ];
    const result = segmentBlocks(blocks);
    expect(result.map((s) => s.kind)).toEqual([
      'text', 'activity', 'text', 'activity', 'text',
    ]);
  });

  it('question between tools splits activity segments', () => {
    const blocks = [tool('Read'), question(), tool('Edit')];
    const result = segmentBlocks(blocks);
    expect(result.map((s) => s.kind)).toEqual([
      'activity', 'question', 'activity',
    ]);
  });
});
