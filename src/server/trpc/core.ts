import { initTRPC } from '@trpc/server';

export interface TrpcContext {
  requestId: string;
}

const hintByCode: Record<string, string> = {
  BAD_REQUEST: 'Check request payload shape and required fields.',
  NOT_FOUND: 'The requested entity does not exist in the current workspace.',
  INTERNAL_SERVER_ERROR: 'Try again and inspect server logs if this persists.',
};

export const t = initTRPC.context<TrpcContext>().create({
  errorFormatter({ shape }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        code: String(shape.code),
        message: shape.message,
        remediationHint: hintByCode[String(shape.code)] ?? 'Review logs for details.',
      },
    };
  },
});

export const publicProcedure = t.procedure;
