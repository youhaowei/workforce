import { createLazyFileRoute } from "@tanstack/react-router";
import { HomeView } from "../components/Home";
import { useShell } from "../context/ShellContext";

function HomeRoute() {
  const { onStartChat, onSelectSession } = useShell();
  const onNavigate = () => {}; // Handled by router Links in the component

  return (
    <HomeView onStartChat={onStartChat} onNavigate={onNavigate} onSelectSession={onSelectSession} />
  );
}

export const Route = createLazyFileRoute("/")({
  component: HomeRoute,
});
