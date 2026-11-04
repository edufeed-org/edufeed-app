/** @vitest-environment jsdom */
/**
 * ChatMessageRow — the shared presentational chat bubble. What must hold for
 * message deep links: every row carries its event id as a DOM anchor
 * (data-message-id), and callers can opt into a hover copy-link affordance.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
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

  it('renders the nameBadge snippet after the author name', () => {
    render(ChatMessageRow, {
      props: {
        ...baseProps,
        isOwnMessage: false,
        displayName: 'Lehrbot',
        nameBadge: createRawSnippet((/** @type {() => string} */ getPubkey) => ({
          render: () => `<span data-testid="badge">${getPubkey()}</span>`
        }))
      }
    });
    expect(screen.getByTestId('badge').textContent).toBe(baseProps.message.pubkey);
  });
});

describe('ChatMessageRow pin action', () => {
  it('renders a pin button when onPin is provided and forwards the message', async () => {
    const onPin = vi.fn();
    render(ChatMessageRow, { props: { ...baseProps, onPin, pinTitle: 'Anpinnen' } });
    const button = screen.getByTestId('chat-message-pin');
    expect(button.getAttribute('title')).toBe('Anpinnen');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    await fireEvent.click(button);
    expect(onPin).toHaveBeenCalledWith(message);
  });

  it('a pinned message keeps its pin button visible and pressed', () => {
    render(ChatMessageRow, {
      props: { ...baseProps, onPin: vi.fn(), pinTitle: 'Lösen', pinned: true }
    });
    const button = screen.getByTestId('chat-message-pin');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.className).not.toContain('opacity-0');
  });

  it('a pinned message without onPin (not a moderator) shows a passive marker', () => {
    render(ChatMessageRow, { props: { ...baseProps, pinned: true, pinTitle: 'Angepinnt' } });
    expect(screen.queryByTestId('chat-message-pin')).toBeNull();
    expect(screen.getByTestId('chat-message-pinned').getAttribute('title')).toBe('Angepinnt');
  });

  it('renders neither button nor marker by default', () => {
    render(ChatMessageRow, { props: baseProps });
    expect(screen.queryByTestId('chat-message-pin')).toBeNull();
    expect(screen.queryByTestId('chat-message-pinned')).toBeNull();
  });
});
