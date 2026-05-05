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
  registerBunkerAccount
} from '../helpers/bunker-connection.js';
import { NostrConnectSigner } from 'applesauce-signers';

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

  it('calls open, connect, and getPublicKey on signer', async () => {
    const result = await connectWithBunkerUrl('bunker://abc123?relay=wss://relay.example.com', {
      pool: mockPool,
      onAuth: mockOnAuth
    });
    expect(mockSignerInstance.open).toHaveBeenCalled();
    expect(mockSignerInstance.connect).toHaveBeenCalled();
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

  it('calls getNostrConnectURI with app metadata', () => {
    const metadata = { name: 'ComCal', url: 'https://example.com' };
    createClientConnection(relays, {
      pool: mockPool,
      onAuth: mockOnAuth,
      appMetadata: metadata
    });
    expect(mockSignerInstance.getNostrConnectURI).toHaveBeenCalledWith(metadata);
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
