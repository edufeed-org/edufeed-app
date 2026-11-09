// Termi conversation history: one store, a local copy and an optional relay sync.
// Spec: docs/superpowers/specs/2026-11-09-termi-ux-round-design.md §5.
/* eslint-disable svelte/prefer-svelte-reactivity -- Maps/Sets here are bookkeeping, never rendered; only list/current are state */

import { lastValueFrom, toArray } from 'rxjs';
import { finalizeDraft } from '$lib/helpers/event-factory.js';
import { nextCreatedAt } from '$lib/helpers/replaceableUpdates.js';
import { deleteEvent as deleteEventDefault } from '$lib/helpers/eventDeletion.js';
import { fetchEvents } from '$lib/loaders/base.js';
import { publishEvent } from '$lib/services/publish-service.js';
import { getWriteRelays } from '$lib/services/relay-service.svelte.js';
import { eventStore as sharedEventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { capContent, fromContent, generateTitle, toContent } from './conversation-codec.js';

/** @typedef {import('./conversation-codec.js').Conversation} Conversation */
/** @typedef {import('./conversation-codec.js').ConversationContent} ConversationContent */
/** @typedef {import('./conversation-codec.js').Turn} Turn */
/** @typedef {{ id: string, title: string, createdAt: number, updatedAt: number }} ConversationMeta */
/**
 * @typedef {{ save: (c: ConversationContent) => Promise<unknown>,
 *   list: () => Promise<RelayListing>, remove: (id: string) => Promise<unknown> }} RelaySync
 * @typedef {{ conversations: ConversationContent[],
 *   tombstones: Array<{ id: string, created_at: number }> }} RelayListing
 */

export const CONVERSATION_KIND = 30078;
export const CONVERSATION_D_PREFIX = 'edufeed.chat.conv.';
export const STORAGE_PREFIX = 'termi.conversations.';
const MAX_LOCAL = 50;
const MAX_RELAY = 20;

/** @param {ConversationContent} c @returns {ConversationMeta} */
const metaOf = (c) => ({
  id: c.id,
  title: c.title,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt
});

/**
 * NIP-44 self-encrypted kind 30078 copies, d = `edufeed.chat.conv.<id>` (the chat-bot's tag).
 * @param {{ signer: any, pubkey: string, publish?: (e: any, tagged: string[], opts: any) => Promise<any>,
 *   fetch?: (relays: string[], filter: any) => import('rxjs').Observable<any>,
 *   eventStore?: any, deleteEvent?: typeof deleteEventDefault }} deps
 * @returns {RelaySync}
 */
export function createRelaySync({
  signer,
  pubkey,
  publish = publishEvent,
  fetch = fetchEvents,
  eventStore = sharedEventStore,
  deleteEvent = deleteEventDefault
}) {
  /** Newest event this session saw per d-tag, so created_at stays monotonic. @type {Map<string, any>} */
  const last = new Map();
  /** Decrypted content per event id (null = undecryptable), so a refresh re-decrypts nothing. @type {Map<string, ConversationContent | null>} */
  const decrypted = new Map();

  /** @param {string} d @param {string} content */
  async function put(d, content) {
    const previous = last.get(d) ?? eventStore.getReplaceable?.(CONVERSATION_KIND, pubkey, d);
    const draft = await finalizeDraft({
      kind: CONVERSATION_KIND,
      created_at: nextCreatedAt(previous),
      tags: [['d', d]],
      content
    });
    const signed = await signer.signEvent(draft);
    last.set(d, signed);
    // the outbox only: private history has no business on indexer or lookup relays
    const result = await publish(signed, [], {});
    if (result?.success) eventStore.add(signed);
    return signed;
  }

  return {
    async save(content) {
      const ciphertext = await signer.nip44.encrypt(pubkey, JSON.stringify(content));
      // never publish plaintext, whatever the signer handed back
      if (!ciphertext || ciphertext.startsWith('{'))
        throw new Error('nip44 encrypt returned no ciphertext');
      return put(CONVERSATION_D_PREFIX + content.id, ciphertext);
    },
    async list() {
      const relays = await getWriteRelays(pubkey);
      const events = await lastValueFrom(
        fetch(relays, { kinds: [CONVERSATION_KIND], authors: [pubkey] }).pipe(toArray()),
        { defaultValue: [] }
      );
      /** @type {Map<string, any>} newest per d-tag — a tombstone hides older copies */
      const newest = new Map();
      for (const e of events) {
        const d = e.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1];
        if (e.pubkey !== pubkey || !d?.startsWith(CONVERSATION_D_PREFIX)) continue;
        if ((newest.get(d)?.created_at ?? -1) < e.created_at) newest.set(d, e);
      }
      for (const [d, e] of newest) {
        if ((last.get(d)?.created_at ?? -1) < e.created_at) last.set(d, e);
      }
      const tombstones = [...newest.entries()]
        .filter(([, e]) => !e.content)
        .map(([d, e]) => ({ id: d.slice(CONVERSATION_D_PREFIX.length), created_at: e.created_at }));
      const live = [...newest.values()]
        .filter((e) => e.content)
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, MAX_RELAY);
      /** @type {ConversationContent[]} */
      const conversations = [];
      // one at a time: a bunker answers sequentially anyway, and a burst can trip its rate limit
      for (const e of live) {
        if (!decrypted.has(e.id)) {
          let c = null;
          try {
            c = JSON.parse(await signer.nip44.decrypt(pubkey, e.content));
          } catch {
            /* undecryptable copy: skip it, never fall back to anything */
          }
          decrypted.set(
            e.id,
            c && typeof c.id === 'string' && Array.isArray(c.messages) ? c : null
          );
        }
        const c = decrypted.get(e.id);
        if (c) conversations.push(c);
      }
      return { conversations, tombstones };
    },
    async remove(id) {
      const tombstone = await put(CONVERSATION_D_PREFIX + id, '');
      return deleteEvent(tombstone, { pubkey, signer });
    }
  };
}

