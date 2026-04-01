import { describe, expect, it, vi } from "vitest";

import { bindWithRetry, parsePort } from "./port-utils";

describe("parsePort", () => {
  it("returns the fallback when the value is missing or invalid", () => {
    expect(parsePort(undefined, 19675)).toBe(19675);
    expect(parsePort("not-a-port", 19675)).toBe(19675);
    expect(parsePort("-1", 19675)).toBe(19675);
    expect(parsePort("70000", 19675)).toBe(19675);
  });

  it("rejects port 0 (OS-assigned)", () => {
    expect(parsePort("0", 19675)).toBe(19675);
  });

  it("accepts boundary values 1 and 65535", () => {
    expect(parsePort("1", 19675)).toBe(1);
    expect(parsePort("65535", 19675)).toBe(65535);
  });

  it("returns the parsed port for valid input", () => {
    expect(parsePort("19680", 19675)).toBe(19680);
  });
});

describe("bindWithRetry", () => {
  it("returns the server and port on first successful bind", async () => {
    const { createServer } = await import("net");
    // Use a high ephemeral port to avoid conflicts
    const { server, port } = await bindWithRetry(49152, 20, (candidate) => {
      const srv = createServer();
      srv.listen(candidate, "localhost");
      return srv;
    });

    try {
      const addr = server.address();
      const boundPort = typeof addr === "object" && addr ? addr.port : 0;
      expect(boundPort).toBe(port);
      expect(port).toBeGreaterThanOrEqual(49152);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("retries on EADDRINUSE and succeeds on next port", async () => {
    const { createServer } = await import("net");
    // Occupy a port
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, "localhost", resolve));
    const addr = blocker.address();
    const blockedPort = typeof addr === "object" && addr ? addr.port : 0;

    const onRetry = vi.fn();
    const { server, port } = await bindWithRetry(
      blockedPort,
      5,
      (candidate) => {
        const srv = createServer();
        srv.listen(candidate, "localhost");
        return srv;
      },
      onRetry,
    );

    try {
      expect(port).toBeGreaterThan(blockedPort);
      expect(onRetry).toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });

  it("throws when all retries exhausted", async () => {
    const { createServer } = await import("net");
    await expect(
      bindWithRetry(1, 1, (_candidate) => {
        const srv = createServer();
        process.nextTick(() => {
          const err = new Error("EADDRINUSE") as NodeJS.ErrnoException;
          err.code = "EADDRINUSE";
          srv.emit("error", err);
        });
        return srv;
      }),
    ).rejects.toThrow("All ports 1-2 are in use");
  });

  it("re-throws non-EADDRINUSE errors without retrying", async () => {
    const { createServer } = await import("net");
    const onRetry = vi.fn();

    const rejection = bindWithRetry(
      1,
      5,
      (_candidate) => {
        const srv = createServer();
        process.nextTick(() => {
          const err = new Error("Permission denied") as NodeJS.ErrnoException;
          err.code = "EACCES";
          srv.emit("error", err);
        });
        return srv;
      },
      onRetry,
    );

    await expect(rejection).rejects.toThrow("Permission denied");
    expect(onRetry).not.toHaveBeenCalled();
  });
});
