/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSecretKey, getPublicKey, nip19, nip44 } from 'nostr-tools';
import { of } from 'rxjs';

const h = vi.hoisted(() => ({
  /** @type {any} */ active: null,
  /** @type {Map<string, any>} */ store: new Map(),
  publishEvent: /** @type {any} */ (null),
  fetchEvents: /** @type {any} */ (null),
  createArticle: /** @type {any} */ (null)
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    get active() {
      return h.active;
    }
  }
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    getReplaceable: (/** @type {number} */ k, /** @type {string} */ pk, /** @type {string} */ d) =>
      h.store.get(`${k}:${pk}:${d}`),
    add: (/** @type {any} */ e) =>
      h.store.set(
        `${e.kind}:${e.pubkey}:${e.tags.find((/** @type {string[]} */ t) => t[0] === 'd')[1]}`,
        e
      )
  }
}));
vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: () => ({
    build: async (/** @type {any} */ t) => ({
      created_at: 1,
      ...t,
      tags: [...t.tags, ['client', 'Edufeed']]
    })
  })
}));
vi.mock('$lib/services/publish-service.js', () => ({
  publishEvent: (h.publishEvent = vi.fn())
}));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getWriteRelays: async () => ['wss://write.test']
}));
vi.mock('$lib/loaders/base.js', () => ({ fetchEvents: (h.fetchEvents = vi.fn()) }));
vi.mock('$lib/stores/article-actions.svelte.js', () => ({
  ARTICLE_KIND: 30023,
  buildArticleTags: (/** @type {any} */ f, /** @type {string} */ d) => [
    ['d', d],
    ['title', f.title],
    ['published_at', '1'],
    ['summary', f.summary]
  ],
  createArticle: (h.createArticle = vi.fn())
}));

const { saveLessonDraft, loadLessonDraft, previewAsPlaintext } = await import(
  '../lesson-drafts.svelte.js'
);

function account() {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const key = (/** @type {string} */ pk) => nip44.getConversationKey(sk, pk);
  return {
    pubkey,
    signer: {
      nip44: {
        encrypt: async (/** @type {string} */ pk, /** @type {string} */ t) =>
          nip44.encrypt(t, key(pk)),
        decrypt: async (/** @type {string} */ pk, /** @type {string} */ c) =>
          nip44.decrypt(c, key(pk))
      }
    },
    signEvent: vi.fn(async (/** @type {any} */ t) => ({
      ...t,
      pubkey,
      id: 'id-' + t.created_at,
      sig: 's'
    }))
  };
}
const part = /** @type {const} */ ({
  kind: 'lesson',
  n: 2,
  title: 'Stunde 2',
  text: '# Stunde 2\n\nWir lesen.'
});

beforeEach(() => {
  h.store.clear();
  h.active = account();
  h.publishEvent
    .mockReset()
    .mockResolvedValue({ success: true, acceptedRelays: ['wss://write.test/'] });
  h.fetchEvents.mockReset().mockReturnValue(of());
  h.createArticle.mockReset();
});

