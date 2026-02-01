import { render, screen, waitFor } from '@solidjs/testing-library';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionsPanel } from './SessionsPanel';

const mockSessions = [
  {
    id: 'sess_1',
    messages: [],
    metadata: { createdAt: Date.now() - 3600000, updatedAt: Date.now() },
  },
  {
    id: 'sess_2',
    messages: [{ role: 'user', content: 'Hello' }],
    metadata: { createdAt: Date.now() - 7200000, updatedAt: Date.now() - 1800000 },
  },
];

const mockCurrentSession = { id: 'sess_1', messages: [], metadata: { createdAt: Date.now(), updatedAt: Date.now() } };

vi.mock('@services/session', () => ({
  getSessionService: vi.fn(() => ({
    list: vi.fn(() => Promise.resolve(mockSessions)),
    getCurrent: vi.fn(() => mockCurrentSession),
    setCurrent: vi.fn(),
    create: vi.fn(() => Promise.resolve({ id: 'sess_new', messages: [], metadata: { createdAt: Date.now(), updatedAt: Date.now() } })),
    resume: vi.fn(() => Promise.resolve()),
    delete: vi.fn(() => Promise.resolve()),
    fork: vi.fn(() => Promise.resolve({ id: 'sess_fork', messages: [], metadata: { createdAt: Date.now(), updatedAt: Date.now() } })),
  })),
}));

describe('SessionsPanel', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    mockOnClose.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when closed', () => {
    render(() => <SessionsPanel isOpen={false} onClose={mockOnClose} />);
    expect(screen.queryByText('Sessions')).not.toBeInTheDocument();
  });

  it('renders panel with title when open', () => {
    render(() => <SessionsPanel isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Sessions')).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    render(() => <SessionsPanel isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('loads and displays sessions', async () => {
    render(() => <SessionsPanel isOpen={true} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });
  });

  it('shows close button', () => {
    render(() => <SessionsPanel isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByTitle('Close')).toBeInTheDocument();
  });
});
