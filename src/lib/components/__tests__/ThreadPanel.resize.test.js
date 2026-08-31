/** @vitest-environment jsdom */
// laoc, 2026-08-11: the thread sidebar needs a resize handle and an expand
// toggle — common chat UX (Slack/Discord both ship it).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import ThreadPanel from '$lib/components/chat/ThreadPanel.svelte';
import { createRawSnippet } from 'svelte';

const row = createRawSnippet(() => ({ render: () => '<div data-testid="row-stub"></div>' }));

const props = {
  root: { id: 'r'.repeat(64) },
  replies: [],
  onClose: vi.fn(),
  title: 'Thread',
  closeLabel: 'Close',
  expandLabel: 'Expand',
  collapseLabel: 'Collapse',
  row
};

beforeEach(() => localStorage.clear());

describe('ThreadPanel resize + expand', () => {
  it('carries a resize handle and honours a stored width', async () => {
    localStorage.setItem('chat:thread-panel-width', '512');
    const { container } = render(ThreadPanel, { props });
    expect(container.querySelector('[data-testid="thread-resize-handle"]')).toBeTruthy();
    const aside = container.querySelector('[data-testid="thread-panel"]');
    expect(aside?.getAttribute('style')).toContain('512px');
  });

  it('ignores a stored width outside the sane band', () => {
    localStorage.setItem('chat:thread-panel-width', '20');
    const { container } = render(ThreadPanel, { props });
    const aside = container.querySelector('[data-testid="thread-panel"]');
    expect(aside?.getAttribute('style')).not.toContain('20px');
  });

  it('expand toggles full width and flips its label', async () => {
    const { container, getByTestId } = render(ThreadPanel, { props });
    const aside = () => container.querySelector('[data-testid="thread-panel"]');
    expect(aside()?.className).toContain('md:w-[var(--thread-panel-w)]');
    await fireEvent.click(getByTestId('thread-panel-expand'));
    await waitFor(() => expect(aside()?.className).toContain('md:w-full'));
    expect(getByTestId('thread-panel-expand').getAttribute('title')).toBe('Collapse');
    await fireEvent.click(getByTestId('thread-panel-expand'));
    await waitFor(() => expect(aside()?.className).toContain('md:w-[var(--thread-panel-w)]'));
  });
});
