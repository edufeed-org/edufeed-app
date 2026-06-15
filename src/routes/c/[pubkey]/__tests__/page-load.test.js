/**
 * Community home page load() tests.
 *
 * The load function validates the ?view= query param against the set of
 * community content types and exposes it as contentView. An unrecognized
 * value must collapse to undefined so the page falls back to the home
 * dashboard rather than rendering nothing.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { load } from '../+page.js';

/** @param {string} [view] */
function loadWithView(view) {
  const url = new URL('https://example.com/c/npub1abc');
  if (view !== undefined) url.searchParams.set('view', view);
  return /** @type {Promise<any>} */ (load(/** @type {any} */ ({ url })));
}

describe('community +page.js load', () => {
  it('passes through recognized content views', async () => {
    for (const view of [
      'home',
      'chat',
      'calendar',
      'learning',
      'boards',
      'articles',
      'forum',
      'polls',
      'wikis',
      'social-bookmarks',
      'meet',
      'members',
      'settings'
    ]) {
      const data = await loadWithView(view);
      expect(data.contentView).toBe(view);
    }
  });

  it('resolves ?view=wikis to the wikis view', async () => {
    const data = await loadWithView('wikis');
    expect(data.contentView).toBe('wikis');
  });

  it('drops unrecognized views so the page falls back to home', async () => {
    const data = await loadWithView('list');
    expect(data.contentView).toBeUndefined();
  });

  it('returns undefined when no view param is present', async () => {
    const data = await loadWithView();
    expect(data.contentView).toBeUndefined();
  });
});
