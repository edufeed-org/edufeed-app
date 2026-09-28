/**
 * Reactive side of the unicode emoji data: the dataset for the current
 * Paraglide locale (loaded lazily on first read, so the picker and the `:`
 * autocomplete see an empty list until the ~60 KB chunk arrives), the
 * skin tone the user picked, remembered per device, and the recently used
 * emojis, remembered per device AND account (account switches must not mix
 * histories).
 */
import { getLocale } from '$lib/paraglide/runtime.js';
import { emojiDataLocale, loadEmojiData } from '$lib/helpers/emoji-data.js';
import { parseRecents, pushRecent } from '$lib/helpers/emoji-recents.js';
import { manager } from '$lib/stores/accounts.svelte';

const SKIN_TONE_KEY = 'emoji-skin-tone';

/** @type {import('$lib/helpers/emoji-data.js').EmojiEntry[]} */
let entries = $state.raw([]);
/** @type {string | undefined} plain let — bookkeeping, not UI state */
let loadedLocale;

/** Kick off (once per locale) the dataset load for the current locale. */
export function ensureEmojiData() {
  const locale = emojiDataLocale(getLocale());
  if (loadedLocale === locale) return;
  loadedLocale = locale;
  loadEmojiData(locale).then((data) => {
    if (loadedLocale === locale) entries = data;
  });
}

/** Reactive getter: the current locale's emojis, `[]` until loaded. */
export function getEmojiEntries() {
  ensureEmojiData();
  return entries;
}

function readStoredTone() {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(SKIN_TONE_KEY);
    const tone = raw === null ? 0 : Number(raw);
    return Number.isInteger(tone) && tone >= 0 && tone <= 5 ? tone : 0;
  } catch {
    return 0;
  }
}

let skinTone = $state(readStoredTone());

/** Reactive getter: chosen skin tone, 0 = none, 1…5 light…dark. */
export function getSkinTone() {
  return skinTone;
}

/** @param {number} tone */
export function setSkinTone(tone) {
  skinTone = tone;
  try {
    localStorage.setItem(SKIN_TONE_KEY, String(tone));
  } catch {
    /* private mode / blocked storage — the choice just does not persist */
  }
}

// ---- recently used ----------------------------------------------------

const RECENTS_KEY_PREFIX = 'emoji-recents:';

/** bumped on every recorded pick — the reactive dependency of getRecentEmojis */
let recentsVersion = $state(0);

function recentsStorageKey() {
  return RECENTS_KEY_PREFIX + (manager.active?.pubkey ?? 'signed-out');
}

/**
 * Reactive getter: the active account's recently used emojis, newest first.
 * Reads storage on each call (24 items at most) instead of caching, so it
 * stays a pure read inside $derived and follows account switches — pickers
 * mount fresh every time they open.
 * @returns {import('$lib/helpers/emoji-recents.js').RecentEmoji[]}
 */
export function getRecentEmojis() {
  void recentsVersion;
  try {
    return parseRecents(localStorage.getItem(recentsStorageKey()));
  } catch {
    return [];
  }
}

/**
 * Remember a pick. Unicode picks record the BASE emoji (skin tone is
 * re-applied when the row renders).
 * @param {import('$lib/helpers/emoji-recents.js').RecentEmoji} item
 */
export function recordEmojiUse(item) {
  try {
    const key = recentsStorageKey();
    const next = pushRecent(parseRecents(localStorage.getItem(key)), item);
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    /* private mode / blocked storage — the row just stays as it was */
  }
  recentsVersion++;
}
