export function applyPackagedServerRuntimeEnv(isPackaged: boolean): void {
  if (!isPackaged) return;

  process.env.NODE_ENV ??= "production";
  process.env.LOG_PRETTY ??= "0";
}
