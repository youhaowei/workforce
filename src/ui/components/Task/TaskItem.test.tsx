import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TaskItem } from "./TaskItem";
import type { Task } from "../../../services/types";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task_test",
    title: "Test task",
    status: "pending",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("TaskItem", () => {
  it("renders task title", () => {
    render(<TaskItem task={makeTask()} />);
    expect(screen.getByText("Test task")).toBeInTheDocument();
  });

  it("renders task description when present", () => {
    render(<TaskItem task={makeTask({ description: "A description" })} />);
    expect(screen.getByText("A description")).toBeInTheDocument();
  });

  it("shows time ago", () => {
    render(<TaskItem task={makeTask()} />);
    expect(screen.getByText("just now")).toBeInTheDocument();
  });

  it("applies line-through for completed tasks", () => {
    render(<TaskItem task={makeTask({ status: "completed" })} />);
    const title = screen.getByText("Test task");
    expect(title.className).toContain("line-through");
  });

  it("shows start button for pending tasks", () => {
    render(<TaskItem task={makeTask({ status: "pending" })} />);
    expect(screen.getByTitle("Start")).toBeInTheDocument();
  });

  it("shows complete button for pending tasks", () => {
    render(<TaskItem task={makeTask({ status: "pending" })} />);
    expect(screen.getByTitle("Complete")).toBeInTheDocument();
  });

  it("shows cancel button for pending tasks", () => {
    render(<TaskItem task={makeTask({ status: "pending" })} />);
    expect(screen.getByTitle("Cancel")).toBeInTheDocument();
  });

  it("hides start button for completed tasks", () => {
    render(<TaskItem task={makeTask({ status: "completed" })} />);
    expect(screen.queryByTitle("Start")).not.toBeInTheDocument();
  });

  it("calls onStatusChange with in_progress when start clicked", () => {
    const handler = vi.fn();
    render(<TaskItem task={makeTask()} onStatusChange={handler} />);
    fireEvent.click(screen.getByTitle("Start"));
    expect(handler).toHaveBeenCalledWith("task_test", "in_progress");
  });

  it("calls onDelete when delete clicked", () => {
    const handler = vi.fn();
    render(<TaskItem task={makeTask()} onDelete={handler} />);
    fireEvent.click(screen.getByTitle("Delete"));
    expect(handler).toHaveBeenCalledWith("task_test");
  });

  it("shows reduced opacity for done tasks", () => {
    const { container } = render(<TaskItem task={makeTask({ status: "completed" })} />);
    expect(container.firstChild).toHaveClass("opacity-60");
  });
});
