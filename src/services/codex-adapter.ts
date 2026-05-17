import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "child_process";
import readline from "readline";
import type { AgentStreamEvent, AgentPermissionMode, Result, StreamResult } from "./types";
import { createLogger } from "tracey";

const log = createLogger("CodexAdapter");

type JsonRpcId = number;

interface JsonRpcResponse {
  id?: JsonRpcId;
  result?: unknown;
  error?: {
    message?: string;
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

export interface CodexQueryOptions {
  model?: string;
  cwd?: string;
  permissionMode?: AgentPermissionMode;
  signal?: AbortSignal;
  binaryPath?: string;
  timeoutMs?: number;
}

export interface CodexQueryHandle {
  events: StreamResult<AgentStreamEvent>;
  abort(): void;
}

class CodexAppServerSession {
  private child: ChildProcessWithoutNullStreams | null = null;
  private output: readline.Interface | null = null;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private nextId = 1;
  private aborted = false;
  private turnFinished = false;
  private readonly queue: AgentStreamEvent[] = [];
  private wake: (() => void) | null = null;

  constructor(
    private readonly prompt: string,
    private readonly options: Required<Pick<CodexQueryOptions, "timeoutMs" | "binaryPath">> &
      Omit<CodexQueryOptions, "timeoutMs" | "binaryPath">,
  ) {}

  async *run(): StreamResult<AgentStreamEvent> {
    try {
      yield { type: "status", message: "Starting Codex" };
      const providerThreadId = await this.start();
      yield { type: "status", message: "Codex thread ready" };
      await this.sendTurn(providerThreadId);

      while (!this.turnFinished || this.queue.length > 0) {
        while (this.queue.length > 0) yield this.queue.shift()!;
        if (this.turnFinished) break;
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
      }

      if (this.aborted) {
        yield { type: "token", token: " [cancelled]" };
      }
      yield { type: "turn_complete" };
    } finally {
      this.close();
    }
  }

  abort(): void {
    this.aborted = true;
    this.failAll(new Error("Codex run aborted"));
    this.close();
    this.turnFinished = true;
    this.wake?.();
    this.wake = null;
  }

  private async start(): Promise<string> {
    const cwd = this.options.cwd ?? process.cwd();
    this.child = spawn(this.options.binaryPath, ["app-server"], {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    this.output = readline.createInterface({ input: this.child.stdout });
    this.attachListeners();

    await this.request("initialize", {
      clientInfo: {
        name: "workforce",
        title: "Workforce",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    this.write({ method: "initialized" });

    const thread = await this.request("thread/start", {
      cwd,
      ...mapPermissionMode(this.options.permissionMode ?? "default"),
      experimentalRawEvents: false,
      ...(this.options.model ? { model: this.options.model } : {}),
    });
    return readThreadId(thread);
  }

  private async sendTurn(providerThreadId: string): Promise<void> {
    await this.request("turn/start", {
      threadId: providerThreadId,
      input: [
        {
          type: "text",
          text: this.prompt,
          text_elements: [],
        },
      ],
      ...(this.options.model ? { model: this.options.model } : {}),
    });
  }

  private attachListeners(): void {
    if (!this.child || !this.output) return;

    this.output.on("line", (line) => this.handleLine(line));
    this.child.stderr.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) log.warn({ text }, "codex stderr");
    });
    this.child.once("error", (error) => this.failAll(error));
    this.child.once("exit", (code, signal) => {
      if (this.pending.size > 0 && !this.aborted) {
        this.failAll(
          new Error(`codex app-server exited early (code=${code ?? "null"}, signal=${signal ?? "null"})`),
        );
      }
      this.turnFinished = true;
      this.wake?.();
    });
    this.options.signal?.addEventListener("abort", () => this.abort(), { once: true });
  }

  private handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      log.warn({ line }, "invalid codex json");
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
    this.handleNotification(notification);
  }

  private handleNotification(notification: JsonRpcNotification): void {
    if (!notification.method) return;
    if (notification.method === "item/agentMessage/delta") {
      const text = readTextDelta(notification.params);
      if (text) this.queue.push({ type: "token", token: text });
      this.wake?.();
      this.wake = null;
      return;
    }
    if (notification.method === "turn/completed" || isIdleStatus(notification)) {
      this.turnFinished = true;
      this.wake?.();
      this.wake = null;
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${this.options.timeoutMs}ms`));
      }, this.options.timeoutMs);
      this.pending.set(id, { method, timeout, resolve, reject });
      this.write({ id, method, params });
    });
  }

  private write(message: unknown): void {
    if (!this.child?.stdin.writable) throw new Error("Cannot write to codex app-server stdin");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    this.turnFinished = true;
    this.wake?.();
  }

  private close(): void {
    for (const pending of this.pending.values()) clearTimeout(pending.timeout);
    this.pending.clear();
    this.output?.close();
    if (this.child && !this.child.killed) killCodexChildProcess(this.child);
    this.child = null;
    this.output = null;
  }
}

export function runCodexQuery(
  prompt: string,
  options: CodexQueryOptions = {},
): Result<CodexQueryHandle> {
  try {
    const session = new CodexAppServerSession(prompt, {
      ...options,
      binaryPath: options.binaryPath ?? process.env.CODEX_BIN ?? "codex",
      timeoutMs: options.timeoutMs ?? 60_000,
    });
    return {
      ok: true,
      value: {
        events: session.run(),
        abort: () => session.abort(),
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

function mapPermissionMode(mode: AgentPermissionMode): {
  approvalPolicy: "untrusted" | "on-request" | "never";
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
} {
  if (mode === "plan") return { approvalPolicy: "untrusted", sandbox: "read-only" };
  if (mode === "bypassPermissions") return { approvalPolicy: "never", sandbox: "danger-full-access" };
  return { approvalPolicy: "on-request", sandbox: "workspace-write" };
}

function readThreadId(result: unknown): string {
  if (!result || typeof result !== "object") {
    throw new Error("thread/start returned a non-object result");
  }
  const record = result as Record<string, unknown>;
  const thread = record.thread;
  if (thread && typeof thread === "object") {
    const id = (thread as Record<string, unknown>).id;
    if (typeof id === "string") return id;
  }
  if (typeof record.threadId === "string") return record.threadId;
  throw new Error("thread/start response did not include a thread id");
}

function readTextDelta(params: unknown): string {
  if (!params || typeof params !== "object") return "";
  const record = params as Record<string, unknown>;
  if (typeof record.delta === "string") return record.delta;
  if (typeof record.text === "string") return record.text;
  return "";
}

function isIdleStatus(notification: JsonRpcNotification): boolean {
  if (notification.method !== "thread/status/changed") return false;
  const params = notification.params;
  if (!params || typeof params !== "object") return false;
  const status = (params as Record<string, unknown>).status;
  return status === "idle" || status === "ready";
}

function killCodexChildProcess(child: ChildProcessWithoutNullStreams): void {
  if (process.platform === "win32" && child.pid !== undefined) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  child.kill();
}
