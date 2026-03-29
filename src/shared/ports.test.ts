import { describe, it, expect } from 'vitest';
import { parsePort } from '@/shared/ports';

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

  it('returns fallback for negative port numbers', () => {
    expect(parsePort('-1', 19675)).toBe(19675);
  });

  it('returns fallback for port above 65535', () => {
    expect(parsePort('70000', 19675)).toBe(19675);
  });

  it('returns fallback for port 0', () => {
    expect(parsePort('0', 19675)).toBe(19675);
  });

  it('accepts port 1', () => {
    expect(parsePort('1', 19675)).toBe(1);
  });

  it('accepts port 65535', () => {
    expect(parsePort('65535', 19675)).toBe(65535);
  });
});
