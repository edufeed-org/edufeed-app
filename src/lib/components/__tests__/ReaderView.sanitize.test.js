/**
 * ReaderView renders a fetched third-party page through the shared sanitizer:
 * no scripts or handlers, no app CSS classes (`fixed inset-0 z-50` overlays),
 * forced rel on target links — and the article text still shows.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';

vi.mock('$lib/components/shared/HighlightOverlay.svelte', async () => ({
  default: (await import('./__mocks__/HtmlContentStub.svelte')).default
}));
vi.mock('$lib/components/comments/CommentList.svelte', async () => ({
  default: (await import('./__mocks__/EmptyStub.svelte')).default
}));
vi.mock('$lib/components/reactions/UrlReactionBar.svelte', async () => ({
  default: (await import('./__mocks__/EmptyStub.svelte')).default
}));
vi.mock('$lib/components/bookmarks/BookmarkChip.svelte', async () => ({
  default: (await import('./__mocks__/EmptyStub.svelte')).default
}));
vi.mock('$lib/components/bookmarks/BookmarkItem.svelte', async () => ({
  default: (await import('./__mocks__/EmptyStub.svelte')).default
}));

const { default: ReaderView } = await import('$lib/components/bookmarks/ReaderView.svelte');

afterEach(() => vi.unstubAllGlobals());

describe('ReaderView', () => {
  it('sanitizes the fetched article with the shared sanitizer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        json: async () => ({
          success: true,
          article: {
            title: 'T',
            content:
              '<h2>Part</h2><p class="fixed inset-0 z-50" onclick="alert(1)">Body text</p>' +
              '<a href="https://x.example" target="_blank">l</a><script>alert(1)</script>'
          }
        })
      }))
    );
    render(ReaderView, {
      props: {
        articleUrl: 'https://x.example/a',
        highlights: [],
        bookmarks: [],
        profiles: new Map(),
        onerror: () => {}
      }
    });

    const body = await waitFor(() => screen.getByTestId('html-content'));
    await waitFor(() => expect(body.textContent).toContain('Body text'));
    expect(body.innerHTML).not.toMatch(/fixed|onclick|<script/);
    expect(body.querySelector('a')?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(body.querySelector('h2')?.id).toBe('part');
  });
});
