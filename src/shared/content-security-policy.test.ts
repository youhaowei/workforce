import { describe, expect, it } from 'vitest';
import { buildRendererContentSecurityPolicy } from './content-security-policy';

/** Parse a CSP string into a map of directive → values. */
function parseCsp(csp: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const directive of csp.split(';')) {
    const parts = directive.trim().split(/\s+/);
    if (parts.length > 0) result[parts[0]] = parts.slice(1);
  }
  return result;
}

describe('buildRendererContentSecurityPolicy', () => {
  it('allows the Vite dev preamble in Electron dev mode', () => {
    const csp = buildRendererContentSecurityPolicy({
      isDev: true,
      rendererPort: 19676,
      serverPort: 19675,
    });
    const parsed = parseCsp(csp);

    expect(parsed['script-src']).toContain("'unsafe-eval'");
    expect(parsed['script-src']).toContain("'unsafe-inline'");
    expect(parsed['connect-src']).toContain('ws://localhost:*');
    expect(parsed['connect-src']).toContain('http://localhost:*');
    expect(parsed['connect-src']).toContain('http://localhost:19676');
    expect(parsed['connect-src']).toContain('http://localhost:19675');
    expect(parsed['img-src']).toContain('http://localhost:*');
  });

  it('keeps the production renderer policy strict', () => {
    const csp = buildRendererContentSecurityPolicy({
      isDev: false,
      rendererPort: 19676,
      serverPort: 19675,
    });
    const parsed = parseCsp(csp);

    expect(parsed['script-src']).toEqual(["'self'"]);
    expect(parsed['style-src']).toContain("'unsafe-inline'");
    expect(parsed['connect-src']).toContain('http://localhost:19676');
    expect(parsed['connect-src']).toContain('http://localhost:19675');
    expect(parsed['connect-src']).not.toContain('ws://localhost:*');
    expect(parsed['form-action']).toEqual(["'self'"]);
    // Production img-src scoped to known origins, not wildcard
    expect(parsed['img-src']).not.toContain('http://localhost:*');
    expect(parsed['img-src']).toContain('http://localhost:19676');
  });

  it('falls back to renderer origin when serverPort is null', () => {
    const csp = buildRendererContentSecurityPolicy({
      isDev: false,
      rendererPort: 19676,
      serverPort: null,
    });
    const parsed = parseCsp(csp);

    // apiOrigin falls back to rendererOrigin — both are the same
    expect(parsed['connect-src']).toContain('http://localhost:19676');
    expect(parsed['connect-src']).not.toContain('undefined');
  });

  it('deduplicates when serverPort equals rendererPort', () => {
    const csp = buildRendererContentSecurityPolicy({
      isDev: false,
      rendererPort: 19675,
      serverPort: 19675,
    });
    const parsed = parseCsp(csp);

    // Origins should be deduplicated — only one instance of the shared origin
    const origins = parsed['connect-src'].filter((v) => v === 'http://localhost:19675');
    expect(origins).toHaveLength(1);
  });

  it('includes all security-hardening directives', () => {
    const csp = buildRendererContentSecurityPolicy({
      isDev: false,
      rendererPort: 19676,
      serverPort: 19675,
    });
    const parsed = parseCsp(csp);

    expect(parsed['object-src']).toEqual(["'none'"]);
    expect(parsed['base-uri']).toEqual(["'self'"]);
    expect(parsed['frame-ancestors']).toEqual(["'none'"]);
    expect(parsed['default-src']).toEqual(["'self'"]);
    expect(parsed['font-src']).toContain("'self'");
    expect(parsed['font-src']).toContain('data:');
  });
});
