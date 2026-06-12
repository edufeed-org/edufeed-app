/**
 * NostrContentRenderer link rendering:
 * - URLs that carry a NIP-19 id (naddr/nevent/note/npub) render as a rich
 *   preview card (NostrIdentifier) instead of a giant raw anchor.
 * - Other long links collapse to a middle-truncated anchor, full href preserved.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';

// Swap the heavy NostrIdentifier for a stub that surfaces its props in the DOM.
vi.mock(
  '$lib/components/shared/NostrIdentifier.svelte',
  () => import('./fixtures/NostrIdentifierStub.svelte')
);

vi.mock('$lib/helpers/image-proxy.js', () => ({
  getProxiedImageUrl: (/** @type {string} */ url) => url
}));

import NostrContentRenderer from '../NostrContentRenderer.svelte';

/** @param {string} content @returns {any} */
const makeEvent = (content) => ({ id: 'e1', kind: 14, pubkey: 'p'.repeat(64), content, tags: [] });

const NADDR = 'naddr1' + 'q'.repeat(280);

describe('NostrContentRenderer link rendering', () => {
  it('renders a nostr-id app URL as a preview card', () => {
    const { getByTestId } = render(NostrContentRenderer, {
      event: makeEvent(`See https://edufeed.org/${NADDR} for details`)
    });
    const card = getByTestId('nostr-card');
    expect(card.getAttribute('data-identifier')).toBe(NADDR);
    expect(card.getAttribute('data-inline')).toBe('false');
  });

  it('renders a card for a nostr id embedded in a non-linkified localhost URL', () => {
    const { getByTestId, container } = render(NostrContentRenderer, {
      event: makeEvent(`Resource: Test Konfi — http://localhost:5173/${NADDR}\nField: Lizenz`)
    });
    expect(getByTestId('nostr-card').getAttribute('data-identifier')).toBe(NADDR);
    // Surrounding text is preserved; the raw URL prefix is gone.
    expect(container.textContent).toContain('Resource: Test Konfi —');
    expect(container.textContent).toContain('Field: Lizenz');
    expect(container.textContent).not.toContain('localhost:5173');
  });

  it('strips a nostr: prefix from the URL before passing the id to the card', () => {
    const { getByTestId } = render(NostrContentRenderer, {
      event: makeEvent(`https://edufeed.org/nostr:${NADDR}`)
    });
    expect(getByTestId('nostr-card').getAttribute('data-identifier')).toBe(NADDR);
  });

  it('truncates a long non-nostr link but keeps the full href', () => {
    const longUrl = 'https://www.bildungsserver.de/veranstaltung.html?id=' + '4'.repeat(120);
    const { container, queryByTestId } = render(NostrContentRenderer, {
      event: makeEvent(`Link: ${longUrl}`)
    });
    expect(queryByTestId('nostr-card')).toBeNull();
    const anchor = /** @type {HTMLAnchorElement} */ (container.querySelector('a.link-primary'));
    expect(anchor).not.toBeNull();
    expect(anchor.getAttribute('href')).toBe(longUrl);
    expect(anchor.textContent).toContain('…');
    expect(anchor.textContent.length).toBeLessThan(longUrl.length);
  });

  it('leaves a short non-nostr link untouched', () => {
    const url = 'https://edufeed.org/about';
    const { container } = render(NostrContentRenderer, { event: makeEvent(url) });
    const anchor = /** @type {HTMLAnchorElement} */ (container.querySelector('a.link-primary'));
    expect(anchor.textContent).toBe(url);
  });
});
