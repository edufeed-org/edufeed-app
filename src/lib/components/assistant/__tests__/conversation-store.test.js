/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { of } from 'rxjs';

const state = vi.hoisted(() => ({
  /** @type {string[]} */ lookup: ['wss://lookup.test'],
  /** @type {string[]} */ write: ['wss://write.test']
}));
vi.mock('$lib/helpers/event-factory.js', () => ({
  finalizeDraft: (/** @type {any} */ d) => Promise.resolve(d)
}));
vi.mock('$lib/helpers/eventDeletion.js', () => ({ deleteEvent: vi.fn() }));
vi.mock('$lib/loaders/base.js', () => ({ fetchEvents: vi.fn() }));
vi.mock('$lib/services/publish-service.js', () => ({ publishEvent: vi.fn() }));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getRelayListLookupRelays: () => state.lookup,
  getWriteRelays: async () => state.write
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({ eventStore: { add: vi.fn() } }));

const { createConversationStore, createRelaySync } = await import(
  '../history/conversation-store.svelte.js'
);

function fakeStorage() {
  /** @type {Map<string, string>} */
  const data = new Map();
  return {
    data,
    setItem: vi.fn((/** @type {string} */ k, /** @type {string} */ v) => void data.set(k, v)),
    getItem: (/** @type {string} */ k) => data.get(k) ?? null,
    removeItem: (/** @type {string} */ k) => void data.delete(k)
  };
}
/** @param {string} text @returns {any[]} */
const turns = (text) => [
  { role: 'user', text, tier: 1 },
  { role: 'assistant', text: 'Antwort', tier: 1, items: [] }
];
const PK = 'a'.repeat(64);

