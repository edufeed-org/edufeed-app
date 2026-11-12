/**
 * Mute list store (NIP-51 kind 10000).
 *
 * Loads the active user's mute list on login and exposes the muted pubkeys as
 * a reactive set. DM list, DM requests, and inbox notifications all consult
 * it; muting goes through applesauce's MuteUser action so the list stays in
 * sync across Nostr clients.
 *
 * Both halves of the list count: the public tags, and the NIP-51 private
 * (encrypted) entries other clients such as Damus or Amethyst write — those
 * are unlocked with the account's signer (nip44, or nip04 for the legacy
 * `?iv=` payloads) on every new version of the event. Edufeed writes new
 * entries privately (nip44), so who someone blocks is not public. On top of the user's words sit the instance-wide
 * muted words from /api/config, which the user can switch off in Settings.
 */
import { runtimeConfig } from '$lib/stores/config.svelte.js';
import { getMutedThings, isHiddenMutesUnlocked } from 'applesauce-common/helpers/mute';
import { unlockHiddenTags, setHiddenTagsCache } from 'applesauce-core/helpers/hidden-tags';
import { appSettings } from '$lib/stores/app-settings.svelte.js';
import { eventStore, pool } from '$lib/stores/nostr-infrastructure.svelte';
import { normalizeURL } from 'applesauce-core/helpers';
import { addressLoader } from '$lib/loaders/base.js';
import { getRelayListLookupRelays, getWriteRelays } from '$lib/services/relay-service.svelte.js';

const MUTE_LIST_KIND = 10000;

/** @type {Set<string>} */
let mutedPubkeys = $state.raw(new Set());

/** The user's own muted words (NIP-51 public `word` tags), lowercase. @type {Set<string>} */
let mutedWords = $state.raw(new Set());

/**
 * What the filters actually match against: the instance-wide muted words
 * (/api/config `moderation.mutedWords`, e.g. a known spam campaign) plus the
 * user's own. Users cannot unmute the instance-wide entries — they are the
 * operator's call — and the dashboard's word editor keeps showing only the
 * user's list, read straight off the kind 10000.
 */
const effectiveMutedWords = $derived.by(() => {
  const instance = appSettings.instanceMutedWordsEnabled
    ? (runtimeConfig.moderation?.mutedWords ?? [])
    : [];
  if (instance.length === 0) return mutedWords;
  return new Set([...instance.map((w) => w.toLowerCase()), ...mutedWords]);
});

/** @type {string | null} */
let activePubkey = null;

/** Decrypting signer of the active account, or null for readonly sessions. @type {any} */
let activeSigner = null;

/** Event ids whose private entries were already tried — one signer prompt per version. @type {Set<string>} */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never rendered
const unlockAttempted = new Set();

/** @type {{ unsubscribe: () => void }[]} */
let subscriptions = [];

/**
 * Guard against the local-miss overwrite race (see the kind-30000 follow-set
 * wipe incident): applesauce's MuteUser waits only 1s for an existing list
 * before creating a fresh one, so a "block" click right after login could
 * replace a remote mute list that simply hadn't been fetched yet. Mutations
 * await this settle window: it resolves as soon as a kind 10000 lands in the
 * store, or after the relay fetch has had a fair chance.
 * @type {Promise<void>}
 */
let initialFetchSettled = Promise.resolve();
const INITIAL_FETCH_SETTLE_MS = 5000;

/** Reactive getter — read inside $derived/$effect for updates. */
export function getMutedPubkeys() {
  return mutedPubkeys;
}

/** The user's own muted words (public + unlocked private), without the instance-wide ones. */
export function getOwnMutedWords() {
  return mutedWords;
}

/** Reactive getter for muted words (lowercase): instance-wide + the user's own. */
export function getMutedWords() {
  return effectiveMutedWords;
}

/**
 * @param {string} pubkey
 * @returns {boolean}
 */
export function isMuted(pubkey) {
  return mutedPubkeys.has(pubkey);
}

/**
 * Load the user's kind 10000 and keep the muted set updated.
 * Called on login from accounts.svelte.js.
 * @param {string} pubkey
 * @param {any} [signer] decrypts the private entries; omit for readonly accounts
 */
