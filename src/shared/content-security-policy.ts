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

  const scriptSrc = isDev
    ? "'self' 'unsafe-eval' 'unsafe-inline'"
    : "'self'";

  const connectSrc = isDev
    ? `'self' ${rendererOrigin} ${apiOrigin} ws://localhost:* http://localhost:*`
    : `'self' ${rendererOrigin} ${apiOrigin}`;

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    isDev
      ? "img-src 'self' data: blob: http://localhost:*"
      : `img-src 'self' data: blob: ${rendererOrigin} ${apiOrigin}`,
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}
