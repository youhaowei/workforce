import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionsPanel } from './SessionsPanel';
import { useOrgStore } from '@/ui/stores/useOrgStore';

// Mock tRPC + React Query hooks used by SessionsPanel
const mockQueryData = {
  data: [],
  isLoading: false,
};

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(() => mockQueryData),
  useMutation: vi.fn(() => ({ mutate: vi.fn(), isLoading: false })),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn(), setQueriesData: vi.fn() })),
}));

vi.mock('@/bridge/react', () => ({
  useTRPC: vi.fn(() => ({
    session: {
      list: { queryOptions: vi.fn(() => ({})), queryKey: vi.fn(() => ['session', 'list']) },
      resume: { mutationOptions: vi.fn(() => ({})) },
      delete: { mutationOptions: vi.fn(() => ({})) },
      discoverCC: { queryOptions: vi.fn(() => ({})) },
      importCC: { mutationOptions: vi.fn(() => ({})) },
    },
    project: {
      list: { queryOptions: vi.fn(() => ({})), queryKey: vi.fn(() => ['project', 'list']) },
    },
  })),
}));

describe('SessionsPanel', () => {
  const mockOnSelectSession = vi.fn();
  const TEST_ORG_ID = 'org_test_12345';

  beforeEach(() => {
    mockOnSelectSession.mockClear();
    mockQueryData.data = [];
    mockQueryData.isLoading = false;
    // Initialize OrgStore with a test org ID
    useOrgStore.setState({ currentOrgId: TEST_ORG_ID });
  });

  it('renders collapsed when collapsed prop is true', () => {
    render(<SessionsPanel collapsed={true} onSelectSession={mockOnSelectSession} />);
    // Content is not rendered when collapsed
    expect(screen.queryByText('Sessions')).not.toBeInTheDocument();
  });

  it('renders panel with title when expanded', () => {
    render(<SessionsPanel collapsed={false} onSelectSession={mockOnSelectSession} />);
    expect(screen.getByText('Sessions')).toBeInTheDocument();
  });

  it('shows loading state when isLoading', () => {
    mockQueryData.isLoading = true;
    render(<SessionsPanel collapsed={false} onSelectSession={mockOnSelectSession} />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows session list when loaded', () => {
    render(<SessionsPanel collapsed={false} onSelectSession={mockOnSelectSession} />);
    // Should show "No sessions yet" since data is empty
    expect(screen.getByText('No sessions yet')).toBeInTheDocument();
  });
});