export function initializeMuteList(pubkey, signer = null) {
  cleanupMuteList();
  activePubkey = pubkey;
  activeSigner = signer;

  /** @type {() => void} */
  let settle = () => {};
  initialFetchSettled = new Promise((resolve) => {
    settle = resolve;
  });
  const settleTimer = setTimeout(settle, INITIAL_FETCH_SETTLE_MS);
  subscriptions.push({ unsubscribe: () => clearTimeout(settleTimer) });

  // Fetch the list from the indexers plus the user's own outbox (a mute list
  // may only ever have been published to personal write relays).
  const lookupRelays = getRelayListLookupRelays();
  if (lookupRelays.length > 0) {
    subscriptions.push(
      addressLoader({ kind: MUTE_LIST_KIND, pubkey, relays: lookupRelays }).subscribe()
    );
  }
  getWriteRelays(pubkey).then((writeRelays) => {
    if (activePubkey !== pubkey) return; // session switched while awaiting
    if (writeRelays.length > 0) {
      subscriptions.push(
        addressLoader({ kind: MUTE_LIST_KIND, pubkey, relays: writeRelays }).subscribe()
      );
    }
  });

  // React to the replaceable in the EventStore (covers optimistic writes from
  // the MuteUser action as well as relay fetches).
  subscriptions.push(
    eventStore.replaceable(MUTE_LIST_KIND, pubkey).subscribe((event) => {
      if (event) settle();
      applyMuteList(event);
      if (event) unlockPrivateMutes(event);
    })
  );
}

/**
 * Publish the event's muted things (public + whatever private entries are
 * unlocked by now) into the reactive sets.
 * @param {any} event
 */
function applyMuteList(event) {
  const things = event ? getMutedThings(event) : undefined;

  mutedPubkeys = things ? things.pubkeys : new Set();

  mutedWords = new Set([...(things ? things.words : [])].map((w) => w.toLowerCase()));
}

/**
 * Decrypt the NIP-51 private entries once per event version and re-apply.
 * Silent on failure: a declined extension prompt or a signer without
 * decryption simply leaves the public half in force.
 * @param {any} event
 */
function unlockPrivateMutes(event) {
  // Plain shape: isHiddenMutesUnlocked's type predicate would otherwise
  // narrow `event` to never past the guard.
  const { id, content } = /** @type {{id: string, content: string}} */ (event);
  if (!activeSigner || !content || isHiddenMutesUnlocked(event)) return;
  if (unlockAttempted.has(id)) return;
  unlockAttempted.add(id);
  const pubkey = activePubkey;
  // Kind 10000 has no registered content encryption in applesauce; NIP-51
  // says nip44 today, nip04 (`?iv=` payloads) for lists written by older
  // clients — pick per event.
  const method = content.includes('?iv=') ? 'nip04' : 'nip44';
  unlockHiddenTags(event, activeSigner, method)
    .then(() => {
      if (activePubkey !== pubkey) return; // session switched while decrypting
      applyMuteList(event);
    })
    .catch((err) => {
      console.debug('[mute-list] private entries stay locked', err?.message ?? err);
    });
}

/** Reset on logout. */
export function cleanupMuteList() {
  for (const sub of subscriptions) sub.unsubscribe();
  subscriptions = [];
  activePubkey = null;
  activeSigner = null;
  unlockAttempted.clear();
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- $state.raw set, replaced wholesale
  mutedPubkeys = new Set();
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- $state.raw set, replaced wholesale
  mutedWords = new Set();
}

/** How long a mute edit waits for relays to confirm the user has no list yet. */
const CONFIRM_TIMEOUT_MS = 8000;

/**
 * The user's kind 10000 when the store has none: resolves to the newest copy
 * a relay holds, `null` when the list provably does not exist, and throws when
 * that is unknown. Writing a fresh list then would overwrite one we only failed
 * to see. Proof = an EOSE without the list from one of the user's own NIP-65
 * write relays (where the outbox model puts it), or from every indexer for a
 * user who has none.
 * @param {string} me
 * @returns {Promise<any>}
 */
