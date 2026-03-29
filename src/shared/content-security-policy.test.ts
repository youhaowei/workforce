import { describe, expect, it } from 'vitest';
import { buildRendererContentSecurityPolicy } from './content-security-policy';

describe('buildRendererContentSecurityPolicy', () => {
  it('allows the Vite dev preamble in Electron dev mode', () => {
    const csp = buildRendererContentSecurityPolicy({
      isDev: true,
      rendererPort: 19676,
      serverPort: 19675,
    });

    expect(csp).toContain("script-src 'self' 'unsafe-eval' 'unsafe-inline'");
    expect(csp).toContain("connect-src 'self' http://localhost:19676 http://localhost:19675 ws://localhost:* http://localhost:*");
  });

  it('keeps the production renderer policy strict', () => {
    const csp = buildRendererContentSecurityPolicy({
      isDev: false,
      rendererPort: 19676,
      serverPort: 19675,
    });

    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("connect-src 'self' http://localhost:19676 http://localhost:19675");
  });
});
