/**
 * ChatMessageRow is the one surface that opts into restricted markdown.
 *
 * The prop lives on NostrContentRenderer, which seven other callers share, so
 * this file pins the wiring: the chat bubble asks for markdown, and it gets a
 * bubble (not a document) — no headings, no tables, no markdown images.
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

/** @param {string} content @returns {any} */
const message = (content) => ({
  id: 'm1',
  pubkey: 'p'.repeat(64),
  created_at: 1700000000,
  kind: 9,
  content,
  tags: []
});

/** @param {string} content */
const renderRow = (content) =>
  render(ChatMessageRow, {
    message: message(content),
    isOwnMessage: false,
    displayName: 'Someone',
    timestamp: '10:00',
    linkProfile: false
  });

describe('ChatMessageRow markdown wiring', () => {
  it('marks up bold in a message body', () => {
    const { container } = renderRow('very **bold** claim');

    expect(container.querySelector('strong')?.textContent).toBe('bold');
  });

  it('renders a fenced code block', () => {
    const { container } = renderRow('```\nconst a = 1;\n```');

    expect(container.querySelector('pre code')?.textContent).toBe('const a = 1;');
  });

  it('does not turn a heading into a heading', () => {
    const { container } = renderRow('# shouting');

    expect(container.querySelector('h1')).toBeNull();
    expect(container.textContent).toContain('# shouting');
  });

  it('does not render a markdown table', () => {
    const { container } = renderRow('| a | b |\n| - | - |\n| 1 | 2 |');

    expect(container.querySelector('table')).toBeNull();
  });

  it('keeps the reply preview as plain text, not markdown', () => {
    // The preview is a one-line quote of someone else's message; running
    // markdown over it would let a fence or a list break the row layout.
    const { container } = render(ChatMessageRow, {
      message: message('body'),
      isOwnMessage: false,
      displayName: 'Someone',
      timestamp: '10:00',
      linkProfile: false,
      replyPreview: { displayName: 'Other', content: '**not bold**' }
    });

    expect(container.textContent).toContain('**not bold**');
  });
});
