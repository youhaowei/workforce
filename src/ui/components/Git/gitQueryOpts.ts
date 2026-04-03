/** Shared query options for git.status polling across all git UI components. */
export const GIT_STATUS_QUERY_OPTS = { staleTime: 5_000, refetchInterval: 10_000 } as const;
