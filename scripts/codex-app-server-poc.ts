import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "child_process";
import { mkdtemp, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import readline from "readline";

type JsonRpcId = number;

interface JsonRpcResponse {
  id?: JsonRpcId;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

interface JsonRpcNotification {
  method?: string;
  params?: unknown;
}

interface PendingRequest {
  method: string;
  timeout: ReturnType<typeof setTimeout>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface PocOptions {
  binaryPath: string;
  cwd: string;
  prompt: string;
  model?: string;
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 45_000;
const TURN_COMPLETE_METHODS = new Set([
  "turn/completed",
  "turn/failed",
  "thread/status/changed",
]);

function parseArgs(): PocOptions {
  const args = process.argv.slice(2);
  let binaryPath = process.env.CODEX_BIN ?? "codex";
  let cwd = "";
  let prompt = "Reply with exactly: workforce-codex-poc-ok";
  let model: string | undefined;
  let timeoutMs = Number(process.env.CODEX_POC_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === "--bin" && next) {
      binaryPath = next;
      i += 1;
    } else if (arg === "--cwd" && next) {
      cwd = next;
      i += 1;
    } else if (arg === "--prompt" && next) {
      prompt = next;
      i += 1;
    } else if (arg === "--model" && next) {
      model = next;
      i += 1;
    } else if (arg === "--timeout-ms" && next) {
      timeoutMs = Number(next);
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: bun run poc:codex [--bin codex] [--cwd DIR] [--model MODEL] [--prompt TEXT] [--timeout-ms MS]`);
      process.exit(0);
    }
  }

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Invalid --timeout-ms value: ${timeoutMs}`);
  }

  return {
    binaryPath,
    cwd,
    prompt,
    ...(model ? { model } : {}),
    timeoutMs,
  };
}

function killCodexChildProcess(child: ChildProcessWithoutNullStreams): void {
  if (process.platform === "win32" && child.pid !== undefined) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  child.kill();
}

class CodexAppServerPoc {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly output: readline.Interface;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private nextId = 1;
  private turnFinished = false;
  readonly notifications: JsonRpcNotification[] = [];

  constructor(private readonly options: PocOptions) {
    this.child = spawn(options.binaryPath, ["app-server"], {
      cwd: options.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    this.output = readline.createInterface({ input: this.child.stdout });
  }

  async run(): Promise<void> {
    this.attachListeners();
    await this.request("initialize", {
      clientInfo: {
        name: "workforce_codex_poc",
        title: "Workforce Codex POC",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    this.write({ method: "initialized" });

    const account = await this.tryRequest("account/read", {});
    const models = await this.tryRequest("model/list", {});
    const thread = await this.request("thread/start", {
      cwd: this.options.cwd,
      approvalPolicy: "untrusted",
      sandbox: "read-only",
      experimentalRawEvents: false,
      ...(this.options.model ? { model: this.options.model } : {}),
    });
    const providerThreadId = readThreadId(thread);

    await this.request("turn/start", {
      threadId: providerThreadId,
      input: [
        {
          type: "text",
          text: this.options.prompt,
          text_elements: [],
        },
      ],
      ...(this.options.model ? { model: this.options.model } : {}),
    });

    await this.waitForTurn(providerThreadId);

    console.log(
      JSON.stringify(
        {
          ok: true,
          codexVersion: readCodexVersion(this.options.binaryPath),
          cwd: this.options.cwd,
          providerThreadId,
          account: summarizeAccount(account),
          modelCount: summarizeModelCount(models),
          notifications: summarizeNotifications(this.notifications),
          text: collectText(this.notifications),
        },
        null,
        2,
      ),
    );
  }

  close(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`Codex app-server closed before ${pending.method} completed.`));
    }
    this.pending.clear();
    this.output.close();
    if (!this.child.killed) killCodexChildProcess(this.child);
  }

  private attachListeners(): void {
    this.output.on("line", (line) => this.handleLine(line));
    this.child.stderr.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) console.error(`[codex stderr] ${text}`);
    });
    this.child.once("error", (error) => {
      this.failAll(error instanceof Error ? error : new Error(String(error)));
    });
    this.child.once("exit", (code, signal) => {
      if (this.pending.size > 0) {
        this.failAll(
          new Error(`codex app-server exited early (code=${code ?? "null"}, signal=${signal ?? "null"}).`),
        );
      }
    });
  }

  private handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      console.error(`[codex invalid-json] ${line}`);
      return;
    }

    if (!parsed || typeof parsed !== "object") return;

    const response = parsed as JsonRpcResponse;
    if (typeof response.id === "number") {
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      clearTimeout(pending.timeout);
      if (response.error) {
        pending.reject(new Error(`${pending.method} failed: ${response.error.message ?? "unknown error"}`));
      } else {
        pending.resolve(response.result);
      }
      return;
    }

    const notification = parsed as JsonRpcNotification;
    if (notification.method) {
      this.notifications.push(notification);
      if (isTurnFinished(notification)) this.turnFinished = true;
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${this.options.timeoutMs}ms.`));
      }, this.options.timeoutMs);
      this.pending.set(id, { method, timeout, resolve, reject });
      this.write({ id, method, params });
    });
  }

  private async tryRequest(method: string, params: unknown): Promise<unknown> {
    try {
      return await this.request(method, params);
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private write(message: unknown): void {
    if (!this.child.stdin.writable) {
      throw new Error("Cannot write to codex app-server stdin.");
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private waitForTurn(threadId: string): Promise<void> {
    if (this.turnFinished) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const interval = setInterval(() => {
        if (this.turnFinished) {
          clearInterval(interval);
          resolve();
          return;
        }
        if (Date.now() - startedAt > this.options.timeoutMs) {
          clearInterval(interval);
          const seen = this.notifications.map((event) => event.method).filter(Boolean);
          reject(new Error(`turn did not complete for ${threadId}; saw notifications: ${seen.join(", ")}`));
        }
      }, 100);
    });
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function readThreadId(result: unknown): string {
  if (!result || typeof result !== "object") {
    throw new Error("thread/start returned a non-object result.");
  }
  const record = result as Record<string, unknown>;
  const thread = record.thread;
  if (thread && typeof thread === "object") {
    const id = (thread as Record<string, unknown>).id;
    if (typeof id === "string") return id;
  }
  if (typeof record.threadId === "string") return record.threadId;
  throw new Error("thread/start response did not include a thread id.");
}

function isTurnFinished(notification: JsonRpcNotification): boolean {
  if (!notification.method || !TURN_COMPLETE_METHODS.has(notification.method)) return false;
  if (notification.method !== "thread/status/changed") return true;
  const params = notification.params;
  if (!params || typeof params !== "object") return false;
  const status = (params as Record<string, unknown>).status;
  return status === "idle" || status === "ready";
}

function summarizeNotifications(notifications: JsonRpcNotification[]) {
  const counts = new Map<string, number>();
  for (const notification of notifications) {
    if (!notification.method) continue;
    counts.set(notification.method, (counts.get(notification.method) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function collectText(notifications: JsonRpcNotification[]): string {
  return notifications
    .map((notification) => {
      const params = notification.params;
      if (!params || typeof params !== "object") return "";
      const record = params as Record<string, unknown>;
      if (typeof record.delta === "string") return record.delta;
      if (typeof record.text === "string") return record.text;
      return "";
    })
    .join("");
}

function summarizeAccount(account: unknown): unknown {
  if (!account || typeof account !== "object") return account;
  const record = account as Record<string, unknown>;
  return {
    type: record.type,
    planType: record.planType,
    sparkEnabled: record.sparkEnabled,
  };
}

function summarizeModelCount(models: unknown): number | null {
  if (!models || typeof models !== "object") return null;
  const record = models as Record<string, unknown>;
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) return value.length;
  }
  return null;
}

function readCodexVersion(binaryPath: string): string | null {
  const result = spawnSync(binaryPath, ["--version"], { encoding: "utf-8" });
  return result.stdout.trim() || null;
}

async function main(): Promise<void> {
  const options = parseArgs();
  const cwd = options.cwd || (await mkdtemp(join(tmpdir(), "workforce-codex-poc-")));
  await writeFile(join(cwd, "README.md"), "Temporary workspace for the Workforce Codex app-server POC.\n");

  const poc = new CodexAppServerPoc({ ...options, cwd });
  try {
    await poc.run();
  } finally {
    poc.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
