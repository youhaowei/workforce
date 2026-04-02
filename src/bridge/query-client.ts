import { QueryClient } from "@tanstack/react-query";

/**
 * Shared QueryClient singleton.
 * Created once, imported by both tRPC and React Query providers.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchOnWindowFocus: false,
    },
  },
});