async function fetchOwnMuteList(me) {
  const write = (await getWriteRelays(me)).map(normalizeURL);
  const lookup = getRelayListLookupRelays().map(normalizeURL);
  const relays = [...new Set([...write, ...lookup])];
  const mustConfirm = write.length > 0 ? 1 : lookup.length;
  const proving = new Set(write.length > 0 ? write : lookup);
  /** @type {any} */
  let newest = null;
  let confirmed = 0;
  let finished = 0;
  return new Promise((resolve, reject) => {
    /** @type {import('rxjs').Subscription | undefined} */
    let sub;
    let settled = false;
    /** @param {(() => void)} settle */
    const done = (settle) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sub?.unsubscribe();
      if (newest) eventStore.add(newest);
      settle();
    };
    const verdict = () =>
      done(() =>
        newest || confirmed >= mustConfirm
          ? resolve(newest)
          : reject(new Error('Could not load your mute list from any of your relays'))
      );
    const timer = setTimeout(verdict, CONFIRM_TIMEOUT_MS);
    sub = pool.req(relays, { kinds: [MUTE_LIST_KIND], authors: [me] }).subscribe({
      next: (/** @type {any} */ msg) => {
        if (msg.type === 'EVENT') {
          if (!newest || msg.event.created_at > newest.created_at) newest = msg.event;
          return;
        }
        if (msg.type === 'OPEN') return;
        finished++; // EOSE, CLOSED or ERROR: this relay has said all it will
        if (msg.type === 'EOSE' && proving.has(normalizeURL(msg.from))) confirmed++;
        if (confirmed >= mustConfirm || finished >= relays.length) verdict();
      },
      error: () => verdict(),
      complete: () => verdict()
    });
  });
}

/**
 * Action: add (`add`) or remove one `p`/`word` entry on the latest kind 10000.
 * New entries go into the NIP-51 private half (nip44); removal clears both
 * halves. Written by hand instead of applesauce's MuteUser & co, which encrypt
 * kind 10000 with nip04 and decrypt with that one method only. A private half
 * that cannot be read aborts the edit: publishing would drop it for good.
 * Signers without nip44 keep the old behaviour, a public entry. Without a list
 * in the store, the relays must first prove there is none (fetchOwnMuteList).
 * @param {string[]} tag e.g. ['p', pubkey] or ['word', 'spam']
 * @param {boolean} add
 */
export function EditMuteList(tag, add) {
  return async (
    /** @type {{signer: any, publish: (e: any) => Promise<void>}} */ { signer, publish }
  ) => {
    const me = await signer.getPublicKey();
    const latest = eventStore.getReplaceable(MUTE_LIST_KIND, me) ?? (await fetchOwnMuteList(me));
    // Words match case-insensitively: other clients may have stored "Spam".
    /** @param {string} v */
    const norm = (v) => (tag[0] === 'word' ? String(v).toLowerCase() : v);
    /** @param {string[]} t */
    const other = (t) => t[0] !== tag[0] || norm(t[1]) !== norm(tag[1]);
    let content = latest?.content ?? '';
    const tags = (latest?.tags ?? []).filter(other);
    /** @type {string[][] | null} */
    let hidden = null;
    if (signer.nip44) {
      hidden = [];
      if (content) {
        const method = content.includes('?iv=') ? 'nip04' : 'nip44';
        hidden = JSON.parse(await signer[method].decrypt(me, content));
        if (!Array.isArray(hidden)) throw new Error('Unreadable private mute entries');
      }
      hidden = hidden.filter(other);
      if (add) hidden.push(tag);
      content = hidden.length ? await signer.nip44.encrypt(me, JSON.stringify(hidden)) : '';
    } else if (add) {
      tags.push(tag);
    }
    const signed = await signer.signEvent({
      kind: MUTE_LIST_KIND,
      created_at: Math.max(Math.floor(Date.now() / 1000), (latest?.created_at ?? 0) + 1),
      tags,
      content
    });
    if (hidden) setHiddenTagsCache(signed, hidden);
    await publish(signed);
  };
}

/** @param {string[]} tag @param {boolean} add */
async function editMuteList(tag, add) {
  await initialFetchSettled;
  const { actionRunnerOptimistic } = await import('$lib/stores/action-runner.svelte.js');
  await actionRunnerOptimistic.run(EditMuteList, tag, add);
}

/**
 * Add a pubkey to the user's mute list (optimistic local update, outbox
 * publish via ActionRunner). Rejections surface the underlying error.
 * @param {string} pubkey
 */
export const muteUser = (pubkey) => editMuteList(['p', pubkey], true);

/**
 * Remove a pubkey from the user's mute list.
 * @param {string} pubkey
 */
export const unmuteUser = (pubkey) => editMuteList(['p', pubkey], false);

/**
 * Add a word to the user's mute list (stored lowercase; matched as a
 * case-insensitive substring against notification content).
 * @param {string} word
 */
export async function muteWord(word) {
  const normalized = word.trim().toLowerCase();
  if (normalized) await editMuteList(['word', normalized], true);
}

/**
 * Remove a word from the user's mute list (any capitalisation).
 * @param {string} word
 */
export async function unmuteWord(word) {
  const normalized = word.trim();
  if (normalized) await editMuteList(['word', normalized], false);
}
