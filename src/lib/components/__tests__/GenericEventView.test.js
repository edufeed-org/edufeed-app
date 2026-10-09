/**
 * GenericEventView — fallback detail page for event kinds without a view.
 *
 * Issue "Improve rendering of unknown event kinds" (laoc, 2026-10-09): a
 * kind 30617 (NIP-34 repository) link used to land on a bare "Nicht
 * unterstützter Inhaltstyp" alert. Now every event gets its author strip,
 * a title, its content, reactions, comments and NIP-89 handler links.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import { flushSync } from 'svelte';

const OWNER = '1c5ff3caacd842c01dca8f378231b16617516d214da75c7aeabbe9e1efe9c0f6';

const doubles = vi.hoisted(() => ({
  /** @type {any} */ activeUser: null
}));

vi.mock('$lib/stores/accounts.svelte.js', () => ({
  useActiveUser: () => () => doubles.activeUser
}));
vi.mock('$lib/helpers/eventDeletion.js', () => ({ deleteEvent: vi.fn() }));
vi.mock('$lib/helpers/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../shared/DetailHeader.svelte', async () => ({
  default: (await import('./fixtures/GenericDetailHeaderStub.svelte')).default
}));
vi.mock('../shared/NostrContentRenderer.svelte', async () => ({
  default: (await import('./fixtures/NostrContentStub.svelte')).default
}));
vi.mock('../shared/AppHandlerList.svelte', async () => ({
  default: (await import('./fixtures/StubComponent.svelte')).default
}));
vi.mock('../reactions/ReactionBar.svelte', async () => ({
  default: (await import('./fixtures/StubComponent.svelte')).default
}));
vi.mock('../comments/CommentList.svelte', async () => ({
  default: (await import('./fixtures/CommentListStub.svelte')).default
}));

import * as m from '$lib/paraglide/messages';
import GenericEventView from '../shared/GenericEventView.svelte';

/** NIP-34 repository announcement, the kind from the issue screenshot. */
const REPO = {
  kind: 30617,
  id: 'a'.repeat(64),
  pubkey: OWNER,
  created_at: 1_790_000_000,
  content: '',
  tags: [
    ['d', 'edufeed-app'],
    ['name', 'edufeed-app'],
    ['description', 'Decentralized social education platform'],
    ['alt', 'git repository: edufeed-app'],
    ['clone', 'https://git.edufeed.org/edufeed/edufeed-app.git']
  ],
  sig: 'b'.repeat(128)
};

describe('GenericEventView', () => {
  beforeEach(() => {
    doubles.activeUser = null;
  });
  afterEach(() => cleanup());

  it('shows the author strip with a tag-derived title and the kind badge', () => {
    render(GenericEventView, { event: REPO });
    flushSync();

    const header = screen.getByTestId('detail-header-stub');
    expect(header.dataset.title).toBe('edufeed-app');
    expect(header.dataset.author).toBe(OWNER);
    expect(header.dataset.canDelete).toBe('false');
    expect(screen.getByTestId('generic-event-kind').textContent).toBe(
      m.generic_event_kind_label({ kind: 30617 })
    );
    expect(screen.getByText(m.generic_event_limited_notice({ kind: 30617 }))).toBeTruthy();
    expect(screen.getByText(m.generic_event_no_content())).toBeTruthy();
    // Reactions, handler links and comments are all mounted.
    expect(screen.getAllByTestId('stub-component')).toHaveLength(2);
    expect(screen.getByTestId('comment-list-stub')).toBeTruthy();
  });

  it('falls back to "Kind N" as the title and hides the badge when no tag names it', () => {
    render(GenericEventView, { event: { ...REPO, tags: [['d', 'x']] } });
    flushSync();
    expect(screen.getByTestId('detail-header-stub').dataset.title).toBe(
      m.generic_event_kind_label({ kind: 30617 })
    );
    expect(screen.queryByTestId('generic-event-kind')).toBeNull();
  });

  it('renders text content through the nostr content renderer', () => {
    render(GenericEventView, {
      event: { ...REPO, kind: 1337, content: 'console.log("hi") nostr:npub1abc' }
    });
    flushSync();
    expect(screen.getByTestId('ncr-content').textContent).toBe('console.log("hi") nostr:npub1abc');
    expect(screen.queryByTestId('generic-event-json')).toBeNull();
  });

  it('renders JSON content as a pretty-printed code block', () => {
    render(GenericEventView, {
      event: { ...REPO, kind: 10063, content: '{"servers":["https://blossom.example"]}' }
    });
    flushSync();
    expect(screen.getByTestId('generic-event-json').textContent).toBe(
      JSON.stringify({ servers: ['https://blossom.example'] }, null, 2)
    );
    expect(screen.queryByTestId('ncr-content')).toBeNull();
  });

  it('offers delete only to the author', () => {
    doubles.activeUser = { pubkey: OWNER };
    render(GenericEventView, { event: REPO });
    flushSync();
    expect(screen.getByTestId('detail-header-stub').dataset.canDelete).toBe('true');
  });
});
