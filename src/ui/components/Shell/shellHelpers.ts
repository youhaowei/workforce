import type { Session, SessionSummary } from '@/services/types';
import type { ViewType } from './Shell';

const SERVER_URL = 'http://localhost:4096';

export const SIDEBAR_STORAGE_KEY = 'workforce-sidebar-mode';
export const SESSIONS_PANEL_STORAGE_KEY = 'workforce-sessions-collapsed';
export const VIEW_STORAGE_KEY = 'workforce-current-view';
export const SELECTED_SESSION_STORAGE_KEY = 'workforce-selected-session';
export const SESSION_TITLE_MAX_LENGTH = 80;

export const VALID_VIEWS = new Set<ViewType>([
  'home',
  'board',
  'queue',
  'sessions',
  'templates',
  'workflows',
  'orgs',
  'audit',
  'detail',
]);

export async function checkServerConnection(): Promise<boolean> {
  try {
    const response = await fetch(`${SERVER_URL}/health`, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}

export function toSessionSummary(session: Session): SessionSummary {
  const lastMessage = session.messages[session.messages.length - 1];
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    parentId: session.parentId,
    metadata: session.metadata,
    messageCount: session.messages.length,
    lastMessagePreview: lastMessage?.content,
  };
}
