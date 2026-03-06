import { useRouter } from '@tanstack/react-router';

export type ViewType =
  | 'home'
  | 'board'
  | 'queue'
  | 'sessions'
  | 'projects'
  | 'templates'
  | 'workflows'
  | 'orgs'
  | 'audit'
  | 'detail';

/**
 * Get the current view type from the router path.
 * Maps router paths to the ViewType used throughout the app.
 */
export function useCurrentView(): ViewType {
  const router = useRouter();
  const pathname = router.state.location.pathname;

  if (pathname === '/') return 'home';
  if (pathname.startsWith('/sessions')) return 'sessions';
  if (pathname.startsWith('/projects')) return 'projects';
  if (pathname.startsWith('/board')) return 'board';
  if (pathname.startsWith('/workflows')) return 'workflows';
  if (pathname.startsWith('/templates')) return 'templates';
  if (pathname.startsWith('/audit')) return 'audit';
  if (pathname.startsWith('/orgs')) return 'orgs';
  if (pathname.startsWith('/queue')) return 'queue';
  if (pathname.startsWith('/agent/')) return 'detail';

  return 'home'; // fallback
}