describe('createConversationStore', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces two records into one write and one save', async () => {
    const storage = fakeStorage();
    const sync = { save: vi.fn(async () => {}), list: vi.fn(), remove: vi.fn() };
    const s = createConversationStore({ scope: PK, storage: /** @type {any} */ (storage), sync });
    s.record(turns('erste'));
    vi.advanceTimersByTime(500);
    s.record(turns('zweite'));
    vi.advanceTimersByTime(1000);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(sync.save).toHaveBeenCalledTimes(1);
    expect(/** @type {any} */ (sync.save.mock.calls[0])[0].messages[0].content).toBe('zweite');
    expect(s.list).toHaveLength(1);
    expect(s.list[0].title).toBe('erste');
  });

  it('a conversation without a user turn (an import) is titled by its first turn', () => {
    const s = createConversationStore({ scope: PK, storage: /** @type {any} */ (fakeStorage()) });
    s.record([{ role: 'assistant', text: '2 Termine aus plan.xlsx veröffentlicht.', tier: 1 }]);
    expect(s.current?.title).toBe('2 Termine aus plan.xlsx veröffentlicht.');
  });

  it('record(turns, { id }) names a new record only', () => {
    const s = createConversationStore({ scope: PK, storage: /** @type {any} */ (fakeStorage()) });
    s.record(turns('eins'), { id: 'local-1' });
    s.record(turns('zwei'), { id: 'other' });
    expect(s.current?.id).toBe('local-1');
  });

  it('record(turns, { task }) keeps the task; a later record(turns) does not drop it', async () => {
    const storage = fakeStorage();
    const s = createConversationStore({ scope: PK, storage: /** @type {any} */ (storage) });
    s.record(turns('Unterrichtsreihe'), { task: 'lesson' });
    s.record(turns('weiter'));
    expect(s.current?.task).toBe('lesson');
    vi.advanceTimersByTime(1000);
    const id = /** @type {string} */ (s.current?.id);
    s.startNew();
    expect((await s.open(id)).task).toBe('lesson');
  });

  it('record(turns, { task, lesson, materials }) persists all three in the local copy', async () => {
    const storage = fakeStorage();
    const s = createConversationStore({ scope: PK, storage: /** @type {any} */ (storage) });
    const lesson = {
      phase: 4,
      frame: {},
      competences: [],
      didactics: {},
      plan: [],
      parts: { lessons: [] }
    };
    const materials = [{ name: 'a.pdf', text: 'Text' }];
    s.record(turns('Unterrichtsreihe'), { task: 'lesson', lesson, materials });
    vi.advanceTimersByTime(1000);
    const id = /** @type {string} */ (s.current?.id);
    s.startNew();
    const back = await s.open(id);
    expect(back.lesson).toEqual(lesson);
    expect(back.materials).toEqual(materials);
  });

  it('coalesces saves requested while one is in flight; latest wins', async () => {
    /** @type {Array<() => void>} */
    const resolvers = [];
    const save = vi.fn(() => new Promise((r) => resolvers.push(() => r(undefined))));
    const s = createConversationStore({
      scope: PK,
      storage: /** @type {any} */ (fakeStorage()),
      sync: { save, list: vi.fn(), remove: vi.fn() }
    });
    s.record(turns('eins'));
    vi.advanceTimersByTime(1000);
    s.record(turns('zwei'));
    vi.advanceTimersByTime(1000);
    s.record(turns('drei'));
    vi.advanceTimersByTime(1000);
    expect(save).toHaveBeenCalledTimes(1);
    resolvers[0]();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(/** @type {any} */ (save.mock.calls[1])[0].messages[0].content).toBe('drei');
    resolvers[1]();
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('open returns the stored conversation; remove drops it and calls sync.remove', async () => {
    const storage = fakeStorage();
    const sync = { save: vi.fn(async () => {}), list: vi.fn(), remove: vi.fn(async () => {}) };
    const s = createConversationStore({ scope: PK, storage: /** @type {any} */ (storage), sync });
    s.record(turns('hallo'));
    vi.advanceTimersByTime(1000);
    const id = s.list[0].id;
    s.startNew();
    expect(s.current).toBeNull();
    const conv = await s.open(id);
    expect(conv.turns.map((t) => t.text)).toEqual(['hallo', 'Antwort']);
    expect(s.current?.id).toBe(id);
    await s.remove(id);
    expect(s.list).toHaveLength(0);
    expect(s.current).toBeNull();
    expect(sync.remove).toHaveBeenCalledWith(id);
    // a fresh store on the same storage sees nothing either
    expect(
      createConversationStore({ scope: PK, storage: /** @type {any} */ (storage) }).list
    ).toEqual([]);
  });

  it("scope 'anon' writes sessionStorage only and never syncs", () => {
    const local = fakeStorage();
    const session = fakeStorage();
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', session);
    const sync = { save: vi.fn(), list: vi.fn(), remove: vi.fn() };
    const s = createConversationStore({ scope: 'anon', sync });
    s.record(turns('anonym'));
    vi.advanceTimersByTime(1000);
    expect(session.data.has('termi.conversations.anon')).toBe(true);
    expect(local.setItem).not.toHaveBeenCalled();
    expect(sync.save).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('a quota error drops the oldest conversation and retries once', () => {
    const storage = fakeStorage();
    const s = createConversationStore({ scope: PK, storage: /** @type {any} */ (storage) });
    s.record(turns('alt'));
    vi.advanceTimersByTime(1000);
    s.startNew();
    vi.advanceTimersByTime(10);
    storage.setItem.mockImplementationOnce(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    s.record(turns('neu'));
    vi.advanceTimersByTime(1000);
    expect(storage.setItem).toHaveBeenCalledTimes(3);
    const saved = JSON.parse(/** @type {string} */ (storage.data.get('termi.conversations.' + PK)));
    expect(saved.map((/** @type {any} */ c) => c.title)).toEqual(['neu']);
  });

  it('the local cap of 50 never drops drafts and does not count them; a meta carries the summary', async () => {
    const storage = fakeStorage();
    const all = Array.from({ length: 55 }, (_, i) => ({
      id: 'c' + i,
      title: 'c' + i,
      createdAt: i,
      updatedAt: 100 + i,
      messages: [],
      ...(i < 3 ? { task: 'lesson', lesson: { phase: 2, frame: { topic: 'Bruch' } } } : {})
    }));
    storage.data.set('termi.conversations.' + PK, JSON.stringify(all));
    const sync = {
      save: vi.fn(),
      remove: vi.fn(),
      list: async () => ({ conversations: [], tombstones: [] })
    };
    const s = createConversationStore({ scope: PK, storage: /** @type {any} */ (storage), sync });
    await s.refresh();
    expect(s.list).toHaveLength(53);
    expect(s.list.find((c) => c.id === 'c0')?.draft).toMatchObject({ kind: 'series' });
    expect(s.list.some((c) => c.id === 'c3')).toBe(false); // the 2 oldest non-drafts dropped
    expect(s.list.some((c) => c.id === 'c4')).toBe(false);
    expect(s.list.some((c) => c.id === 'c5')).toBe(true);
  });

  it('dispose flushes the pending save to local storage only, never to a relay', () => {
    const storage = fakeStorage();
    const sync = { save: vi.fn(), list: vi.fn(), remove: vi.fn() };
    const s = createConversationStore({ scope: PK, storage: /** @type {any} */ (storage), sync });
    s.record(turns('x'));
    s.dispose();
    vi.advanceTimersByTime(1000);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(/** @type {string} */ (storage.data.get('termi.conversations.' + PK)));
    expect(saved.map((/** @type {any} */ c) => c.title)).toEqual(['x']);
    expect(sync.save).not.toHaveBeenCalled();
  });

  it('dispose mid-flight: the running save finishes, the queued one is dropped', async () => {
    /** @type {Array<() => void>} */
    const resolvers = [];
    const save = vi.fn(() => new Promise((r) => resolvers.push(() => r(undefined))));
    const s = createConversationStore({
      scope: PK,
      storage: /** @type {any} */ (fakeStorage()),
      sync: { save, list: vi.fn(), remove: vi.fn() }
    });
    s.record(turns('eins'));
    vi.advanceTimersByTime(1000);
    s.record(turns('zwei'));
    vi.advanceTimersByTime(1000); // queued behind the running save
    s.record(turns('drei')); // still debouncing
    s.dispose();
    resolvers[0]();
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  /** @type {any[]} */
  const listCalls = [];
  /** @param {any[]} local @param {any} listing */
  function storeWith(local, listing) {
    const storage = fakeStorage();
    storage.data.set('termi.conversations.' + PK, JSON.stringify(local));
    const sync = {
      save: vi.fn(),
      remove: vi.fn(async () => {}),
      list: vi.fn(async (/** @type {any} */ known) => (listCalls.push(known), listing))
    };
    return createConversationStore({ scope: PK, storage: /** @type {any} */ (storage), sync });
  }
  /** @param {string} id @param {string} title @param {number} updatedAt */
  const conv = (id, title, updatedAt) => ({ id, title, createdAt: 1, updatedAt, messages: [] });

  it('refresh merges relay copies by updatedAt', async () => {
    vi.useRealTimers();
    const s = storeWith([conv('a', 'lokal alt', 5), conv('b', 'lokal neu', 9)], {
      conversations: [
        conv('a', 'relay neu', 7),
        conv('b', 'relay alt', 3),
        conv('c', 'nur relay', 8)
      ],
      tombstones: []
    });
    expect(s.list.map((c) => c.title)).toEqual(['lokal neu', 'lokal alt']);
    await s.refresh();
    expect(s.list.map((c) => c.title)).toEqual(['lokal neu', 'nur relay', 'relay neu']);
    expect((await s.open('c')).title).toBe('nur relay');
  });

  it("refresh hands the sync each local copy's syncedAt (records not newer stay encrypted)", async () => {
    vi.useRealTimers();
    const s = storeWith([{ ...conv('a', 'lokal', 5000), syncedAt: 5 }, conv('b', 'alt', 1)], {
      conversations: [],
      tombstones: []
    });
    await s.refresh();
    // b: an older local copy without a stamp is decrypted once
    expect(listCalls.at(-1)).toEqual(new Map([['a', 5]]));
  });

  it('a tombstone from another device prunes the local copy; a newer local edit survives', async () => {
    vi.useRealTimers();
    const s = storeWith([conv('gone', 'alt', 1_000_000), conv('kept', 'neu', 3_000_000)], {
      conversations: [],
      tombstones: [
        { id: 'gone', created_at: 2000 },
        { id: 'kept', created_at: 2000 }
      ]
    });
    await s.refresh();
    expect(s.list.map((c) => c.id)).toEqual(['kept']);
  });

  it('a relay listing that started before remove() does not bring the conversation back', async () => {
    vi.useRealTimers();
    /** @type {(v: any) => void} */
    let answer = () => {};
    const storage = fakeStorage();
    storage.data.set('termi.conversations.' + PK, JSON.stringify([conv('x', 'x', 5)]));
    const sync = {
      save: vi.fn(),
      remove: vi.fn(async () => {}),
      list: vi.fn(() => new Promise((r) => (answer = r)))
    };
    const s = createConversationStore({ scope: PK, storage: /** @type {any} */ (storage), sync });
    const refreshing = s.refresh();
    await s.remove('x');
    answer({ conversations: [conv('x', 'x', 5)], tombstones: [] });
    await refreshing;
    expect(s.list).toEqual([]);
  });
});

describe('createRelaySync', () => {
  function signer() {
    return {
      signEvent: vi.fn(async (/** @type {any} */ d) => ({
        ...d,
        pubkey: PK,
        id: 'id' + Math.random()
      })),
      nip44: {
        encrypt: vi.fn(
          async (/** @type {string} */ _pk, /** @type {string} */ t) =>
            'enc:' + btoa(encodeURIComponent(t))
        ),
        decrypt: vi.fn(async (/** @type {string} */ _pk, /** @type {string} */ c) =>
          decodeURIComponent(atob(c.slice(4)))
        )
      }
    };
  }
  const content = (/** @type {string} */ id) => ({
    id,
    title: id,
    createdAt: 1,
    updatedAt: 2,
    messages: [{ id: id + '-0', role: /** @type {const} */ ('user'), content: 'q' }]
  });
  /** @param {ReturnType<typeof signer>} s @param {string} id @param {number} created_at */
  const convEvent = async (s, id, created_at, extra = {}) => ({
    id: 'ev-' + id + '-' + created_at,
    kind: 30078,
    pubkey: PK,
    created_at,
    tags: [['d', 'edufeed.chat.conv.' + id]],
    content: await s.nip44.encrypt(PK, JSON.stringify({ ...content(id), ...extra }))
  });

  it('save publishes an encrypted kind 30078 with the chat-bot d-tag; created_at increases', async () => {
    const publish = vi.fn(async () => ({ success: true }));
    const eventStore = { add: vi.fn() };
    const sync = createRelaySync({ signer: signer(), pubkey: PK, publish, eventStore });
    await sync.save(content('c1'));
    await sync.save(content('c1'));
    const [first, second] = publish.mock.calls.map((/** @type {any} */ c) => c);
    expect(first[0].kind).toBe(30078);
    expect(first[0].tags).toEqual([['d', 'edufeed.chat.conv.c1']]);
    expect(() => JSON.parse(first[0].content)).toThrow();
    expect(first[2]).toEqual({}); // write relays only, never lookup/indexer relays
    expect(second[0].created_at).toBeGreaterThan(first[0].created_at);
    expect(eventStore.add).toHaveBeenCalledTimes(2);
  });

  it('save refuses to publish when the signer hands back plaintext', async () => {
    const s = signer();
    s.nip44.encrypt.mockImplementationOnce(async (_pk, t) => t);
    const publish = vi.fn(async () => ({ success: true }));
    const sync = createRelaySync({ signer: s, pubkey: PK, publish, eventStore: { add: vi.fn() } });
    await expect(sync.save(content('c1'))).rejects.toThrow();
    expect(publish).not.toHaveBeenCalled();
  });

  it('list ignores other d-tags, reports tombstones and decrypts at most 20', async () => {
    const s = signer();
    /** @type {any[]} */
    const events = [];
    for (let i = 0; i < 25; i++) events.push(await convEvent(s, 'k' + i, 100 + i));
    events.push(
      {
        id: 'r',
        kind: 30078,
        pubkey: PK,
        created_at: 500,
        tags: [['d', 'rail-layout']],
        content: 'x'
      },
      {
        id: 't',
        kind: 30078,
        pubkey: PK,
        created_at: 501,
        tags: [['d', 'edufeed.chat.conv.k24']],
        content: ''
      }
    );
    s.nip44.decrypt.mockClear();
    const fetch = vi.fn(() => of(...events));
    const sync = createRelaySync({ signer: s, pubkey: PK, fetch, eventStore: { add: vi.fn() } });
    const { conversations, tombstones } = await sync.list();
    expect(fetch).toHaveBeenCalledWith(['wss://write.test'], {
      kinds: [30078],
      authors: [PK]
    });
    expect(s.nip44.decrypt).toHaveBeenCalledTimes(24);
    expect(conversations).toHaveLength(20);
    expect(conversations[0].id).toBe('k23'); // k24 is tombstoned, newest first
    expect(tombstones).toEqual([{ id: 'k24', created_at: 501 }]);
  });

  it('list keeps drafts beyond the newest 20 and does not count them', async () => {
    const s = signer();
    /** @type {any[]} */
    const events = [];
    for (let i = 0; i < 25; i++) {
      const draft = i < 3 ? { lesson: { phase: 2 } } : {};
      events.push(await convEvent(s, 'k' + i, 100 + i, draft));
    }
    const fetch = vi.fn(() => of(...events));
    const sync = createRelaySync({ signer: s, pubkey: PK, fetch, eventStore: { add: vi.fn() } });
    const { conversations } = await sync.list();
    const ids = conversations.map((c) => c.id);
    expect(ids).toHaveLength(23);
    expect(ids).toEqual(expect.arrayContaining(['k0', 'k1', 'k2', 'k24', 'k5']));
    expect(ids).not.toContain('k3');
  });

  it('decrypts each event once, misses one at a time', async () => {
    const s = signer();
    const events = [await convEvent(s, 'a', 100), await convEvent(s, 'b', 101)];
    s.nip44.decrypt.mockClear();
    const sync = createRelaySync({
      signer: s,
      pubkey: PK,
      fetch: () => of(...events),
      eventStore: { add: vi.fn() }
    });
    await sync.list();
    expect(s.nip44.decrypt).toHaveBeenCalledTimes(2);
    s.nip44.decrypt.mockClear();
    await sync.list();
    expect(s.nip44.decrypt).not.toHaveBeenCalled();

    events.push(await convEvent(s, 'c', 102), await convEvent(s, 'd', 103));
    let running = 0;
    let maxRunning = 0;
    const realDecrypt = /** @type {any} */ (s.nip44.decrypt.getMockImplementation());
    s.nip44.decrypt.mockImplementation(async (pk, c) => {
      maxRunning = Math.max(maxRunning, ++running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return realDecrypt(pk, c);
    });
    const { conversations } = await sync.list();
    expect(s.nip44.decrypt).toHaveBeenCalledTimes(2);
    expect(maxRunning).toBe(1);
    expect(conversations.map((c) => c.id)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('a record published from here (at t+1.2 s) is not decrypted again after a reload; a newer remote one is', async () => {
    vi.useFakeTimers({ now: 1_700_000_000_500 });
    try {
      const s = signer();
      const storage = fakeStorage();
      /** @type {any[]} */
      const events = [];
      const deps = {
        signer: s,
        pubkey: PK,
        publish: async (/** @type {any} */ e) => (events.push(e), { success: true }),
        fetch: () => of(...events),
        eventStore: { add: vi.fn(), getReplaceable: () => undefined }
      };
      const open = () =>
        createConversationStore({
          scope: PK,
          storage: /** @type {any} */ (storage),
          sync: createRelaySync(deps)
        });
      const first = open();
      first.record(turns('eins')); // updatedAt = t
      await vi.advanceTimersByTimeAsync(1200); // signed after the debounce: created_at > t
      expect(events).toHaveLength(1);
      expect(events[0].created_at * 1000).toBeGreaterThan(first.list[0].updatedAt);
      s.nip44.decrypt.mockClear();
      // the next page load: a fresh sync, the same local copy
      await open().refresh();
      expect(s.nip44.decrypt).not.toHaveBeenCalled();
      // another device saved it later: that one is decrypted
      const id = first.list[0].id;
      events.push(
        await convEvent(s, id, events[0].created_at + 60, { updatedAt: 1_800_000_000_000 })
      );
      s.nip44.decrypt.mockClear();
      await open().refresh();
      expect(s.nip44.decrypt).toHaveBeenCalledTimes(1);
      s.nip44.decrypt.mockClear();
      const later = open();
      await later.refresh();
      expect(s.nip44.decrypt).not.toHaveBeenCalled();
      // the stamp is local only: a re-saved record never carries it
      await later.open(id);
      later.record(turns('zwei'));
      await vi.advanceTimersByTimeAsync(1200);
      expect(JSON.parse(await s.nip44.decrypt(PK, events.at(-1).content))).not.toHaveProperty(
        'syncedAt'
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('remove publishes an empty tombstone and deletes it on the write relays only', async () => {
    const publish = vi.fn(async () => ({ success: true }));
    const deleteEvent = vi.fn(async () => ({ success: true }));
    const s = signer();
    const sync = createRelaySync({
      signer: s,
      pubkey: PK,
      publish,
      deleteEvent,
      eventStore: { add: vi.fn() }
    });
    await sync.remove('c9');
    const tomb = /** @type {any} */ (publish.mock.calls[0])[0];
    expect(tomb.content).toBe('');
    expect(tomb.tags).toEqual([['d', 'edufeed.chat.conv.c9']]);
    expect(deleteEvent).toHaveBeenCalledWith(tomb, { pubkey: PK, signer: s });
  });
});
