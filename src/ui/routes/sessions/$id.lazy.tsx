import { createLazyFileRoute } from "@tanstack/react-router";
import { SessionsView } from "../../components/Sessions/SessionsView";
import { useShell } from "../../context/ShellContext";

function SessionDetailRoute() {
  const { id } = Route.useParams();
  const shell = useShell();

  return (
    <SessionsView
      sessionId={id}
      projects={shell.projects}
      newSessionProjectId={shell.newSessionProjectId}
      onNewSessionProjectChange={shell.onNewSessionProjectChange}
      onCreateProjectForSession={shell.onCreateProjectForSession}
      messages={shell.messages}
      isStreaming={shell.isStreaming}
      forksMap={shell.forksMap}
      error={shell.error}
      onDismissError={shell.onDismissError}
      onSubmit={shell.onSubmitMessage}
      onCancel={shell.onCancelStream}
      onRewind={shell.onRewind}
      onFork={shell.onFork}
      onSelectSession={shell.onSelectSession}
    />
  );
}

export const Route = createLazyFileRoute("/sessions/$id")({
  component: SessionDetailRoute,
});
