/**
 * The chat header's hover-reveal action buttons are hidden with opacity, so
 * they always reserve space. For own (right-aligned, chat-end) messages that
 * space must sit on the INNER side of the timestamp — otherwise the time
 * floats away from the bubble edge while idle (issue "order of message
 * metadata confusing"). Others' messages keep name · time · actions.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';

vi.mock(
  '$lib/components/shared/NostrIdentifier.svelte',
  () => import('../../shared/__tests__/fixtures/NostrIdentifierStub.svelte')
);

vi.mock('$lib/helpers/image-proxy.js', () => ({
  getProxiedImageUrl: (/** @type {string} */ url) => url
}));

import ChatMessageRow from '../ChatMessageRow.svelte';

/** @type {any} */
const message = {
  id: 'm1',
  pubkey: 'p'.repeat(64),
  created_at: 1700000000,
  kind: 9,
  content: 'hi',
  tags: []
};

/** @param {boolean} isOwnMessage */
const renderRow = (isOwnMessage) =>
  render(ChatMessageRow, {
    message,
    isOwnMessage,
    displayName: 'Someone',
    timestamp: '10:00',
    linkProfile: false,
    onReply: () => {},
    onDelete: () => {},
    onCopyLink: () => {}
  });

/** @param {Element} header @returns {string[]} */
const headerOrder = (header) =>
  Array.from(header.children).map((el) =>
    el.tagName === 'TIME' ? 'time' : el.tagName === 'BUTTON' ? 'button' : el.tagName.toLowerCase()
  );

describe('ChatMessageRow header order', () => {
  it('puts the actions before the time on own messages so the time hugs the bubble edge', () => {
    const { container } = renderRow(true);
    const header = container.querySelector('.chat-header');
    if (!header) throw new Error('no header');

    expect(headerOrder(header)).toEqual(['button', 'button', 'button', 'time']);
  });

  it('keeps name · time · actions on other people’s messages', () => {
    const { container } = renderRow(false);
    const header = container.querySelector('.chat-header');
    if (!header) throw new Error('no header');

    expect(headerOrder(header)).toEqual(['span', 'span', 'time', 'button', 'button', 'button']);
  });

  it('renders the three action buttons in the same order on both sides', () => {
    const titles = (/** @type {boolean} */ own) =>
      Array.from(renderRow(own).container.querySelectorAll('.chat-header button')).map((b) =>
        b.getAttribute('title')
      );

    expect(titles(true)).toEqual(['Reply', 'Delete', 'Copy link']);
    expect(titles(false)).toEqual(['Reply', 'Delete', 'Copy link']);
  });
});
