/** @vitest-environment node */
// @ts-nocheck — mock types intentionally don't match full interfaces
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted so mock factories can reference this
const { mockSignerInstance } = vi.hoisted(() => ({
  mockSignerInstance: {
    open: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn().mockResolvedValue('ack'),
    getPublicKey: vi.fn().mockResolvedValue('abc123pubkey'),
    getNostrConnectURI: vi
      .fn()
      .mockReturnValue('nostrconnect://abc123?relay=wss://relay.example.com'),
    waitForSigner: vi.fn().mockResolvedValue(undefined),
    close: vi.fn()
  }
}));

// Mock applesauce-signers
vi.mock('applesauce-signers', () => {
  class NostrConnectSigner {
    constructor(opts) {
      Object.assign(this, mockSignerInstance);
      this._opts = opts;
    }
  }
  NostrConnectSigner.fromBunkerURI = vi.fn().mockResolvedValue(mockSignerInstance);
  NostrConnectSigner.pool = null;

  class PrivateKeySigner {
    constructor() {
      this.getPublicKey = vi.fn();
    }
  }

  return { NostrConnectSigner, PrivateKeySigner };
});

// Mock applesauce-accounts
vi.mock('applesauce-accounts/accounts', () => {
  class NostrConnectAccount {
    constructor(pubkey, signer) {
      this.pubkey = pubkey;
      this.signer = signer;
      this.type = 'nostr-connect';
    }
  }
  return { NostrConnectAccount };
});

// Mock nostr-tools
vi.mock('nostr-tools', () => ({
  generateSecretKey: vi.fn(() => new Uint8Array(32))
}));

import {
  validateBunkerUrl,
  connectWithBunkerUrl,
  createClientConnection,
  registerBunkerAccount,
  buildClientConnectRelays,
  firstAcceptedPublish,
  useNostrConnectPool
} from '../helpers/bunker-connection.js';
import { NostrConnectSigner } from 'applesauce-signers';
import { AUTH_AWARE_PUBLISH_RETRY } from '../services/relay-publish-auth.js';
import { buildNip46Permissions } from '../helpers/nip46-permissions.js';

describe('validateBunkerUrl', () => {
  it('rejects empty input', () => {
    const result = validateBunkerUrl('');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects non-bunker URLs', () => {
    const result = validateBunkerUrl('https://example.com');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects whitespace-only input', () => {
    const result = validateBunkerUrl('   ');
    expect(result.valid).toBe(false);
  });

  it('accepts valid bunker:// URLs', () => {
    const result = validateBunkerUrl('bunker://abc123?relay=wss://relay.example.com');
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('trims whitespace before validating', () => {
    const result = validateBunkerUrl('  bunker://abc123  ');
    expect(result.valid).toBe(true);
  });
});

describe('connectWithBunkerUrl', () => {
  const mockPool = { request: vi.fn() };
  const mockOnAuth = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    NostrConnectSigner.pool = null;
  });

  it('sets NostrConnectSigner.pool', async () => {
    await connectWithBunkerUrl('bunker://abc123?relay=wss://relay.example.com', {
      pool: mockPool,
      onAuth: mockOnAuth
    });
    expect(NostrConnectSigner.pool).toBe(mockPool);
  });

  it('calls fromBunkerURI with the URL', async () => {
    const url = 'bunker://abc123?relay=wss://relay.example.com';
    await connectWithBunkerUrl(url, { pool: mockPool, onAuth: mockOnAuth });
    expect(NostrConnectSigner.fromBunkerURI).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ onAuth: mockOnAuth })
    );
  });

  it('requests the signing permissions with the connect (bunker:// flow)', async () => {
    const url = 'bunker://abc123?relay=wss://relay.example.com';
    await connectWithBunkerUrl(url, { pool: mockPool, onAuth: mockOnAuth });
    expect(NostrConnectSigner.fromBunkerURI).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ permissions: buildNip46Permissions() })
    );
  });

  it('calls getPublicKey but NOT a redundant open/connect after fromBunkerURI', async () => {
    // NostrConnectSigner.fromBunkerURI already calls .connect() (which itself
    // calls .open()) internally with the secret parsed from the bunker URI.
    // Calling them again here re-sends a Connect RPC WITHOUT the secret,
    // which strict bunkers (nsec.app, recent Amber) reject — and connect()'s
    // catch destroys the subscription, leaving the signer unusable.
    const result = await connectWithBunkerUrl('bunker://abc123?relay=wss://relay.example.com', {
      pool: mockPool,
      onAuth: mockOnAuth
    });
    expect(mockSignerInstance.open).not.toHaveBeenCalled();
    expect(mockSignerInstance.connect).not.toHaveBeenCalled();
    expect(mockSignerInstance.getPublicKey).toHaveBeenCalled();
    expect(result.pubkey).toBe('abc123pubkey');
    expect(result.signer).toBe(mockSignerInstance);
  });
});

