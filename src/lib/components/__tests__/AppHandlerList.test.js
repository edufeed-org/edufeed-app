/**
 * AppHandlerList — NIP-89 "open in another app" links on the generic event
 * view. The loader is mocked; this covers what the component does with its
 * result: entity encoding (naddr vs nevent), URL resolution per handler,
 * recommendation badge, kind-0 fallback for nameless handlers, and the
 * feature-off / nothing-found states.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { nip19 } from 'nostr-tools';

const OWNER = '1c5ff3caacd842c01dca8f378231b16617516d214da75c7aeabbe9e1efe9c0f6';
const ME = 'e'.repeat(64);
const FRIEND = 'f'.repeat(64);
const APP_A = 'a'.repeat(64);
const APP_B = 'b'.repeat(64);

const doubles = vi.hoisted(() => ({
  /** @type {any} */ activeUser: null,
  /** @type {string[]} */ contacts: [],
  /** @type {string[]} */ relays: ['wss://handlers.example'],
  load: vi.fn()
}));

vi.mock('$lib/stores/accounts.svelte.js', () => ({
  useActiveUser: () => () => doubles.activeUser
}));
vi.mock('$lib/stores/contacts.svelte.js', () => ({
  contactsStore: {
    get contacts() {
      return doubles.contacts;
    }
  }
}));
vi.mock('$lib/stores/profile-map.svelte.js', async () => ({
  useProfileMap: (await import('./fixtures/profile-map-mock.svelte.js')).useProfileMap
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAppHandlerRelays: () => doubles.relays,
  getAppManagedRelays: () => []
}));
vi.mock('$lib/loaders/app-handlers.js', () => ({
  loadAppHandlers: doubles.load
}));

import * as m from '$lib/paraglide/messages';
import { profiles } from './fixtures/profile-map-mock.svelte.js';
import AppHandlerList from '../shared/AppHandlerList.svelte';

const REPO = {
  kind: 30617,
  id: 'a'.repeat(64),
  pubkey: OWNER,
  created_at: 1_790_000_000,
  content: '',
  tags: [['d', 'edufeed-app']],
  sig: 'b'.repeat(128)
};

/**
 * @param {Partial<import('$lib/loaders/app-handlers.js').DiscoveredHandler>} h
 * @returns {import('$lib/loaders/app-handlers.js').DiscoveredHandler}
 */
const handler = (h) => ({
  address: `31990:${APP_A}:x`,
  pubkey: APP_A,
  identifier: 'x',
  createdAt: 1,
  kinds: [30617],
  name: null,
  picture: null,
  about: null,
  web: [],
  recommended: false,
  ...h
});

describe('AppHandlerList', () => {
  beforeEach(() => {
    doubles.activeUser = null;
    doubles.contacts = [];
    doubles.relays = ['wss://handlers.example'];
    doubles.load.mockReset();
    profiles.map = new Map();
  });
  afterEach(() => cleanup());

  it('asks the loader with the user + follows and links each handler with the naddr substituted', async () => {
    doubles.activeUser = { pubkey: ME };
    doubles.contacts = [FRIEND, ME];
    doubles.load.mockResolvedValue([
      handler({
        name: 'GitWorkshop',
        about: 'Code on nostr',
        recommended: true,
        web: [{ template: 'https://gitworkshop.dev/<bech32>', type: 'naddr' }]
      }),
      handler({
        address: `31990:${APP_B}:y`,
        pubkey: APP_B,
        identifier: 'y',
        name: 'NoteOnly',
        web: [{ template: 'https://notes.example/<bech32>', type: 'nevent' }]
      })
    ]);

    render(AppHandlerList, { event: REPO });
    flushSync();

    expect(doubles.load).toHaveBeenCalledWith(30617, { authors: [ME, FRIEND] });
    const naddr = nip19.naddrEncode({
      kind: 30617,
      pubkey: OWNER,
      identifier: 'edufeed-app',
      relays: []
    });
    await waitFor(() => expect(screen.getByText('GitWorkshop')).toBeTruthy());

    const links = /** @type {HTMLAnchorElement[]} */ (screen.getAllByRole('link'));
    expect(links.map((a) => a.href)).toEqual([`https://gitworkshop.dev/${naddr}`]);
    expect(links[0].target).toBe('_blank');
    expect(links[0].rel).toBe('noopener noreferrer');
    expect(screen.getByText(m.app_handlers_recommended())).toBeTruthy();
    expect(screen.getByText('Code on nostr')).toBeTruthy();
    // NoteOnly has no template for an addressable entity → no row at all.
    expect(screen.queryByText('NoteOnly')).toBeNull();
  });

  it('uses nevent for regular kinds and the handler profile when the event carries no metadata', async () => {
    const note = { ...REPO, kind: 1337, tags: [] };
    doubles.load.mockResolvedValue([
      handler({ web: [{ template: 'https://any.example/<bech32>', type: null }] })
    ]);
    profiles.map = new Map([[APP_A, { name: 'FromKind0', picture: 'https://pic/a.png' }]]);

    render(AppHandlerList, { event: note });
    flushSync();

    expect(doubles.load).toHaveBeenCalledWith(1337, { authors: [] });
    await waitFor(() => expect(screen.getByText('FromKind0')).toBeTruthy());
    expect(profiles.requested).toEqual([APP_A]);
    const nevent = nip19.neventEncode({ id: note.id, relays: [] });
    expect(/** @type {HTMLAnchorElement} */ (screen.getByRole('link')).href).toBe(
      `https://any.example/${nevent}`
    );
  });

  it('says so when nothing was found', async () => {
    doubles.load.mockResolvedValue([]);
    render(AppHandlerList, { event: REPO });
    flushSync();
    await waitFor(() => expect(screen.getByText(m.app_handlers_none())).toBeTruthy());
  });

  it('renders nothing at all while the feature is switched off', () => {
    doubles.relays = [];
    const { container } = render(AppHandlerList, { event: REPO });
    flushSync();
    expect(doubles.load).not.toHaveBeenCalled();
    expect(container.querySelector('section')).toBeNull();
  });
});
