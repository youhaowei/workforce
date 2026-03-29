interface RendererCspOptions {
  isDev: boolean;
  rendererPort: number;
  serverPort?: number | null;
}

export function buildRendererContentSecurityPolicy({
  isDev,
  rendererPort,
  serverPort,
}: RendererCspOptions): string {
  const rendererOrigin = `http://localhost:${rendererPort}`;
  const apiOrigin = serverPort ? `http://localhost:${serverPort}` : rendererOrigin;
  const connectSrc = new Set(["'self'", rendererOrigin, apiOrigin]);
  const scriptSrc = new Set(["'self'"]);

  if (isDev) {
    connectSrc.add('ws://localhost:*');
    connectSrc.add('http://localhost:*');
    scriptSrc.add("'unsafe-eval'");
    scriptSrc.add("'unsafe-inline'");
  }

  return [
    "default-src 'self'",
    `script-src ${Array.from(scriptSrc).join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: http://localhost:*",
    "font-src 'self' data:",
    `connect-src ${Array.from(connectSrc).join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}
