import { describe, it, expect, vi, afterEach } from "vitest";
import { timeAgo } from "./time";

describe("timeAgo", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const now = 1_700_000_000_000;
  const ms = (n: number) => n;
  const sec = (n: number) => n * 1000;
  const min = (n: number) => sec(n * 60);
  const hr = (n: number) => min(n * 60);
  const day = (n: number) => hr(n * 24);

  function at(offset: number) {
    vi.setSystemTime(now);
    return now - offset;
  }

  describe("compact (default)", () => {
    it('returns "just now" for <1 minute', () => {
      expect(timeAgo(at(sec(30)))).toBe("just now");
    });

    it('returns "just now" at 59999ms', () => {
      expect(timeAgo(at(ms(59_999)))).toBe("just now");
    });

    it('returns "1m" at exactly 60s', () => {
      expect(timeAgo(at(min(1)))).toBe("1m");
    });

    it("returns minutes for <1 hour", () => {
      expect(timeAgo(at(min(45)))).toBe("45m");
    });

    it('returns "1h" at exactly 60 minutes', () => {
      expect(timeAgo(at(hr(1)))).toBe("1h");
    });

    it("returns hours for <24 hours", () => {
      expect(timeAgo(at(hr(23)))).toBe("23h");
    });

    it('returns "1d" at exactly 24 hours', () => {
      expect(timeAgo(at(day(1)))).toBe("1d");
    });

    it("returns days for large values", () => {
      expect(timeAgo(at(day(30)))).toBe("30d");
    });
  });

  describe("verbose", () => {
    it('returns "just now" (no suffix) for <1 minute', () => {
      expect(timeAgo(at(sec(5)), "verbose")).toBe("just now");
    });

    it('appends " ago" to minutes', () => {
      expect(timeAgo(at(min(3)), "verbose")).toBe("3m ago");
    });

    it('appends " ago" to hours', () => {
      expect(timeAgo(at(hr(5)), "verbose")).toBe("5h ago");
    });

    it('appends " ago" to days', () => {
      expect(timeAgo(at(day(7)), "verbose")).toBe("7d ago");
    });
  });

  describe("edge cases", () => {
    it('returns "just now" for future timestamps (clock skew)', () => {
      vi.setSystemTime(now);
      expect(timeAgo(now + min(5))).toBe("just now");
    });

    it('returns "just now" for exact current time', () => {
      expect(timeAgo(at(0))).toBe("just now");
    });
  });
});
