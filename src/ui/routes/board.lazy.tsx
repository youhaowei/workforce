import { createLazyFileRoute } from "@tanstack/react-router";
import { BoardView } from "../components/Board";
import { useShell } from "../context/ShellContext";

function BoardRoute() {
  const { onSelectAgent, boardKeyword, boardStatusFilter } = useShell();

  return (
    <BoardView
      onSelectAgent={onSelectAgent}
      keyword={boardKeyword}
      statusFilter={boardStatusFilter}
    />
  );
}

export const Route = createLazyFileRoute("/board")({
  component: BoardRoute,
});
