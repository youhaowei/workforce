import { z } from 'zod';
import { getDomainService } from '@services/domain';
import { publicProcedure, t } from '../core';

export const historyRouter = t.router({
  list: publicProcedure
    .input(z.object({ stream: z.string().optional() }).optional())
    .query(async ({ input }) => getDomainService().listHistory(input?.stream ?? 'history')),
});
