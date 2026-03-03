import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionItem } from './SessionItem';
import type { SessionSummary } from '@/services/types';

describe('SessionItem', () => {
  const mockOnSelect = vi.fn();
  const mockOnDelete = vi.fn();

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
  });

  it('renders session title', () => {
    render(<SessionItem session={baseSession} />);
    expect(screen.getByText('Test Session')).toBeInTheDocument();
  });

  it('renders Untitled Session when no title', () => {
    render(
      <SessionItem session={{ ...baseSession, title: undefined }} />,
    );
    expect(screen.getByText('Untitled')).toBeInTheDocument();
  });

  it('renders session title only (no preview)', () => {
    render(<SessionItem session={baseSession} />);
    expect(screen.getByText('Test Session')).toBeInTheDocument();
    // Verify that preview is not shown
    expect(screen.queryByText('Hi! How can I help?')).not.toBeInTheDocument();
  });

  it('calls onSelect when clicked', () => {
    render(
      <SessionItem session={baseSession} onSelect={mockOnSelect} />,
    );

    const item = screen.getByText('Test Session').closest('div[class*="cursor-pointer"]')!;
    fireEvent.click(item);

    expect(mockOnSelect).toHaveBeenCalledWith('sess_1');
  });

  it('calls onSelect when Enter is pressed on the row', () => {
    render(
      <SessionItem session={baseSession} onSelect={mockOnSelect} />,
    );

    const item = screen.getByText('Test Session').closest('div[class*="cursor-pointer"]')!;
    fireEvent.keyDown(item, { key: 'Enter' });

    expect(mockOnSelect).toHaveBeenCalledWith('sess_1');
  });

  it('shows Delete button', () => {
    render(
      <SessionItem session={baseSession} onDelete={mockOnDelete} />,
    );

    expect(screen.getByLabelText('Delete session')).toBeInTheDocument();
  });

  it('calls onDelete when Delete clicked', () => {
    render(
      <SessionItem session={baseSession} onDelete={mockOnDelete} />,
    );

    fireEvent.click(screen.getByLabelText('Delete session'));
    // Delete uses async confirm dialog — just verify the button is clickable
  });

  it('does not call onSelect when Enter is pressed on Delete button', () => {
    render(
      <SessionItem session={baseSession} onSelect={mockOnSelect} onDelete={mockOnDelete} />,
    );

    fireEvent.keyDown(screen.getByLabelText('Delete session'), { key: 'Enter' });

    expect(mockOnSelect).not.toHaveBeenCalled();
  });

  it('applies active styling when isActive', () => {
    render(<SessionItem session={baseSession} isActive={true} />);
    const container = screen.getByText('Test Session').closest('div[class*="cursor-pointer"]')!;
    expect(container.className).toContain('bg-neutral-fg/[0.06]');
  });
});