describe('createClientConnection', () => {
  const mockPool = { request: vi.fn() };
  const mockOnAuth = vi.fn();
  const relays = ['wss://relay.example.com'];

  beforeEach(() => {
    vi.clearAllMocks();
    NostrConnectSigner.pool = null;
  });

  it('sets NostrConnectSigner.pool', () => {
    createClientConnection(relays, {
      pool: mockPool,
      onAuth: mockOnAuth,
      appMetadata: { name: 'ComCal', url: 'https://example.com' }
    });
    expect(NostrConnectSigner.pool).toBe(mockPool);
  });

  it('returns signer, uri, open, and waitForSigner', () => {
    const result = createClientConnection(relays, {
      pool: mockPool,
      onAuth: mockOnAuth,
      appMetadata: { name: 'ComCal', url: 'https://example.com' }
    });
    expect(result.signer).toBeDefined();
    expect(result.uri).toBe('nostrconnect://abc123?relay=wss://relay.example.com');
    expect(typeof result.open).toBe('function');
    expect(typeof result.waitForSigner).toBe('function');
  });

  it('calls getNostrConnectURI with app metadata AND the signing permissions', () => {
    // Without `perms` in the nostrconnect:// URI Amber approves only the
    // connection; the first signature of every kind then waits in its
    // approval queue — the "Waiting for your signing app…" toast right after
    // login (the kind 22242 AUTH for the groups relay) was exactly that.
    const metadata = { name: 'ComCal', url: 'https://example.com' };
    createClientConnection(relays, {
      pool: mockPool,
      onAuth: mockOnAuth,
      appMetadata: metadata
    });
    expect(mockSignerInstance.getNostrConnectURI).toHaveBeenCalledWith({
      ...metadata,
      permissions: buildNip46Permissions()
    });
    const perms = mockSignerInstance.getNostrConnectURI.mock.calls[0][0].permissions;
    expect(perms).toContain('sign_event:22242');
    expect(perms).toContain('nip44_decrypt');
  });
});

describe('registerBunkerAccount', () => {
  it('creates account and adds to manager when pubkey is new', () => {
    const mockManager = {
      getAccountForPubkey: vi.fn().mockReturnValue(null),
      addAccount: vi.fn(),
      setActive: vi.fn()
    };
    const mockSigner = { getPublicKey: vi.fn() };
    const pubkey = 'newpubkey123';

    const result = registerBunkerAccount(mockManager, pubkey, mockSigner);

    expect(mockManager.addAccount).toHaveBeenCalledTimes(1);
    expect(mockManager.setActive).toHaveBeenCalledTimes(1);
    // The newly created account is what was added AND what was set active
    const addedAccount = mockManager.addAccount.mock.calls[0][0];
    expect(mockManager.setActive.mock.calls[0][0]).toBe(addedAccount);
    expect(result.account).toBe(addedAccount);
    expect(result.alreadyExisted).toBe(false);
  });

  it('skips addAccount and sets the EXISTING account ref active when pubkey exists', () => {
    // Stub the existing account; importantly, the manager looks up by id internally,
    // so passing a freshly-built NostrConnectAccount (different nanoid id) would throw.
    // We assert that the existing reference is what's passed to setActive.
    const existingAccount = { id: 'existing-id', pubkey: 'existingpubkey' };
    const mockManager = {
      getAccountForPubkey: vi.fn().mockReturnValue(existingAccount),
      addAccount: vi.fn(),
      setActive: vi.fn()
    };
    const mockSigner = { getPublicKey: vi.fn() };

    const result = registerBunkerAccount(mockManager, 'existingpubkey', mockSigner);

    expect(mockManager.addAccount).not.toHaveBeenCalled();
    expect(mockManager.setActive).toHaveBeenCalledTimes(1);
    // CRITICAL: must be the same object reference, not a fresh NostrConnectAccount
    expect(mockManager.setActive.mock.calls[0][0]).toBe(existingAccount);
    expect(result.account).toBe(existingAccount);
    expect(result.alreadyExisted).toBe(true);
  });
});

