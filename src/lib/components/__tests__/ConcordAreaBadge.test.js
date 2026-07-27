/**
 * ConcordAreaBadge component tests: renders the decrypted community icon
 * when useConcordAreaIcon resolves one, and falls back to the abbreviation
 * placeholder (with the corner lock always present) otherwise.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import ConcordAreaBadge from '../shared/ConcordAreaBadge.svelte';

const holders = vi.hoisted(() => ({ iconUrl: /** @type {string | null} */ (null) }));

vi.mock('$lib/concord/blob-media.svelte.js', () => ({
  useConcordAreaIcon: () => () => holders.iconUrl
}));

describe('ConcordAreaBadge', () => {
  it('renders the abbreviation placeholder (no img) when there is no decrypted icon', () => {
    holders.iconUrl = null;
    const { getByText, container } = render(ConcordAreaBadge, {
      props: { name: 'Soapbox Community', communityId: 'a'.repeat(64) }
    });
    expect(getByText('SC')).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
  });

  it('renders the decrypted icon as an img and drops the abbreviation', () => {
    holders.iconUrl = 'blob:decrypted-icon-url';
    const { container, queryByText } = render(ConcordAreaBadge, {
      props: { name: 'Soapbox Community', communityId: 'a'.repeat(64) }
    });
    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    expect(img?.getAttribute('src')).toBe('blob:decrypted-icon-url');
    expect(queryByText('SC')).toBeNull();
  });

  it('always renders the corner lock glyph, icon or not', () => {
    for (const iconUrl of [null, 'blob:decrypted-icon-url']) {
      holders.iconUrl = iconUrl;
      const { container } = render(ConcordAreaBadge, {
        props: { name: 'Soapbox Community', communityId: 'a'.repeat(64) }
      });
      // LockIcon renders an <svg>; the badge always has exactly one (the
      // corner lock), regardless of whether the icon/abbreviation branch rendered.
      expect(container.querySelectorAll('svg')).toHaveLength(1);
    }
  });
});
