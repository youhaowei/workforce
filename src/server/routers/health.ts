import { z } from 'zod';
import { router, publicProcedure } from '../trpc';
import { getLogPath } from '@shared/debug-log';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';

export const healthRouter = router({
  check: publicProcedure.query(() => ({ ok: true })),

  debugLog: publicProcedure
    .input(z.object({ lines: z.number().optional().default(200) }))
    .query(({ input }) => {
      const logPath = getLogPath();
      try {
        const content = readFileSync(logPath, 'utf-8');
        const all = content.split('\n');
        return { logPath, content: all.slice(-input.lines).join('\n') };
      } catch (err) {
        return { logPath, content: '', error: String(err) };
      }
    }),

  authCheck: publicProcedure.query(async () => {
    const home = process.env.HOME || homedir();
    const credPath = `${home}/.claude/.credentials.json`;

    const result: Record<string, unknown> = {
      hasCredentialsFile: existsSync(credPath),
      hasApiKey: !!process.env.ANTHROPIC_API_KEY,
      hasAuthToken: !!process.env.ANTHROPIC_AUTH_TOKEN,
      credentialsFileReadable: false,
      home,
      cwd: process.cwd(),
    };

    if (result.hasCredentialsFile) {
      try {
        const content = readFileSync(credPath, 'utf-8');
        const creds = JSON.parse(content);
        result.credentialsFileReadable = true;
        if (creds.claudeAiOauth) {
          result.hasRefreshToken = !!creds.claudeAiOauth.refreshToken;
          if (creds.claudeAiOauth.expiresAt) {
            result.tokenExpired = creds.claudeAiOauth.expiresAt < Date.now();
          }
        }
      } catch (err) {
        result.credentialsError = String(err);
      }
    }

    const authenticated = !!(result.hasCredentialsFile || result.hasApiKey || result.hasAuthToken);
    return { authenticated, ...result };
  }),
});
