/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';

const ADMIN_PUBKEY = 'a'.repeat(64);
const USER_PUBKEY = 'user-pub';
const FORM_ADDRESS = `30168:${ADMIN_PUBKEY}:edufeed-membership`;

/** @type {{ events: any[] }} */
const timelineState = { events: [] };
/** @type {{ event: any | null }} */
const profileState = { event: null };
const decryptMock = vi.fn();
const actionRunnerRunMock = vi.fn();
// vi.hoisted lets us reference the mock from inside a (hoisted) vi.mock factory.
const { updateProfileMock, addProfileNip05TagMock } = vi.hoisted(() => ({
  updateProfileMock: vi.fn(
    /** @param {any} content */ (content) => ({ __action: 'UpdateProfile', content })
  ),
  addProfileNip05TagMock: vi.fn(
    /** @param {any} address */ (address) => ({ __action: 'AddProfileNip05Tag', address })
  )
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    get membership() {
      return {
        enabled: true,
        handleDomain: 'edufeed.org',
        formAddress: FORM_ADDRESS,
        adminPubkeys: [ADMIN_PUBKEY]
      };
    }
  }
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    active: {
      pubkey: 'user-pub',
      signer: {
        nip44: {
          decrypt: (/** @type {string} */ pubkey, /** @type {string} */ content) =>
            decryptMock(pubkey, content)
        }
      }
    }
  }
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    add: () => {},
    replaceable: (/** @type {number} */ kind, /** @type {string} */ _pubkey) => ({
      subscribe(/** @type {(event: any) => void} */ cb) {
        if (kind === 0) cb(profileState.event);
        return { unsubscribe: () => {} };
      }
    }),
    timeline: (/** @type {any} */ _filter) => ({
      subscribe(/** @type {(events: any[]) => void} */ cb) {
        cb(timelineState.events);
        return { unsubscribe: () => {} };
      }
    })
  }
}));

vi.mock('$lib/stores/action-runner.svelte.js', () => ({
  actionRunner: {
    run: (/** @type {any} */ builder, /** @type {any} */ ...args) =>
      actionRunnerRunMock(builder, ...args)
  }
}));

vi.mock('applesauce-actions/actions', () => ({
  UpdateProfile: updateProfileMock
}));

vi.mock('$lib/actions/profile-actions.js', () => ({
  AddProfileNip05Tag: addProfileNip05TagMock
}));

vi.mock('$lib/loaders/base.js', () => ({
  addressLoader: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }),
  timedPool: () => ({})
}));

vi.mock('applesauce-loaders/loaders', () => ({
  createTimelineLoader: () => () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getCommunikeyRelays: () => [],
  getAllLookupRelays: () => []
}));

vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: () => ({ build: vi.fn(), sign: vi.fn() })
}));

vi.mock('$lib/services/publish-service.js', () => ({
  publishEvent: vi.fn(async () => ({ success: true }))
}));

import MembershipCard from '../MembershipCard.svelte';