describe('saveLessonDraft', () => {
  it('publishes one kind 31234 wrap (no tagged users, no extra relays) and stores it; load decrypts it', async () => {
    const { naddr, dTag } = await saveLessonDraft({ conversationId: 'c1', part });
    expect(dTag).toBe('lesson-c1-lesson-2');
    expect(h.publishEvent).toHaveBeenCalledTimes(1);
    const [signed, tagged, opts] = h.publishEvent.mock.calls[0];
    expect(signed.kind).toBe(31234);
    expect(signed.tags).toEqual([
      ['d', 'lesson-c1-lesson-2'],
      ['k', '30023']
    ]);
    expect(signed.content).not.toContain('Wir lesen');
    expect(tagged).toEqual([]);
    expect(opts).toEqual({});
    const ptr = /** @type {any} */ (nip19.decode(naddr)).data;
    expect(ptr).toMatchObject({ kind: 31234, identifier: dTag, relays: ['wss://write.test/'] });
    expect(await loadLessonDraft(naddr)).toEqual({
      title: 'Stunde 2',
      content: part.text,
      dTag
    });
  });

  it('a document part (the ask answer) is a wrap of a 30023 under its own d-tag', async () => {
    const { dTag } = await saveLessonDraft({
      conversationId: 'c1',
      part: { kind: 'document', title: 'Text', text: '# Text\n\nInhalt.' }
    });
    expect(dTag).toBe('lesson-c1-document');
    expect(h.publishEvent.mock.calls[0][0].tags).toEqual([
      ['d', 'lesson-c1-document'],
      ['k', '30023']
    ]);
  });

  it('a re-save replaces the wrap with a later created_at', async () => {
    await saveLessonDraft({ conversationId: 'c1', part });
    await saveLessonDraft({ conversationId: 'c1', part });
    const [a, b] = h.publishEvent.mock.calls.map((/** @type {any[]} */ c) => c[0]);
    expect(b.tags[0]).toEqual(a.tags[0]);
    expect(b.created_at).toBeGreaterThan(a.created_at);
  });

  it('an account switch before the signature: account_switched, nothing signed or published', async () => {
    const alice = h.active;
    h.active = account(); // bob logged in while the save was queued
    await expect(
      saveLessonDraft({ conversationId: 'c1', part, pubkey: alice.pubkey })
    ).rejects.toThrow('account_switched');
    expect(h.active.signEvent).not.toHaveBeenCalled();
    expect(alice.signEvent).not.toHaveBeenCalled();
    expect(h.publishEvent).not.toHaveBeenCalled();
  });

  it('previewAsPlaintext passes a stable d through', async () => {
    h.createArticle.mockResolvedValue({ naddr: 'naddr1p' });
    await previewAsPlaintext({ ...part, kind: 'module' }, 'lesson-c1-module-preview');
    expect(h.createArticle.mock.calls[0][3]).toMatchObject({
      draft: true,
      dTag: 'lesson-c1-module-preview'
    });
  });

  it('a failed publish throws and stores nothing', async () => {
    h.publishEvent.mockResolvedValue({ success: false, acceptedRelays: [] });
    await expect(saveLessonDraft({ conversationId: 'c1', part })).rejects.toThrow();
    expect(h.store.size).toBe(0);
  });
});

describe('loadLessonDraft', () => {
  it('Review Focus 4: a signer without nip44 → null, nothing fetched', async () => {
    const { naddr } = await saveLessonDraft({ conversationId: 'c1', part });
    h.active = { ...h.active, signer: {} };
    expect(await loadLessonDraft(naddr)).toBeNull();
    expect(h.fetchEvents).not.toHaveBeenCalled();
  });

  it('not in the store: fetched from the write relays; a wrap of another key → null', async () => {
    const { naddr } = await saveLessonDraft({ conversationId: 'c1', part });
    const wrap = [...h.store.values()][0];
    h.store.clear();
    h.fetchEvents.mockReturnValue(of(wrap));
    expect((await loadLessonDraft(naddr))?.content).toBe(part.text);
    expect(h.fetchEvents.mock.calls[0][1]).toEqual({
      kinds: [31234],
      authors: [h.active.pubkey],
      '#d': ['lesson-c1-lesson-2']
    });
    h.active = account();
    expect(await loadLessonDraft(naddr)).toBeNull(); // someone else's naddr
    expect(await loadLessonDraft('not-an-naddr')).toBeNull();
  });
});

describe('previewAsPlaintext', () => {
  it('writes a kind 30024 draft of the part and returns its naddr', async () => {
    h.createArticle.mockResolvedValue({ naddr: 'naddr1preview' });
    expect(await previewAsPlaintext(part)).toBe('naddr1preview');
    expect(h.createArticle).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Stunde 2', content: part.text }),
      undefined,
      null,
      { draft: true, awaitPublish: true }
    );
  });
});
