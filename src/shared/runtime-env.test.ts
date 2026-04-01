import { afterEach, describe, expect, it } from "vitest";

import { applyPackagedServerRuntimeEnv } from "./runtime-env";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_LOG_PRETTY = process.env.LOG_PRETTY;

afterEach(() => {
  if (ORIGINAL_NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }

  if (ORIGINAL_LOG_PRETTY === undefined) {
    delete process.env.LOG_PRETTY;
  } else {
    process.env.LOG_PRETTY = ORIGINAL_LOG_PRETTY;
  }
});

describe("applyPackagedServerRuntimeEnv", () => {
  it("defaults packaged builds to production JSON logging", () => {
    delete process.env.NODE_ENV;
    delete process.env.LOG_PRETTY;

    applyPackagedServerRuntimeEnv(true);

    expect(process.env.NODE_ENV).toBe("production");
    expect(process.env.LOG_PRETTY).toBe("0");
  });

  it("preserves explicit logging overrides", () => {
    process.env.NODE_ENV = "staging";
    process.env.LOG_PRETTY = "1";

    applyPackagedServerRuntimeEnv(true);

    expect(process.env.NODE_ENV).toBe("staging");
    expect(process.env.LOG_PRETTY).toBe("1");
  });

  it("does nothing for dev builds", () => {
    delete process.env.NODE_ENV;
    delete process.env.LOG_PRETTY;

    applyPackagedServerRuntimeEnv(false);

    expect(process.env.NODE_ENV).toBeUndefined();
    expect(process.env.LOG_PRETTY).toBeUndefined();
  });
});