describe('MembershipCard', () => {
  beforeEach(() => {
    timelineState.events = [];
    profileState.event = null;
    decryptMock.mockReset();
    actionRunnerRunMock.mockReset();
    updateProfileMock.mockClear();
    addProfileNip05TagMock.mockClear();
  });

  it('shows CTA when no application exists', () => {
    const { getByRole } = render(MembershipCard);
    expect(getByRole('button', { name: /Jetzt beantragen|Apply now/i })).toBeTruthy();
  });

  it('shows submitted-on text when an application exists', () => {
    timelineState.events = [
      {
        id: 'response-id',
        kind: 1069,
        pubkey: 'user-pub',
        created_at: 1700000000,
        tags: [['a', FORM_ADDRESS]],
        content: '',
        sig: 'sig'
      }
    ];
    const { getByText } = render(MembershipCard);
    // Either German "Antrag eingereicht" or English "submitted an application"
    expect(getByText(/eingereicht|submitted/i)).toBeTruthy();
  });

  describe('"Add to profile" button', () => {
    const encryptedResponse = {
      id: 'response-id',
      kind: 1069,
      pubkey: USER_PUBKEY,
      created_at: 1700000000,
      tags: [['a', FORM_ADDRESS], ['encrypted']],
      content: 'encrypted-payload',
      sig: 'sig'
    };

    /** @type {ReturnType<typeof vi.fn>} */
    let fetchMock;
    /** @type {typeof fetch | undefined} */
    let originalFetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      fetchMock = vi.fn();
      // @ts-expect-error — jsdom global
      globalThis.fetch = fetchMock;
    });

    afterEach(() => {
      // @ts-expect-error — jsdom global
      globalThis.fetch = originalFetch;
    });

    /** Wait for any chain of `await` continuations triggered by mounting. */
    async function settle() {
      for (let i = 0; i < 5; i++) {
        await tick();
        await Promise.resolve();
      }
    }

    it('shows "Add to profile" when upstream handle maps to user and kind 0 has no nip05', async () => {
      timelineState.events = [encryptedResponse];
      decryptMock.mockResolvedValue(JSON.stringify([['response', 'wished_handle', 'maria']]));
      profileState.event = {
        kind: 0,
        pubkey: USER_PUBKEY,
        content: JSON.stringify({ name: 'M.' })
      };
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ names: { maria: USER_PUBKEY } })
      });

      const { findByRole } = render(MembershipCard);
      await settle();

      const btn = await findByRole('button', {
        name: /Add to (your )?profile|in (dein|euer) profil|Profil/i
      });
      expect(btn).toBeTruthy();
    });

    it('hides "Add to profile" when kind 0 already has the matching nip05', async () => {
      timelineState.events = [encryptedResponse];
      decryptMock.mockResolvedValue(JSON.stringify([['response', 'wished_handle', 'maria']]));
      profileState.event = {
        kind: 0,
        pubkey: USER_PUBKEY,
        content: JSON.stringify({ nip05: 'maria@edufeed.org' })
      };
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ names: { maria: USER_PUBKEY } })
      });

      const { queryByRole } = render(MembershipCard);
      await settle();

      expect(queryByRole('button', { name: /Add to (your )?profile|Profil/i })).toBeNull();
    });

    it('hides "Add to profile" when upstream does not yet map the handle to the user', async () => {
      timelineState.events = [encryptedResponse];
      decryptMock.mockResolvedValue(JSON.stringify([['response', 'wished_handle', 'maria']]));
      profileState.event = null;
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ names: {} })
      });

      const { queryByRole } = render(MembershipCard);
      await settle();

      expect(queryByRole('button', { name: /Add to (your )?profile|Profil/i })).toBeNull();
    });

    it('hides "Add to profile" when upstream maps the handle to a different pubkey', async () => {
      timelineState.events = [encryptedResponse];
      decryptMock.mockResolvedValue(JSON.stringify([['response', 'wished_handle', 'maria']]));
      profileState.event = null;
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ names: { maria: 'someone-else' } })
      });

      const { queryByRole } = render(MembershipCard);
      await settle();

      expect(queryByRole('button', { name: /Add to (your )?profile|Profil/i })).toBeNull();
    });

    it('clicking the button calls actionRunner.run(UpdateProfile, { nip05 })', async () => {
      timelineState.events = [encryptedResponse];
      decryptMock.mockResolvedValue(JSON.stringify([['response', 'wished_handle', 'maria']]));
      profileState.event = {
        kind: 0,
        pubkey: USER_PUBKEY,
        content: JSON.stringify({ name: 'M.' })
      };
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ names: { maria: USER_PUBKEY } })
      });
      actionRunnerRunMock.mockResolvedValue(undefined);

      const { findByRole } = render(MembershipCard);
      await settle();
      const btn = await findByRole('button', { name: /Add to (your )?profile|Profil/i });
      await fireEvent.click(btn);
      await settle();

      // ActionRunner.run is called with the builder + args (not a constructed action).
      expect(actionRunnerRunMock).toHaveBeenCalledTimes(1);
      const [builder, content] = actionRunnerRunMock.mock.calls[0];
      // The builder we passed is the mocked UpdateProfile.
      expect(builder).toBe(updateProfileMock);
      expect(content).toEqual({ nip05: 'maria@edufeed.org' });
    });
  });

  describe('replace-or-add when a different nip05 already exists', () => {
    const encryptedResponse = {
      id: 'response-id',
      kind: 1069,
      pubkey: USER_PUBKEY,
      created_at: 1700000000,
      tags: [['a', FORM_ADDRESS], ['encrypted']],
      content: 'encrypted-payload',
      sig: 'sig'
    };

    /** @type {ReturnType<typeof vi.fn>} */
    let fetchMock;
    /** @type {typeof fetch | undefined} */
    let originalFetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      fetchMock = vi.fn();
      // @ts-expect-error — jsdom global
      globalThis.fetch = fetchMock;
      timelineState.events = [encryptedResponse];
      decryptMock.mockResolvedValue(JSON.stringify([['response', 'wished_handle', 'maria']]));
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ names: { maria: USER_PUBKEY } })
      });
    });

    afterEach(() => {
      // @ts-expect-error — jsdom global
      globalThis.fetch = originalFetch;
    });

    async function settle() {
      for (let i = 0; i < 5; i++) {
        await tick();
        await Promise.resolve();
      }
    }

    it('offers Replace and Add buttons instead of a single CTA', async () => {
      profileState.event = {
        kind: 0,
        pubkey: USER_PUBKEY,
        content: JSON.stringify({ nip05: 'maria@other.org' }),
        tags: []
      };

      const { findByRole, queryByRole } = render(MembershipCard);
      await settle();

      expect(await findByRole('button', { name: /Ersetzen|Replace/i })).toBeTruthy();
      expect(await findByRole('button', { name: /zusätzlich|additional/i })).toBeTruthy();
      expect(queryByRole('button', { name: /Add to (your )?profile|in dein Profil/i })).toBeNull();
    });

    it('Replace calls UpdateProfile with the new address', async () => {
      profileState.event = {
        kind: 0,
        pubkey: USER_PUBKEY,
        content: JSON.stringify({ nip05: 'maria@other.org' }),
        tags: []
      };
      actionRunnerRunMock.mockResolvedValue(undefined);

      const { findByRole } = render(MembershipCard);
      await settle();
      await fireEvent.click(await findByRole('button', { name: /Ersetzen|Replace/i }));
      await settle();

      expect(actionRunnerRunMock).toHaveBeenCalledTimes(1);
      const [builder, content] = actionRunnerRunMock.mock.calls[0];
      expect(builder).toBe(updateProfileMock);
      expect(content).toEqual({ nip05: 'maria@edufeed.org' });
    });

    it('Add calls AddProfileNip05Tag with the new address', async () => {
      profileState.event = {
        kind: 0,
        pubkey: USER_PUBKEY,
        content: JSON.stringify({ nip05: 'maria@other.org' }),
        tags: []
      };
      actionRunnerRunMock.mockResolvedValue(undefined);

      const { findByRole } = render(MembershipCard);
      await settle();
      await fireEvent.click(await findByRole('button', { name: /zusätzlich|additional/i }));
      await settle();

      expect(actionRunnerRunMock).toHaveBeenCalledTimes(1);
      const [builder, address] = actionRunnerRunMock.mock.calls[0];
      expect(builder).toBe(addProfileNip05TagMock);
      expect(address).toBe('maria@edufeed.org');
    });

    it('hides the CTA entirely when the address already exists as a nip05 tag', async () => {
      profileState.event = {
        kind: 0,
        pubkey: USER_PUBKEY,
        content: JSON.stringify({ nip05: 'maria@other.org' }),
        tags: [['nip05', 'maria@edufeed.org']]
      };

      const { queryByRole } = render(MembershipCard);
      await settle();

      expect(queryByRole('button', { name: /Ersetzen|Replace/i })).toBeNull();
      expect(queryByRole('button', { name: /zusätzlich|additional/i })).toBeNull();
      expect(queryByRole('button', { name: /Add to (your )?profile|in dein Profil/i })).toBeNull();
    });
  });

  it('does not render when membership is disabled', async () => {
    const cfgModule = await import('$lib/stores/config.svelte.js');
    // override the getter via direct mock manipulation
    Object.defineProperty(cfgModule.runtimeConfig, 'membership', {
      configurable: true,
      get() {
        return { enabled: false, handleDomain: '', formAddress: '', adminPubkeys: [] };
      }
    });
    const { container } = render(MembershipCard);
    expect(container.textContent?.trim()).toBe('');
    // restore default
    Object.defineProperty(cfgModule.runtimeConfig, 'membership', {
      configurable: true,
      get() {
        return {
          enabled: true,
          handleDomain: 'edufeed.org',
          formAddress: FORM_ADDRESS,
          adminPubkeys: [ADMIN_PUBKEY]
        };
      }
    });
  });
});
