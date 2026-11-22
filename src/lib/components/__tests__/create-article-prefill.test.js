/** @vitest-environment jsdom */
// The article editor's sessionStorage prefill: `?prefill=termi` takes Termi's
// document handoff (title + markdown with the sources section), once.
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ p) => p }));
vi.mock('$lib/stores/accounts.svelte', () => ({ useActiveUser: () => () => null }));
vi.mock('$lib/stores/user-profile.svelte.js', () => ({ useUserProfile: () => () => null }));
vi.mock('$lib/stores/image-license.svelte.js', () => ({ useLicenseForHash: () => () => null }));
vi.mock('$lib/stores/article-actions.svelte.js', () => ({
  createArticle: vi.fn(),
  updateArticle: vi.fn(),
  ARTICLE_DRAFT_KIND: 30024
}));

import { stashArticlePrefill } from '$lib/components/assistant/document-export.js';
import ArticlePage from '../../../routes/create/article/+page.svelte';

describe('/create/article ?prefill=termi', () => {
  it('fills title and content from the Termi handoff, once', async () => {
    stashArticlePrefill({
      title: 'Studierende aktivieren',
      content: '# Studierende aktivieren\n\nText.'
    });
    const view = render(ArticlePage, {
      props: { data: { communityPubkey: '', editNaddr: '', prefill: 'termi' } }
    });
    const title = /** @type {HTMLInputElement} */ (view.container.querySelector('input.input'));
    expect(title.value).toBe('Studierende aktivieren');
    expect(view.container.innerHTML).toContain('Text.');
    expect(sessionStorage.getItem('termi.article-prefill')).toBeNull();
  });

  it('a handoff made while the editor is open arrives with the new data', async () => {
    const view = render(ArticlePage, {
      props: { data: { communityPubkey: '', editNaddr: '', prefill: '' } }
    });
    stashArticlePrefill({ title: 'Später', content: 'Inhalt' });
    await view.rerender({ data: { communityPubkey: '', editNaddr: '', prefill: 'termi' } });
    const title = /** @type {HTMLInputElement} */ (view.container.querySelector('input.input'));
    expect(title.value).toBe('Später');
  });
});
