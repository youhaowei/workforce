import {createLazyFileRoute} from '@tanstack/react-router';
import {ProjectView} from '../components/Project';
import {useShell} from '../context/ShellContext';

function ProjectsRoute() {
  const { selectedProjectId, onSelectProject, onStartChat, onSelectSession } = useShell();

  return (
    <ProjectView
      selectedProjectId={selectedProjectId}
      onSelectProject={onSelectProject}
      onStartChat={onStartChat}
      onSelectSession={onSelectSession}
    />
  );
}

export const Route = createLazyFileRoute('/projects')({
  component: ProjectsRoute,
});
