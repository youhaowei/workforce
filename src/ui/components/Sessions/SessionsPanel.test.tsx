import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionsPanel } from './SessionsPanel';

// Mock tRPC + React Query hooks used by SessionsPanel
const mockQueryData = {
  data: [],
  isLoading: false,
};

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(() => mockQueryData),
  useMutation: vi.fn(() => ({ mutate: vi.fn(), isLoading: false })),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}));

vi.mock('@bridge/react', () => ({
  useTRPC: vi.fn(() => ({
    session: {
      list: { queryOptions: vi.fn(() => ({})) },
      resume: { mutationOptions: vi.fn(() => ({})) },
      delete: { mutationOptions: vi.fn(() => ({})) },
      fork: { mutationOptions: vi.fn(() => ({})) },
      create: { mutationOptions: vi.fn(() => ({})) },
    },
  })),
}));

describe('SessionsPanel', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    mockOnClose.mockClear();
    mockQueryData.data = [];
    mockQueryData.isLoading = false;
  });

  it('renders nothing when closed', () => {
    render(<SessionsPanel isOpen={false} onClose={mockOnClose} />);
    expect(screen.queryByText('Sessions')).not.toBeInTheDocument();
  });

  it('renders panel with title when open', () => {
    render(<SessionsPanel isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Sessions')).toBeInTheDocument();
  });

  it('shows loading state when isLoading', () => {
    mockQueryData.isLoading = true;
    render(<SessionsPanel isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows session list when loaded', () => {
    render(<SessionsPanel isOpen={true} onClose={mockOnClose} />);
    // Should show "No sessions yet" since data is empty
    expect(screen.getByText('No sessions yet')).toBeInTheDocument();
  });
});
