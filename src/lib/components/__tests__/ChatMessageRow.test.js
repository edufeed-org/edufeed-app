/** @vitest-environment jsdom */
/**
 * ChatMessageRow — the shared presentational chat bubble. What must hold for
 * message deep links: every row carries its event id as a DOM anchor
 * (data-message-id), and callers can opt into a hover copy-link affordance.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ChatMessageRow from '$lib/components/chat/ChatMessageRow.svelte';

const message = {
  id: 'e'.repeat(64),
  pubkey: 'a'.repeat(64),
  content: 'hallo',
  created_at: 1700000000,
  tags: []
};

const baseProps = {
  message,
  isOwnMessage: false,
  displayName: 'Alice',
  timestamp: '12:34'
};

describe('ChatMessageRow message anchor', () => {
  it('exposes the message id as a data-message-id DOM anchor', () => {
    const { container } = render(ChatMessageRow, { props: baseProps });
    expect(container.querySelector(`[data-message-id="${message.id}"]`)).not.toBeNull();
  });

  it('renders a copy-link button when onCopyLink is provided and forwards the message', async () => {
    const onCopyLink = vi.fn();
    render(ChatMessageRow, {
      props: { ...baseProps, onCopyLink, copyLinkTitle: 'Link kopieren' }
    });
    const button = screen.getByTitle('Link kopieren');
    await fireEvent.click(button);
    expect(onCopyLink).toHaveBeenCalledWith(message);
  });

  it('renders no copy-link button without onCopyLink', () => {
    render(ChatMessageRow, { props: baseProps });
    expect(screen.queryByTitle('Link kopieren')).toBeNull();
  });
});
