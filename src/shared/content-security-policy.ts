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

  // Deduplicate origins (rendererOrigin === apiOrigin in single-port production mode)
  const origins = [...new Set([rendererOrigin, apiOrigin])];

  const connectSrc = isDev
    ? `'self' ${origins.join(' ')} ws://localhost:* http://localhost:*`
    : `'self' ${origins.join(' ')}`;

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    isDev
      ? "img-src 'self' data: blob: http://localhost:*"
      : `img-src 'self' data: blob: ${origins.join(' ')}`,
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "form-action 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}
