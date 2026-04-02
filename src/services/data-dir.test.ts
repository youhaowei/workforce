import { describe, it, expect, afterEach } from "vitest";
import { join } from "path";
import { homedir } from "os";
import { getDataDir } from "./data-dir";

describe("getDataDir", () => {
  const original = process.env.WORKFORCE_DATA_DIR;

  afterEach(() => {
    if (original === undefined) delete process.env.WORKFORCE_DATA_DIR;
    else process.env.WORKFORCE_DATA_DIR = original;
  });

  it("resolves relative path to absolute from cwd", () => {
    process.env.WORKFORCE_DATA_DIR = ".workforce-dev";
    const result = getDataDir();
    expect(result).toBe(join(process.cwd(), ".workforce-dev"));
    expect(result).toMatch(/^\//); // absolute
  });

  it("returns absolute path as-is", () => {
    process.env.WORKFORCE_DATA_DIR = "/tmp/workforce-custom";
    expect(getDataDir()).toBe("/tmp/workforce-custom");
  });

  it("falls back to ~/.workforce when env var is unset", () => {
    delete process.env.WORKFORCE_DATA_DIR;
    expect(getDataDir()).toBe(join(homedir(), ".workforce"));
  });

  it("falls back to ~/.workforce when env var is empty string", () => {
    process.env.WORKFORCE_DATA_DIR = "";
    expect(getDataDir()).toBe(join(homedir(), ".workforce"));
  });
});