describe('buildClientConnectRelays', () => {
  // The QR-mode `nostrconnect://` URI lists the relays the signer answers on.
  // It used to force wss://relay.nsec.app in as a "rendezvous relay"; that
  // relay went dark in 2026-11 and, being listed, made every NIP-46 request
  // wait for its publish timeout. The deployment's fallback relays suffice.
  it('is the deduplicated fallback list, without relay.nsec.app', () => {
    expect(
      buildClientConnectRelays(['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.damus.io'])
    ).toEqual(['wss://relay.damus.io', 'wss://nos.lol']);
  });

  it('never adds relay.nsec.app on its own', () => {
    expect(buildClientConnectRelays(['wss://relay.damus.io'])).not.toContain(
      'wss://relay.nsec.app'
    );
  });

  it('falls back to public relays when the deployment configures none (a QR without relays cannot pair)', () => {
    for (const empty of [[], undefined, null, ['']]) {
      const relays = buildClientConnectRelays(empty);
      expect(relays.length).toBeGreaterThan(0);
      expect(relays.every((r) => r.startsWith('wss://'))).toBe(true);
    }
  });
});

describe('firstAcceptedPublish', () => {
  /** A pool whose relays answer after `ms` with `ok`, or never (ms = null). */
  function poolWith(answers) {
    return {
      relay: (url) => ({
        publish: () => {
          const a = answers[url];
          if (a === null) return new Promise(() => {});
          if (a instanceof Error) return Promise.reject(a);
          return Promise.resolve({ ok: a, from: url, message: a ? '' : 'restricted' });
        }
      })
    };
  }

  it('resolves as soon as ONE relay accepts, without waiting for a dead relay', async () => {
    const publish = firstAcceptedPublish(
      poolWith({ 'wss://dead': null, 'wss://paid': false, 'wss://ok': true })
    );
    await expect(publish(['wss://dead', 'wss://paid', 'wss://ok'], {})).resolves.toBeUndefined();
  });

  it('rejects once every relay has refused or failed', async () => {
    const publish = firstAcceptedPublish(
      poolWith({ 'wss://paid': false, 'wss://broken': new Error('closed') })
    );
    await expect(publish(['wss://paid', 'wss://broken'], {})).rejects.toThrow(/restricted|closed/);
  });

  it('publishes with a timeout and the auth-aware retry, so an auth-required relay cannot park it', async () => {
    const calls = [];
    const pool = {
      relay: (url) => ({
        publish: (_event, opts) => {
          calls.push(opts);
          return Promise.resolve({ ok: true, from: url });
        }
      })
    };
    await firstAcceptedPublish(pool)(['wss://a'], {});
    expect(calls[0].timeout).toBeGreaterThan(0);
    expect(calls[0].retries).toBe(AUTH_AWARE_PUBLISH_RETRY);
  });

  it('is installed as the class publishMethod by useNostrConnectPool', () => {
    const pool = poolWith({});
    useNostrConnectPool(pool);
    expect(NostrConnectSigner.pool).toBe(pool);
    expect(typeof NostrConnectSigner.publishMethod).toBe('function');
  });
});
