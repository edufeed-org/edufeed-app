/** @vitest-environment jsdom */
// Inside a group surface, media on the group's own host loads through the
// signed Blossom fetch instead of the anonymous proxy chain (which 401s on
// membership-gated hosts — measured on edufeed.communities.buzz.xyz).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';

const fetchAuthedMediaUrl = vi.hoisted(() =>
  vi.fn(async () => /** @type {string | null} */ ('blob:authed-img'))
);
vi.mock('$lib/groups/authed-media.js', async (importOriginal) => ({
  .../** @type {any} */ (await importOriginal()),
  fetchAuthedMediaUrl
}));

import AuthedImageHost from './fixtures/AuthedImageHost.svelte';

const RELAY = 'wss://edufeed.communities.buzz.xyz/';
const GATED = 'https://edufeed.communities.buzz.xyz/media/' + 'a'.repeat(64) + '.png';
const USER = { pubkey: 'f'.repeat(64), signer: {} };

beforeEach(() => {
  fetchAuthedMediaUrl.mockClear();
  fetchAuthedMediaUrl.mockResolvedValue('blob:authed-img');
});

describe('ImageWithFallback inside a group-media-auth context', () => {
  it('loads same-host media through the authed fetch, never the proxy', async () => {
    const { container } = render(AuthedImageHost, {
      props: { relay: RELAY, user: USER, src: GATED }
    });
    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img?.getAttribute('src')).toBe('blob:authed-img');
    });
    expect(fetchAuthedMediaUrl).toHaveBeenCalledWith(GATED, USER);
  });

  it('leaves other hosts on the normal proxy chain', async () => {
    const { container } = render(AuthedImageHost, {
      props: { relay: RELAY, user: USER, src: 'https://image.nostr.build/x.png' }
    });
    await waitFor(() => expect(container.querySelector('img')).toBeTruthy());
    expect(fetchAuthedMediaUrl).not.toHaveBeenCalled();
    expect(container.querySelector('img')?.getAttribute('src')).toContain('image.nostr.build');
  });

  it('falls back to the placeholder when the authed fetch is refused', async () => {
    fetchAuthedMediaUrl.mockResolvedValue(null);
    const { container } = render(AuthedImageHost, {
      props: { relay: RELAY, user: USER, src: GATED }
    });
    await waitFor(() => {
      expect(container.querySelector('[data-testid="image-fallback-placeholder"]')).toBeTruthy();
    });
  });
});
