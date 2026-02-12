/**
 * Maps lifecycle state to shadcn Badge variant.
 * Shared utility to avoid duplication across Board, Sessions, and AgentDetail components.
 */
export function stateVariant(state: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (state) {
    case 'active': return 'default';
    case 'paused': return 'secondary';
    case 'failed': return 'destructive';
    case 'completed': return 'outline';
    case 'cancelled': return 'outline';
    default: return 'outline';
  }
}
