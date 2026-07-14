/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { nip19 } from 'nostr-tools';

vi.mock('$lib/stores/user-profile.svelte.js', () => ({
  useUserProfile: () => () => null
}));
function StubComponent() {}
vi.mock('$lib/components/shared/ProfileAvatar.svelte', () => ({ default: StubComponent }));

import HighlightCard from '$lib/components/bookmarks/HighlightCard.svelte';

const PUBKEY = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

/** @param {string[][]} tags */
const highlight = (tags) => ({
  id: 'h'.repeat(64),
  kind: 9802,
  pubkey: PUBKEY,
  content: 'the highlighted passage',
  tags,
  created_at: 1_700_000_000,
  sig: ''
});

describe('HighlightCard', () => {
  it('renders the highlighted text as a quote', () => {
    render(HighlightCard, { props: { event: highlight([]) } });
    expect(screen.getByText(/the highlighted passage/)).toBeTruthy();
  });

  it('links to the source URL from the r tag', () => {
    const { container } = render(HighlightCard, {
      props: { event: highlight([['r', 'https://example.org/article']]) }
    });
    const link = container.querySelector('a[href="https://example.org/article"]');
    expect(link).toBeTruthy();
    expect(link?.getAttribute('target')).toBe('_blank');
  });

  it('links to the nostr source for a-tag highlights', () => {
    const { container } = render(HighlightCard, {
      props: { event: highlight([['a', `30023:${PUBKEY}:my-article`]]) }
    });
    const naddr = nip19.naddrEncode({ kind: 30023, pubkey: PUBKEY, identifier: 'my-article' });
    expect(container.querySelector(`a[href*="${naddr.slice(0, 20)}"]`)).toBeTruthy();
  });
});