/**
 * @param {{ scope: string, storage?: Storage, sync?: RelaySync | null, debounceMs?: number }} opts
 *   scope = pubkey or 'anon'; anonymous history lives in sessionStorage only and never syncs.
 */
export function createConversationStore({ scope, storage, sync = null, debounceMs = 1000 }) {
  const anon = scope === 'anon';
  const store = storage ?? (anon ? globalThis.sessionStorage : globalThis.localStorage);
  const relay = anon ? null : sync;
  const key = STORAGE_PREFIX + scope;

  /** @type {ConversationMeta[]} */
  let list = $state.raw([]);
  /** @type {Conversation | null} */
  let current = $state.raw(null);

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  /** @type {ConversationContent | null} */
  let pending = null;
  /** @type {Promise<void> | null} */
  let inFlight = null;
  /** @type {ConversationContent | null} */
  let queued = null;
  let disposed = false;
  /** Removed this session: a relay listing that started before the removal must not bring them back. */
  const removed = new Set();

  /** @returns {ConversationContent[]} */
  function readLocal() {
    try {
      const parsed = JSON.parse(store?.getItem(key) ?? '[]');
      return Array.isArray(parsed) ? parsed.filter((c) => c && typeof c.id === 'string') : [];
    } catch {
      return [];
    }
  }

  /** Newest 50; a full quota drops the oldest and retries once. @param {ConversationContent[]} all */
  function writeLocal(all) {
    let items = all.toSorted((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_LOCAL);
    try {
      store?.setItem(key, JSON.stringify(items));
    } catch {
      items = items.slice(0, -1);
      try {
        store?.setItem(key, JSON.stringify(items));
      } catch (err) {
        console.warn('[termi] conversation history not saved locally:', err);
      }
    }
    list = items.map(metaOf);
  }

  /** @param {ConversationContent} c */
  function upsertLocal(c) {
    writeLocal([c, ...readLocal().filter((x) => x.id !== c.id)]);
  }

  /** One relay save in flight; a save requested meanwhile is coalesced, latest wins. @param {ConversationContent} c */
  function queueSave(c) {
    if (!relay || disposed) return;
    if (inFlight) {
      queued = c;
      return;
    }
    inFlight = relay
      .save(c)
      .then(
        () => {},
        (err) => console.warn('[termi] conversation relay save failed:', err)
      )
      .finally(() => {
        inFlight = null;
        const next = queued;
        queued = null;
        if (next) queueSave(next);
      });
  }

  function flush() {
    timer = undefined;
    const c = pending;
    pending = null;
    if (!c || disposed) return;
    upsertLocal(c);
    queueSave(c);
  }

  list = readLocal()
    .toSorted((a, b) => b.updatedAt - a.updatedAt)
    .map(metaOf);

  return {
    get list() {
      return list;
    },
    get current() {
      return current;
    },
    /** Local copy at once; relay copies merged in by `updatedAt` when they answer. */
    async refresh() {
      list = readLocal()
        .toSorted((a, b) => b.updatedAt - a.updatedAt)
        .map(metaOf);
      if (!relay) return;
      let remote;
      try {
        remote = await relay.list();
      } catch (err) {
        console.warn('[termi] conversation relay list failed:', err);
        return;
      }
      if (disposed) return;
      const byId = new Map(readLocal().map((c) => [c.id, c]));
      for (const c of remote.conversations) {
        if (removed.has(c.id)) continue;
        if ((byId.get(c.id)?.updatedAt ?? -1) < c.updatedAt) byId.set(c.id, c);
      }
      // removed on another device; a local edit made after the tombstone survives
      for (const t of remote.tombstones) {
        if ((byId.get(t.id)?.updatedAt ?? Infinity) < t.created_at * 1000) byId.delete(t.id);
      }
      writeLocal([...byId.values()]);
    },
    /** @param {string} id */
    async open(id) {
      const c = readLocal().find((x) => x.id === id);
      if (!c) throw new Error(`conversation ${id} not found`);
      current = fromContent(c);
      return current;
    },
    startNew() {
      current = null; // a pending debounced write still lands for the previous conversation
    },
    /** @param {Turn[]} turns the whole conversation so far */
    record(turns) {
      const now = Date.now();
      const title =
        current?.title ||
        generateTitle(turns.find((t) => t.role === 'user')?.text ?? turns[0]?.text ?? '');
      current = current
        ? { ...current, title, updatedAt: now, turns }
        : { id: crypto.randomUUID(), title, createdAt: now, updatedAt: now, turns };
      pending = capContent(toContent(current));
      clearTimeout(timer);
      timer = setTimeout(flush, debounceMs);
    },
    /** @param {string} id */
    async remove(id) {
      removed.add(id);
      if (pending?.id === id) {
        clearTimeout(timer);
        pending = null;
      }
      if (queued?.id === id) queued = null;
      // a save still running would otherwise land after the tombstone and resurrect it
      if (relay && inFlight) await inFlight;
      if (current?.id === id) current = null;
      writeLocal(readLocal().filter((c) => c.id !== id));
      await relay?.remove(id);
    },
    /** Cancel the pending save — called when the scope (active pubkey) changes. */
    dispose() {
      disposed = true;
      clearTimeout(timer);
      pending = null;
      queued = null;
    }
  };
}
