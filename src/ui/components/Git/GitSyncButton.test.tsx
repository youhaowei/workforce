import type { ReactElement } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GitSyncButton } from "./GitSyncButton";

function renderWithProviders(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

interface FakeStatus {
  branch: string;
  ahead: number;
  behind: number;
  hasUpstream: boolean;
}

const mockUseQuery = vi.fn();
const mockPullMutateAsync = vi.fn();
const mockPushMutateAsync = vi.fn();
const mockInvalidateQueries = vi.fn();
const mockRefetchQueries = vi.fn();
const mockGetQueryData = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useMutation: (opts: { mutationFn?: unknown } | undefined) => {
    // Return a stable object that routes pull vs push based on call order.
    // The component reads pullMutation.mutateAsync / pushMutation.mutateAsync —
    // we distinguish via the argument passed to `useMutation`.
    const label = (opts as { __kind?: string } | undefined)?.__kind ?? "";
    return {
      mutateAsync: label === "pull" ? mockPullMutateAsync : mockPushMutateAsync,
    };
  },
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
    refetchQueries: mockRefetchQueries,
    getQueryData: mockGetQueryData,
  }),
}));

vi.mock("@/bridge/react", () => ({
  useTRPC: () => ({
    git: {
      status: {
        queryKey: (input: unknown) => ["git", "status", input],
        queryOptions: (input: unknown, options: unknown) => ({ input, options }),
      },
      log: {
        queryKey: (input: unknown) => ["git", "log", input],
      },
      pull: {
        mutationOptions: () => ({ __kind: "pull" }),
      },
      push: {
        mutationOptions: () => ({ __kind: "push" }),
      },
    },
  }),
}));

function setStatus(status: FakeStatus | undefined) {
  mockUseQuery.mockReturnValue({ data: status });
  mockGetQueryData.mockReturnValue(status);
}

describe("GitSyncButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPullMutateAsync.mockResolvedValue({ success: true });
    mockPushMutateAsync.mockResolvedValue({ success: true });
    mockRefetchQueries.mockResolvedValue(undefined);
  });

  it("hides when clean and in-sync with upstream", () => {
    setStatus({ branch: "main", ahead: 0, behind: 0, hasUpstream: true });
    const { container } = renderWithProviders(<GitSyncButton cwd="/repo" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("always shows Publish label when upstream is missing", () => {
    setStatus({ branch: "feature", ahead: 3, behind: 0, hasUpstream: false });
    renderWithProviders(<GitSyncButton cwd="/repo" />);
    expect(screen.getByText("Publish")).toBeInTheDocument();
  });

  it("re-reads status after pull and skips push when refreshed state is in-sync", async () => {
    // Initial: behind=1, ahead=1 — user clicks expecting pull then push.
    const initial: FakeStatus = { branch: "main", ahead: 1, behind: 1, hasUpstream: true };
    setStatus(initial);

    renderWithProviders(<GitSyncButton cwd="/repo" />);

    // Simulate pull reconciling everything — refreshed status shows nothing ahead.
    mockGetQueryData.mockReturnValue({
      branch: "main",
      ahead: 0,
      behind: 0,
      hasUpstream: true,
    } satisfies FakeStatus);

    const button = screen.getByRole("button");
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => expect(mockPullMutateAsync).toHaveBeenCalledTimes(1));
    expect(mockRefetchQueries).toHaveBeenCalledTimes(1);
    // Push must NOT fire because refreshed status has nothing to push.
    expect(mockPushMutateAsync).not.toHaveBeenCalled();
  });

  it("pushes after pull when refreshed state still has commits to publish", async () => {
    setStatus({ branch: "main", ahead: 2, behind: 3, hasUpstream: true });

    renderWithProviders(<GitSyncButton cwd="/repo" />);

    // After pull (e.g. merge commit), still 2 ahead.
    mockGetQueryData.mockReturnValue({
      branch: "main",
      ahead: 2,
      behind: 0,
      hasUpstream: true,
    } satisfies FakeStatus);

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });

    await waitFor(() => expect(mockPushMutateAsync).toHaveBeenCalledTimes(1));
    expect(mockPullMutateAsync).toHaveBeenCalledTimes(1);
    expect(mockRefetchQueries).toHaveBeenCalledTimes(1);
  });

  it("shows Synced badge after success even when refreshed status would hide the button", async () => {
    setStatus({ branch: "main", ahead: 1, behind: 0, hasUpstream: true });

    renderWithProviders(<GitSyncButton cwd="/repo" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });

    await waitFor(() => expect(mockPushMutateAsync).toHaveBeenCalledTimes(1));

    // Simulate the post-sync invalidate refetching to a clean status — without the
    // result-before-shouldHide fix, this would unmount the badge instantly.
    setStatus({ branch: "main", ahead: 0, behind: 0, hasUpstream: true });

    expect(await screen.findByText("Synced")).toBeInTheDocument();
  });

  it("rejects rapid second click while a sync is in flight", async () => {
    setStatus({ branch: "main", ahead: 1, behind: 0, hasUpstream: true });

    let resolvePush: ((v: { success: true }) => void) | undefined;
    mockPushMutateAsync.mockImplementationOnce(
      () => new Promise((r) => (resolvePush = r as typeof resolvePush)),
    );

    renderWithProviders(<GitSyncButton cwd="/repo" />);

    const button = screen.getByRole("button");
    // First click acquires the synchronous lock and kicks off push.
    await act(async () => {
      fireEvent.click(button);
    });
    // Second click within the same render frame must be a no-op.
    await act(async () => {
      fireEvent.click(button);
    });

    expect(mockPushMutateAsync).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvePush?.({ success: true });
    });
  });

  it("skips pull when not behind and pushes directly", async () => {
    setStatus({ branch: "main", ahead: 2, behind: 0, hasUpstream: true });

    renderWithProviders(<GitSyncButton cwd="/repo" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });

    await waitFor(() => expect(mockPushMutateAsync).toHaveBeenCalledTimes(1));
    expect(mockPullMutateAsync).not.toHaveBeenCalled();
    // No pull means no forced refetch between mutations.
    expect(mockRefetchQueries).not.toHaveBeenCalled();
  });
});
