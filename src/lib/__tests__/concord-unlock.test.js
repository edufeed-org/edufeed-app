/** @vitest-environment node */
/**
 * unlockConcordLists() — the "Sync private areas" affordance's imperative
 * action. Drives initConcordService() with a fake ConcordClient (same setup
 * shape as concord-client-generation-guard.test.js) so the module's real
 * setup()/currentClient wiring is exercised, not just a mocked function.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Subject } from 'rxjs';

/** Minimal synchronous "BehaviorSubject-like" observable stub.
 * @param {any} value
 */
function of(value) {
  return {
    /** @param {any} observer */
    subscribe(observer) {
      const next = typeof observer === 'function' ? observer : observer.next;
      next(value);
      return { unsubscribe() {} };
    }
  };
}

const active$ = new Subject();

/** @type {{ communityList: any, inviteList: any }} */
const casts = vi.hoisted(() => ({ communityList: null, inviteList: null }));

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: { active$, accounts$: { subscribe: () => ({ unsubscribe() {} }) }, accounts: [] }
}));
vi.mock('$lib/stores/config.svelte.js', () => ({
  configReady: {
    subscribe: (/** @type {(ready: boolean) => void} */ cb) => {
      cb(true);
      return () => {};
    }
  },
  runtimeConfig: { concord: { enabled: true, relays: ['wss://concord.test'] } }
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({ pool: {} }));
vi.mock('../concord/storage.js', () => ({
  concordDbName: (/** @type {string} */ pk) => `concord-${pk}`,
  createConcordStorage: () => ({}),
  createConcordStoreFactory: () => ({})
}));
vi.mock('../concord/account-removal-watcher.js', () => ({ watchAccountRemovals: vi.fn() }));

vi.mock('applesauce-concord', () => {
  class FakeConcordClient {
    /** @param {any} opts */
    constructor(opts) {
      this.signer = opts.signer;
      this.pubkey = opts.signer.pubkey;
      this.communities$ = { subscribe: () => ({ unsubscribe() {} }) };
      this.phase$ = { subscribe: () => ({ unsubscribe() {} }) };
    }
    get communityList$() {
      return of(casts.communityList);
    }
    get inviteList$() {
      return of(casts.inviteList);
    }
    async start() {}
    stop() {}
  }
  return { ConcordClient: FakeConcordClient, Helpers: { STOCK_RELAYS: [] } };
});

const { initConcordService, unlockConcordLists, getConcordState } = await import(
  '../concord/client.svelte.js'
);

/** Flush pending microtasks + one macrotask — dynamic import() inside
 * setup() can take more than a single microtask tick even for an
 * already-loaded module (see concord-client-generation-guard.test.js). */
async function flush(times = 10) {
  for (let i = 0; i < times; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** @param {boolean} unlocked */
function fakeCast(unlocked) {
  return { unlocked, unlock: vi.fn(async () => {}) };
}

describe('unlockConcordLists', () => {
  beforeEach(() => {
    casts.communityList = null;
    casts.inviteList = null;
  });

  it('returns false with no active client', async () => {
    expect(await unlockConcordLists()).toBe(false);
  });

  it('returns false when the signer lacks nip44', async () => {
    await initConcordService();
    active$.next({ pubkey: 'nostr44less', signer: { pubkey: 'nostr44less' } });
    await flush();
    expect(await unlockConcordLists()).toBe(false);
  });

  it('unlocks both locked casts and flips state.unlocked', async () => {
    await initConcordService();
    casts.communityList = fakeCast(false);
    casts.inviteList = fakeCast(false);
    active$.next({ pubkey: 'alice', signer: { pubkey: 'alice', nip44: {} } });
    await flush();

    const result = await unlockConcordLists();

    expect(result).toBe(true);
    expect(casts.communityList.unlock).toHaveBeenCalledWith({ pubkey: 'alice', nip44: {} });
    expect(casts.inviteList.unlock).toHaveBeenCalledWith({ pubkey: 'alice', nip44: {} });
    expect(getConcordState().unlocking).toBe(false);
    expect(getConcordState().unlocked).toBe(true);
  });

  it('skips casts that are already unlocked', async () => {
    await initConcordService();
    casts.communityList = fakeCast(true);
    casts.inviteList = fakeCast(false);
    active$.next({ pubkey: 'bob', signer: { pubkey: 'bob', nip44: {} } });
    await flush();

    await unlockConcordLists();

    expect(casts.communityList.unlock).not.toHaveBeenCalled();
    expect(casts.inviteList.unlock).toHaveBeenCalled();
  });

  it('catches an unlock error, logs it, and returns false without leaving unlocking true', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await initConcordService();
    casts.communityList = {
      unlocked: false,
      unlock: vi.fn(async () => {
        throw new Error('bad ciphertext');
      })
    };
    casts.inviteList = fakeCast(false);
    active$.next({ pubkey: 'carol', signer: { pubkey: 'carol', nip44: {} } });
    await flush();

    const result = await unlockConcordLists();

    expect(result).toBe(false);
    expect(getConcordState().unlocking).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('auto-unlock at client start', () => {
  beforeEach(() => {
    casts.communityList = null;
    casts.inviteList = null;
  });

  it('unlocks a locked list without user action once the client is up', async () => {
    await initConcordService();
    casts.communityList = fakeCast(false);
    casts.inviteList = fakeCast(false);
    active$.next({ pubkey: 'dora', signer: { pubkey: 'dora', nip44: {} } });
    await flush();

    expect(casts.communityList.unlock).toHaveBeenCalled();
    expect(casts.inviteList.unlock).toHaveBeenCalled();
  });

  it('makes zero unlock calls when the list is already unlocked', async () => {
    await initConcordService();
    casts.communityList = fakeCast(true);
    active$.next({ pubkey: 'emil', signer: { pubkey: 'emil', nip44: {} } });
    await flush();

    expect(casts.communityList.unlock).not.toHaveBeenCalled();
  });

  it('never auto-attempts for signers without nip44 (the manual affordance stays the only path)', async () => {
    await initConcordService();
    casts.communityList = fakeCast(false);
    active$.next({ pubkey: 'fritz', signer: { pubkey: 'fritz' } });
    await flush();

    expect(casts.communityList.unlock).not.toHaveBeenCalled();
  });
});
