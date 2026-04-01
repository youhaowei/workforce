import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TaskPanel } from "./TaskPanel";

// Mock tRPC + React Query hooks
const mockQueryData = {
  data: [] as Array<{
    id: string;
    title: string;
    status: string;
    createdAt: number;
    updatedAt: number;
  }>,
  isLoading: false,
};

const mockMutate = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(() => mockQueryData),
  useMutation: vi.fn(() => ({ mutate: mockMutate, isLoading: false })),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}));

vi.mock("@/bridge/react", () => ({
  useTRPC: vi.fn(() => ({
    task: {
      list: { queryOptions: vi.fn(() => ({})), queryKey: vi.fn(() => ["task", "list"]) },
      create: { mutationOptions: vi.fn(() => ({})) },
      updateStatus: { mutationOptions: vi.fn(() => ({})) },
      delete: { mutationOptions: vi.fn(() => ({})) },
    },
  })),
}));

describe("TaskPanel", () => {
  beforeEach(() => {
    mockQueryData.data = [];
    mockQueryData.isLoading = false;
    mockMutate.mockClear();
  });

  it("renders hidden when closed", () => {
    const { container } = render(<TaskPanel isOpen={false} />);
    const panel = container.firstChild as HTMLElement;
    expect(panel.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders panel with title when open", () => {
    render(<TaskPanel isOpen={true} />);
    expect(screen.getByText("Tasks")).toBeInTheDocument();
  });

  it("shows add task form", () => {
    render(<TaskPanel isOpen={true} />);
    expect(screen.getByPlaceholderText("Add a task...")).toBeInTheDocument();
  });

  it("shows empty state when no tasks", () => {
    render(<TaskPanel isOpen={true} />);
    expect(screen.getByText("No active tasks")).toBeInTheDocument();
  });

  it("shows task count badge when tasks exist", () => {
    mockQueryData.data = [
      {
        id: "task_1",
        title: "Test",
        status: "pending",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];
    render(<TaskPanel isOpen={true} />);
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("calls onClose when close button clicked", () => {
    const onClose = vi.fn();
    render(<TaskPanel isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByTitle("Close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("disables add button when input is empty", () => {
    render(<TaskPanel isOpen={true} />);
    const addButton = screen.getByRole("button", { name: /add/i });
    expect(addButton).toBeDisabled();
  });

  it("enables add button when input has text", () => {
    render(<TaskPanel isOpen={true} />);
    const input = screen.getByPlaceholderText("Add a task...");
    fireEvent.change(input, { target: { value: "New task" } });
    const addButton = screen.getByRole("button", { name: /add/i });
    expect(addButton).not.toBeDisabled();
  });
});
