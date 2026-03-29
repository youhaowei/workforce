import { describe, it, expect } from 'vitest';
import { parsePort } from './port-utils';

describe('parsePort', () => {
  it('returns fallback for undefined input', () => {
    expect(parsePort(undefined, 19675)).toBe(19675);
  });

  it('returns fallback for empty string', () => {
    expect(parsePort('', 19675)).toBe(19675);
  });

  it('parses valid port string', () => {
    expect(parsePort('8080', 19675)).toBe(8080);
  });

  it('returns fallback for non-numeric string', () => {
    expect(parsePort('abc', 19675)).toBe(19675);
  });

  it('returns fallback for NaN-producing input', () => {
    expect(parsePort('NaN', 19675)).toBe(19675);
  });

  it('parses port with leading zeros (radix 10)', () => {
    expect(parsePort('0080', 19675)).toBe(80);
  });

  it('handles negative port numbers', () => {
    // parseInt will parse -1, which is technically a valid number
    expect(parsePort('-1', 19675)).toBe(-1);
  });
});
