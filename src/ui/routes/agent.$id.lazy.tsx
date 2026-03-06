import {createLazyFileRoute} from '@tanstack/react-router';
import {AgentDetailView} from '../components/AgentDetail';
import {useShell} from '../context/ShellContext';

function AgentDetailRoute() {
  const { id } = Route.useParams();
  const { onBackFromDetail, onSelectAgent } = useShell();

  return (
    <AgentDetailView
      sessionId={id}
      onBack={onBackFromDetail}
      onNavigateToChild={onSelectAgent}
    />
  );
}

export const Route = createLazyFileRoute('/agent/$id')({
  component: AgentDetailRoute,
});
