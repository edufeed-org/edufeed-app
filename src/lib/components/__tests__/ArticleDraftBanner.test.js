/**
 * ArticleDraftBanner — the "Entwurf" notice on a kind 30024 preview page.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

vi.mock('$lib/paraglide/messages.js', () => ({
  article_draft_banner_title: () => 'Entwurf',
  article_draft_banner_text: () => 'Dieser Beitrag ist nicht veröffentlicht.',
  article_draft_publish: () => 'Veröffentlichen',
  article_draft_publishing: () => 'Wird veröffentlicht…'
}));

const ArticleDraftBanner = (await import('../article/ArticleDraftBanner.svelte')).default;

describe('ArticleDraftBanner', () => {
  it('explains the draft state to every reader', () => {
    const { getByTestId, queryByRole } = render(ArticleDraftBanner, {
      props: { isAuthor: false, onPublish: vi.fn() }
    });
    expect(getByTestId('article-draft-banner').textContent).toContain('nicht veröffentlicht');
    expect(queryByRole('button')).toBeNull();
  });

  it('lets the author publish from the banner', async () => {
    const onPublish = vi.fn();
    const { getByRole } = render(ArticleDraftBanner, { props: { isAuthor: true, onPublish } });
    await fireEvent.click(getByRole('button', { name: 'Veröffentlichen' }));
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  it('disables the button while publishing', () => {
    const { getByRole } = render(ArticleDraftBanner, {
      props: { isAuthor: true, onPublish: vi.fn(), publishing: true }
    });
    expect(/** @type {HTMLButtonElement} */ (getByRole('button')).disabled).toBe(true);
  });
});
