/** @vitest-environment jsdom */
// The landing route redirects logged-in visitors to /c/. Its content (and
// with it every showcase/community loader) must not mount for them at all —
// otherwise each logged-in visit to / fires a burst of relay requests on the
// way out.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';

const state = vi.hoisted(() => ({ user: /** @type {any} */ (null), goto: vi.fn() }));
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$app/navigation', () => ({ goto: (/** @type {any[]} */ ...a) => state.goto(...a) }));
vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ p) => p }));
vi.mock('$lib/stores/accounts.svelte', () => ({ useActiveUser: () => () => state.user }));
vi.mock('$lib/stores/config.svelte.js', () => ({ runtimeConfig: { appName: 'Edufeed' } }));
vi.mock('$lib/paraglide/messages', () => ({
  landing_meta_title: () => 'title',
  landing_meta_description: () => 'description'
}));
vi.mock('$lib/components/landing/LandingContent.svelte', async () => ({
  default: (await import('./__mocks__/LandingContentStub.svelte')).default
}));

const { default: Page } = await import('../../../routes/+page.svelte');

describe('landing route', () => {
  beforeEach(() => {
    state.user = null;
    state.goto.mockReset();
  });

  it('logged out: mounts the landing content', () => {
    const { queryByTestId } = render(Page);
    expect(queryByTestId('landing-content-stub')).not.toBeNull();
  });

  it('logged in: redirects and never mounts the content (no loaders on the way out)', () => {
    state.user = { pubkey: 'a'.repeat(64) };
    const { queryByTestId } = render(Page);
    expect(queryByTestId('landing-content-stub')).toBeNull();
    expect(state.goto).toHaveBeenCalledWith('/c/', { replaceState: true });
  });
});
