// @ts-nocheck
/** @vitest-environment jsdom */
// RemovedContentPane: lists the removals that count, names who removed what,
// and offers Restore only where this browser holds the label author's key.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { BehaviorSubject } from 'rxjs';

const COMMUNITY = 'a'.repeat(64);
const ADMIN = 'b'.repeat(64);
const AUTHOR = 'e'.repeat(64);

const article = {
  kind: 30023,
  id: '1'.repeat(64),
  pubkey: AUTHOR,
  created_at: 500,
  content: '',
  tags: [
    ['d', 'my-article'],
    ['title', 'Photosynthesis explained']
  ]
};

const store = vi.hoisted(() => ({
  getReplaceable: vi.fn(),
  getEvent: vi.fn(),
  replaceable: vi.fn(() => new BehaviorSubject(undefined)),
  event: vi.fn(() => new BehaviorSubject(undefined))
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({ eventStore: store, pool: {} }));
const addressLoader = vi.hoisted(() => vi.fn(() => ({ subscribe: () => ({ unsubscribe() {} }) })));
vi.mock('$lib/loaders/base.js', () => ({ addressLoader }));
const fetchEventsByIds = vi.hoisted(() => vi.fn(() => null));
vi.mock('$lib/helpers/repost-resolution.js', () => ({ fetchEventsByIds }));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => ['wss://lookup.example/']
}));
const restorable = vi.hoisted(() => ({ pubkeys: /** @type {string[]} */ ([]) }));
vi.mock('$lib/helpers/publishContentRemoval.js', () => ({
  canRestoreRemoval: (label) => restorable.pubkeys.includes(label.pubkey)
}));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map([[ADMIN, { name: 'Moderatorin Mia' }]])
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock('$lib/helpers/toast', () => ({ showToast: toast }));
vi.mock('$lib/paraglide/messages', () => ({
  community_removed_content_title: () => 'Removed content',
  community_removed_content_description: () => 'Removed by moderators.',
  community_removed_content_empty: () => 'Nothing removed.',
  community_removed_content_by: ({ name, date }) => `Removed by ${name} on ${date}`,
  community_removed_content_restore: () => 'Restore',
  community_removed_content_restored: () => 'Restored',
  community_removed_content_restore_failed: ({ error }) => `Restore failed: ${error}`,
  community_removed_content_restore_locked: () => 'Only the remover can restore',
  community_removed_content_unknown_item: ({ kind }) => `Unknown item (kind ${kind})`
}));

const { default: RemovedContentPane } = await import(
  '$lib/components/community/settings/RemovedContentPane.svelte'
);

const communikeyEvent = {
  kind: 10222,
  pubkey: COMMUNITY,
  tags: [['r', 'wss://community.example/']]
};

/** @param {string} pubkey @param {string} id @param {string[][]} targetTags */
const label = (pubkey, id, targetTags) => ({
  kind: 1985,
  pubkey,
  id,
  created_at: 1_760_000_000,
  content: '',
  tags: [
    ['L', 'communikey.moderation'],
    ['l', 'remove', 'communikey.moderation'],
    ['h', COMMUNITY],
    ...targetTags
  ]
});

beforeEach(() => {
  vi.clearAllMocks();
  restorable.pubkeys = [];
  store.getReplaceable.mockImplementation((kind, pubkey, d) =>
    kind === 30023 && pubkey === AUTHOR && d === 'my-article' ? article : undefined
  );
  store.getEvent.mockReturnValue(undefined);
  store.replaceable.mockImplementation(() => new BehaviorSubject(undefined));
  store.event.mockImplementation(() => new BehaviorSubject(undefined));
});

describe('RemovedContentPane', () => {
  it('shows the empty state', () => {
    render(RemovedContentPane, { props: { removals: [], communikeyEvent, onRestore: vi.fn() } });
    expect(screen.getByText('Nothing removed.')).toBeTruthy();
  });

  it('lists resolved titles with who removed them, and a placeholder for unresolved items', () => {
    const resolvedLabel = label(ADMIN, '7'.repeat(64), [
      ['k', '30023'],
      ['e', article.id],
      ['a', `30023:${AUTHOR}:my-article`]
    ]);
    const unresolvedLabel = label(COMMUNITY, '8'.repeat(64), [
      ['k', '11'],
      ['e', '2'.repeat(64)]
    ]);
    render(RemovedContentPane, {
      props: { removals: [resolvedLabel, unresolvedLabel], communikeyEvent, onRestore: vi.fn() }
    });
    expect(screen.getByText('Photosynthesis explained')).toBeTruthy();
    expect(screen.getByText(/Removed by Moderatorin Mia on/)).toBeTruthy();
    expect(screen.getByText('Unknown item (kind 11)')).toBeTruthy();
    // The unresolved target gets loaded, the resolved one does not.
    expect(fetchEventsByIds).toHaveBeenCalledWith(
      ['2'.repeat(64)],
      ['wss://community.example/', 'wss://lookup.example/'],
      expect.anything()
    );
    expect(addressLoader).not.toHaveBeenCalled();
  });

  it('offers Restore only for labels whose author key is present, and restores through onRestore', async () => {
    restorable.pubkeys = [ADMIN];
    const mine = label(ADMIN, '7'.repeat(64), [['a', `30023:${AUTHOR}:my-article`]]);
    const theirs = label(COMMUNITY, '8'.repeat(64), [['e', '2'.repeat(64)]]);
    const onRestore = vi.fn().mockResolvedValue(undefined);
    render(RemovedContentPane, { props: { removals: [mine, theirs], communikeyEvent, onRestore } });

    const buttons = screen.getAllByRole('button', { name: 'Restore' });
    expect(buttons).toHaveLength(1);
    expect(screen.getByText('Only the remover can restore')).toBeTruthy();

    await fireEvent.click(buttons[0]);
    expect(onRestore).toHaveBeenCalledWith(mine);
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Restored', 'success'));
  });

  it('reports a failed restore', async () => {
    restorable.pubkeys = [ADMIN];
    const mine = label(ADMIN, '7'.repeat(64), [['a', `30023:${AUTHOR}:my-article`]]);
    const onRestore = vi.fn().mockRejectedValue(new Error('no relay'));
    render(RemovedContentPane, { props: { removals: [mine], communikeyEvent, onRestore } });
    await fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Restore failed: no relay', 'error'));
  });
});
