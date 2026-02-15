import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionItem } from './SessionItem';
import type { SessionSummary } from '@/services/types';

describe('SessionItem', () => {
  const mockOnSelect = vi.fn();
  const mockOnDelete = vi.fn();
  const mockOnFork = vi.fn();

  const baseSession: SessionSummary = {
    id: 'sess_1',
    title: 'Test Session',
    messageCount: 2,
    lastMessagePreview: 'Hi! How can I help?',
    createdAt: Date.now() - 3600000,
    updatedAt: Date.now(),
    metadata: {},
  };

  beforeEach(() => {
    mockOnSelect.mockClear();
    mockOnDelete.mockClear();
    mockOnFork.mockClear();
  });

  it('renders session title', () => {
    render(<SessionItem session={baseSession} />);
    expect(screen.getByText('Test Session')).toBeInTheDocument();
  });

  it('renders Untitled Session when no title', () => {
    render(
      <SessionItem session={{ ...baseSession, title: undefined }} />,
    );
    expect(screen.getByText('Untitled Session')).toBeInTheDocument();
  });

  it('shows message count', () => {
    render(<SessionItem session={baseSession} />);
    expect(screen.getByText('2 messages')).toBeInTheDocument();
  });

  it('shows preview of last message', () => {
    render(<SessionItem session={baseSession} />);
    expect(screen.getByText('Hi! How can I help?')).toBeInTheDocument();
  });

  it('shows No messages when empty', () => {
    render(
      <SessionItem session={{ ...baseSession, messageCount: 0, lastMessagePreview: undefined }} />,
    );
    expect(screen.getByText('No messages')).toBeInTheDocument();
  });

  it('calls onSelect when clicked', () => {
    render(
      <SessionItem session={baseSession} onSelect={mockOnSelect} />,
    );

    const item = screen.getByText('Test Session').closest('div[class*="cursor-pointer"]')!;
    fireEvent.click(item);

    expect(mockOnSelect).toHaveBeenCalledWith('sess_1');
  });

  it('shows Fork and Delete buttons', () => {
    render(
      <SessionItem
        session={baseSession}
        onFork={mockOnFork}
        onDelete={mockOnDelete}
      />,
    );

    expect(screen.getByTitle('Fork session')).toBeInTheDocument();
    expect(screen.getByTitle('Delete session')).toBeInTheDocument();
  });

  it('calls onFork when Fork clicked', () => {
    render(
      <SessionItem session={baseSession} onFork={mockOnFork} />,
    );

    fireEvent.click(screen.getByTitle('Fork session'));
    expect(mockOnFork).toHaveBeenCalledWith('sess_1');
  });

  it('calls onDelete when Delete clicked', () => {
    render(
      <SessionItem session={baseSession} onDelete={mockOnDelete} />,
    );

    fireEvent.click(screen.getByTitle('Delete session'));
    expect(mockOnDelete).toHaveBeenCalledWith('sess_1');
  });

  it('applies active styling when isActive', () => {
    render(<SessionItem session={baseSession} isActive={true} />);
    const container = screen.getByText('Test Session').closest('div[class*="cursor-pointer"]')!;
    expect(container.className).toContain('bg-primary/5');
  });
});
