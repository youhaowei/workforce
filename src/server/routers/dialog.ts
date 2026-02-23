import { z } from 'zod';
import { router, publicProcedure } from '../trpc';
import { homedir } from 'os';

export const dialogRouter = router({
  openDirectory: publicProcedure
    .input(z.object({ startingFolder: z.string().optional() }).optional())
    .mutation(async ({ input }) => {
      // Dynamic import — only available when electrobun/bun is present (desktop mode).
      // Use string variable to prevent TypeScript from resolving into Electrobun's
      // shipped .ts source files (which have their own internal type errors).
      try {
        const mod = 'electrobun/bun';
        const { Utils } = await import(/* @vite-ignore */ mod);
        const paths = await Utils.openFileDialog({
          startingFolder: input?.startingFolder ?? homedir(),
          allowedFileTypes: '*',
          canChooseFiles: false,
          canChooseDirectory: true,
          allowsMultipleSelection: false,
        });
        return { path: (paths[0] as string) || null, error: null };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isModuleError = msg.includes('Cannot find module') || msg.includes('No such module');
        if (!isModuleError) console.warn('[dialog.openDirectory]', msg);
        return { path: null as string | null, error: isModuleError ? 'Native dialogs not available (web mode)' : msg };
      }
    }),
});
