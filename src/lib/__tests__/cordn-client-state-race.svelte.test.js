// @ts-nocheck

/** @vitest-environment jsdom */
// Regression for the send()/poll MLS-state race (review finding 2026-08-28):
// send() reads state, awaits postGroupMessage, then writes the derived state.
// The 3s poll's #ingest does the same. If poll ingests a Commit DURING send's
// await, send's later write clobbers the advanced epoch while the fetchCursor
// stays advanced — every later message then fails to decrypt forever. The
// client serializes both through one mutex so they never interleave.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Leaf-module mocks: model MLS state as a plain {epoch} object so we can
//    watch it advance and be clobbered. ──
const gate = vi.hoisted(() => ({
  /** @type {(() => void)[]} */ postResolvers: [],
  order: /** @type {string[]} */ ([])
}));

vi.mock('$lib/cordn/mls.js', () => ({
  SiblingCommitSkippedError: class extends Error {},
  createChatMessage: vi.fn(async ({ state }) => ({
    // send derives a new state from the epoch it READ at call time.
    newState: { epoch: state.epoch + 1, from: 'send' },
    opaqueMessageBase64: btoa('send-msg')
  })),
  processOpaqueMessage: vi.fn(async ({ state }) => ({
    kind: 'application',
    envelopeJson: JSON.stringify({ pubkey: 'peer', content: 'hi' }),
    senderPubkey: 'peer',
    // poll's ingest advances the epoch by applying the incoming message.
    newState: { epoch: state.epoch + 1, from: 'poll' }
  })),
  deriveGroupPayloadKey: vi.fn(async () => new Uint8Array([1])),
  decodeStateBase64: vi.fn((s) => ({ epoch: 0, from: s })),
  encodeStateBase64: vi.fn(() => 'enc'),
  findGroupMetadata: vi.fn(() => null),
  listMemberPubkeys: vi.fn(() => []),
  // unused by this test but imported by the client:
  addMember: vi.fn(),
  createInitialGroupState: vi.fn(),
  decodeKeyPackagePair: vi.fn(),
  generateChatKeyPackage: vi.fn(),
  getGid: vi.fn(),
  joinFromWelcome: vi.fn(),
  parseConsumedKeyPackage: vi.fn()
}));

vi.mock('$lib/cordn/sealed-payload.js', () => ({
  sealPayload: vi.fn(() => 'sealed'),
  unsealPayload: vi.fn(() => new Uint8Array([1, 2, 3]))
}));
vi.mock('$lib/cordn/envelope.js', () => ({
  buildEnvelope: vi.fn(() => ({ pubkey: 'me', content: 'x' })),
  validateEnvelope: vi.fn(() => ({ valid: true })),
  CORDN_CHAT_KIND: 445
}));
vi.mock('$lib/cordn/group-metadata.js', () => ({ findGroupMetadata: vi.fn(() => null) }));
vi.mock('$lib/cordn/multidevice-sync.js', () => ({
  buildChainRanges: vi.fn(),
  parseConnectionString: vi.fn(),
  parseTipEvent: vi.fn(),
  planReconcile: vi.fn(() => []),
  unsealDocument: vi.fn()
}));
vi.mock('$lib/cordn/multidevice-net.js', () => ({
  fetchBlossomText: vi.fn(),
  fetchLatestTip: vi.fn()
}));
vi.mock('$lib/cordn/storage.js', () => ({
  CordnStorage: class {
    async get() {
      return undefined;
    }
    async set() {}
  }
}));

const rpc = vi.hoisted(() => ({
  // postGroupMessage blocks until the test releases it — this is send's await
  // window, during which poll gets a chance to run.
  postGroupMessage: vi.fn(
    () =>
      new Promise((resolve) => {
        gate.postResolvers.push(() => resolve({ cursor: 5, at: 111 }));
      })
  ),
  fetchManyGroupMessages: vi.fn(async () => ({
    messages: [{ cursor: 7, gid: 'g1', msg_64: 'incoming', at: 222 }]
  }))
}));
vi.mock('$lib/cordn/coordinator-rpc.js', () => ({
  CordnCoordinatorRpc: class {
    constructor() {
      return rpc;
    }
  }
}));

const { CordnGroupsClient } = await import('$lib/cordn/client.svelte.js');

/** A client with one group already seeded at epoch 0. */
function seededClient() {
  const client = new CordnGroupsClient({
    pubkey: 'me',
    signer: {},
    config: { coordinatorPubkeys: ['coord'], relays: ['wss://r'] }
  });
  client.states.set('g1', { epoch: 0, from: 'seed' });
  client.groups = [
    {
      gid: 'g1',
      name: 'G',
      coordinatorPubkey: 'coord',
      members: [],
      adminPubkeys: [],
      fetchCursor: 0,
      messages: []
    }
  ];
  return client;
}

describe('cordn client — send/poll do not clobber each other’s MLS state', () => {
  beforeEach(() => {
    gate.postResolvers = [];
    gate.order = [];
  });

  it('a poll that lands during send()’s await does not lose its ingested epoch', async () => {
    const client = seededClient();

    // Start send: it reads epoch 0, then blocks in postGroupMessage.
    const sending = client.send('g1', 'hello');
    await Promise.resolve();
    await Promise.resolve();

    // While send is blocked, a poll fires. With the mutex it must queue behind
    // send; without it, its ingest advances the epoch and send then clobbers it.
    const polling = client.poll();
    await Promise.resolve();

    // Release send's RPC and let everything settle.
    gate.postResolvers.forEach((r) => r());
    await sending;
    await polling;

    // After both: send advanced 0→1 (from:'send'), THEN poll ingested the
    // incoming message advancing 1→2 (from:'poll'). The final live state must
    // reflect the poll's epoch, not be stuck at send's — and the message must
    // have been recorded.
    const finalState = client.states.get('g1');
    expect(finalState.epoch).toBe(2);
    expect(finalState.from).toBe('poll');
    const group = client.groups.find((g) => g.gid === 'g1');
    // Both the sent message and the ingested peer message survive.
    expect(group.messages.map((m) => m.content)).toEqual(['hello', 'hi']);
    expect(group.fetchCursor).toBe(7);
  });
});
