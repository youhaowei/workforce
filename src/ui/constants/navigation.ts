import type { MainTab } from '@ui/stores/appStore';

export const APP_TABS: Array<{ id: MainTab; label: string }> = [
  { id: 'chat', label: 'Chat' },
  { id: 'templates', label: 'Templates' },
  { id: 'workflows', label: 'Workflows' },
  { id: 'board', label: 'Board' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'history', label: 'History' },
];
