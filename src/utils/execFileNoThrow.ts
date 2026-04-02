/**
 * Safe command execution utility
 *
 * Uses execFile instead of exec to prevent shell injection.
 * Provides structured output with proper error handling.
 */

import { execFile, type ExecFileOptions } from "child_process";

export interface ExecResult {
  status: "success" | "error" | "timeout";
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface ExecOptions {
  cwd?: string;
  timeout?: number;
  env?: NodeJS.ProcessEnv;
}

/**
 * Execute a command safely using execFile.
 * Does not throw on non-zero exit codes - returns structured result instead.
 */
export function execFileNoThrow(
  command: string,
  args: string[],
  options: ExecOptions = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const execOptions: ExecFileOptions = {
      cwd: options.cwd,
      timeout: options.timeout,
      env: options.env ?? process.env,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    };

    execFile(command, args, execOptions, (error, stdout, stderr) => {
      if (error) {
        // Check for timeout (error object has 'killed' when process was killed)
        const errorWithKilled = error as Error & { killed?: boolean; code?: number | string };
        if (errorWithKilled.killed) {
          resolve({
            status: "timeout",
            stdout: stdout?.toString() ?? "",
            stderr: stderr?.toString() ?? "",
            exitCode: null,
          });
          return;
        }

        // Regular error (non-zero exit code)
        const exitCode = typeof errorWithKilled.code === "number" ? errorWithKilled.code : 1;

        resolve({
          status: "error",
          stdout: stdout?.toString() ?? "",
          stderr: stderr?.toString() ?? "",
          exitCode,
        });
        return;
      }

      resolve({
        status: "success",
        stdout: stdout?.toString() ?? "",
        stderr: stderr?.toString() ?? "",
        exitCode: 0,
      });
    });
  });
}
