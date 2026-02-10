import { getDomainService } from '@services/domain';
import { publicProcedure, t } from '../core';

export const boardRouter = t.router({
  get: publicProcedure.query(async () => getDomainService().getBoard()),
});
