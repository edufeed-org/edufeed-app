/**
 * ArticleView — "In LiaScript öffnen": the article (or draft) opens as a
 * LiaScript course; the player loads `?nostr:<naddr>` from the naddr's hints.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import { nip19 } from 'nostr-tools';
import { addSeenRelay } from 'applesauce-core/helpers';

const OWNER = '1c5ff3caacd842c01dca8f378231b16617516d214da75c7aeabbe9e1efe9c0f6';

vi.mock('$app/stores', () => ({
  page: readable({ url: new URL('https://edufeed.example/naddr1x') })
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ useActiveUser: () => () => null }));
vi.mock('$lib/helpers/eventDeletion.js', () => ({ deleteEvent: vi.fn() }));
vi.mock('$lib/helpers/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('$lib/loaders/event-highlights.js', () => ({
  loadEventHighlights: () => ({ loader: () => {}, cleanup: () => {} })
}));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({ useProfileMap: () => () => new Map() }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: {},
  eventStore: { model: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }) }
}));
vi.mock('$lib/stores/image-license.svelte.js', () => ({
  useLicenseStatus: () => () => ({ event: null, status: 'none' })
}));
vi.mock('$lib/stores/user-profile.svelte.js', () => ({ useUserProfile: () => () => null }));
vi.mock('$lib/stores/article-actions.svelte.js', () => ({
  publishDraft: vi.fn(),
  ARTICLE_DRAFT_KIND: 30024
}));
vi.mock('$lib/helpers/relay-helper.js', async (orig) => ({
  .../** @type {object} */ (await orig()),
  getArticleRelays: () => ['wss://relay.edufeed.org/', 'wss://other.example/']
}));
vi.mock('../shared/DetailHeader.svelte', async () => ({
  default: (await import('./fixtures/GenericDetailHeaderStub.svelte')).default
}));
for (const path of [
  '../shared/HighlightOverlay.svelte',
  '../reactions/ReactionBar.svelte',
  '../comments/CommentList.svelte',
  '../article/ArticleProvenance.svelte',
  '../article/ArticleDraftBanner.svelte'
]) {
  vi.doMock(path, async () => ({
    default: (await import('./fixtures/StubComponent.svelte')).default
  }));
}

import * as m from '$lib/paraglide/messages';
const { default: ArticleView } = await import('../article/ArticleView.svelte');

/** @param {number} kind */
const article = (kind) => ({
  kind,
  id: 'a'.repeat(64),
  pubkey: OWNER,
  created_at: 1_790_000_000,
  content: 'Text',
  tags: [
    ['d', 'kurs'],
    ['title', 'Kurs']
  ],
  sig: 'b'.repeat(128)
});

describe('ArticleView LiaScript link', () => {
  afterEach(() => cleanup());

  it.each([30023, 30024])('kind %i opens its naddr in the LiaScript player', (kind) => {
    render(ArticleView, { event: article(kind) });
    const link = /** @type {HTMLAnchorElement} */ (screen.getByTestId('article-liascript'));
    const href = link.getAttribute('href') ?? '';
    const prefix = 'https://liascript.github.io/course/?nostr:';
    expect(href.startsWith(prefix)).toBe(true);
    // no seen relay: the first longform relay is the hint
    expect(nip19.decode(href.slice(prefix.length)).data).toEqual({
      kind,
      pubkey: OWNER,
      identifier: 'kurs',
      relays: ['wss://relay.edufeed.org/']
    });
    expect(link.textContent?.trim()).toBe(m.termi_liascript_open());
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener');
    expect([...link.classList].sort()).toEqual(['btn', 'btn-ghost', 'btn-sm']);
  });

  it('a relay the article was seen on is the hint', () => {
    const event = article(30023);
    addSeenRelay(event, 'wss://seen.example/');
    render(ArticleView, { event });
    const href = screen.getByTestId('article-liascript').getAttribute('href') ?? '';
    const data = /** @type {any} */ (nip19.decode(href.split('?nostr:')[1]).data);
    expect(data.relays).toEqual(['wss://seen.example/']);
  });
});
