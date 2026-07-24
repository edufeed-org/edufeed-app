# Concord Notifications & Read-State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Armada-style unread badges, mention tier, and foreground browser notifications for Concord private channels, with local-only per-device read-state.

**Architecture:** A central notifications service (`src/lib/concord/notifications.svelte.js`) fans out one rumor-timeline subscription per accessible channel across all Concord communities, folds them into a reactive summary map, persists read markers/levels in the existing per-account `kv` IndexedDB store, and dispatches foreground OS toasts. Badge components read derived getters only. Mention producers: replies gain a `p` tag via a send wrapper (needs the `applesauce-common-concord` alias), and an `@`-autocomplete inserts `nostr:npub…` which the existing content pipeline already turns into `p` tags.

**Tech Stack:** SvelteKit + Svelte 5 runes, applesauce-concord (pinned pre-release), rxjs, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-24-concord-notifications-design.md` — read it before starting any task.

## Global Constraints

- Feature flag: everything is inert when `runtimeConfig.concord?.enabled` is falsy (service never starts; getters return all-read defaults).
- Concord isolation: `applesauce-concord` / `applesauce-core-concord` / (new) `applesauce-common-concord` may only be imported under `src/lib/concord/` (lint-enforced). Components import concord **submodules directly**, never the `src/lib/concord/index.js` barrel.
- SSR: no top-level package imports in any `src/lib/concord/*.svelte.js` file a component imports. `notifications.svelte.js`, `active-channel.svelte.js` must import only sibling pure modules + app modules. Package access only via dynamic `import()` inside functions.
- Svelte 5: `$state.raw` for all rumor-derived maps/Sets (reassign whole, never mutate); plain `let` for subscriptions; read reactive deps before any early return in `$effect`.
- kv keys (exact, spec §1): `notif:read`, `notif:mention-read`, `notif:levels`, plus `notif:toasts-enabled`. JSON strings via `createConcordStorage`. Monotonic marker writes.
- Marker key format: `${communityId}/${channelId}`.
- Chat rumor kind is **9**. Mention = rumor has tag `['p', <myPubkey>]` and `pubkey !== myPubkey`. Never scan content text.
- Badges are binary (no counts): neutral dot for unread, accent `@` pill (`badge-secondary`) for mentions. Levels (`all`/`mentions`/`nothing`) gate **toasts only**, never badges.
- i18n: every user-facing string is a paraglide message added to BOTH `messages/en.json` and `messages/de.json` (key prefix `concord_notif_`). No hardcoded UI strings.
- Styling: DaisyUI semantic tokens only, no color literals.
- Commit format: `feat(concord): …` / `test(concord): …`, each commit ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Tests: run a targeted file with `pnpm vitest run <path>`; full suite `pnpm test` (expect pre-existing flakes documented in project memory: inbox/DM files under full parallel run, GlobalFAB exit).
- New dependency alias pinned EXACTLY: `applesauce-common-concord": "npm:applesauce-common@0.0.0-concord-20260714212055"` — must stay in lockstep with the other two concord pins.

---

### Task 1: Pure notification helpers

**Files:**
- Create: `src/lib/concord/notification-helpers.js`
- Test: `src/lib/__tests__/concord-notification-helpers.test.js`

**Interfaces:**
- Consumes: nothing (pure module, zero imports).
- Produces (used by Tasks 3, 5, 9):
  - `markerKey(communityId, channelId) → string`
  - `foldChannelSummary(rumors, myPubkey) → {latest:number, latestFromOthers:number, latestMention:number}`
  - `mergeMarker(markers, key, timestamp) → Record<string,number>` (returns the SAME object reference when nothing changed)
  - `summaryFlags(summary, marker) → {unread:boolean, mentioned:boolean}`
  - `rollupArea(channelSummaries, markers, communityId, mentionReadTs) → {unread:boolean, mentioned:boolean}`
  - `resolveLevel(levels, communityId, channelId) → 'all'|'mentions'|'nothing'`
  - `shouldToast(args) → boolean`
  - `pruneMarkers(markers, liveKeys) → Record<string,number>`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/concord-notification-helpers.test.js`:

```js
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  markerKey,
  foldChannelSummary,
  mergeMarker,
  summaryFlags,
  rollupArea,
  resolveLevel,
  shouldToast,
  pruneMarkers
} from '$lib/concord/notification-helpers.js';

const ME = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

/** Minimal kind-9 rumor. */
function rumor({ pubkey = OTHER, created_at, tags = [] }) {
  return { id: `${pubkey}-${created_at}`, kind: 9, pubkey, created_at, tags, content: 'x' };
}

describe('markerKey', () => {
  it('joins community and channel id with a slash', () => {
    expect(markerKey('cid', 'chid')).toBe('cid/chid');
  });
});

describe('foldChannelSummary', () => {
  it('returns zeros for an empty timeline', () => {
    expect(foldChannelSummary([], ME)).toEqual({
      latest: 0,
      latestFromOthers: 0,
      latestMention: 0
    });
  });

  it('tracks latest overall including own messages, but excludes own from latestFromOthers', () => {
    const rumors = [
      rumor({ pubkey: ME, created_at: 300 }),
      rumor({ pubkey: OTHER, created_at: 200 }),
      rumor({ pubkey: OTHER, created_at: 100 })
    ];
    expect(foldChannelSummary(rumors, ME)).toEqual({
      latest: 300,
      latestFromOthers: 200,
      latestMention: 0
    });
  });

  it('detects a mention only via an exact p-tag match from someone else', () => {
    const rumors = [
      // own message p-tagging self must NOT count as a mention
      rumor({ pubkey: ME, created_at: 400, tags: [['p', ME]] }),
      rumor({ pubkey: OTHER, created_at: 300, tags: [['p', ME]] }),
      rumor({ pubkey: OTHER, created_at: 200, tags: [['p', OTHER]] })
    ];
    expect(foldChannelSummary(rumors, ME).latestMention).toBe(300);
  });

  it('ignores rumors without created_at instead of producing NaN', () => {
    const summary = foldChannelSummary([{ pubkey: OTHER, tags: [] }], ME);
    expect(summary.latest).toBe(0);
  });
});

describe('mergeMarker', () => {
  it('raises a marker and returns a NEW object', () => {
    const markers = { 'c/x': 100 };
    const next = mergeMarker(markers, 'c/x', 200);
    expect(next['c/x']).toBe(200);
    expect(next).not.toBe(markers);
    expect(markers['c/x']).toBe(100); // input untouched
  });

  it('never rewinds (monotonic) and returns the SAME object when unchanged', () => {
    const markers = { 'c/x': 200 };
    expect(mergeMarker(markers, 'c/x', 100)).toBe(markers);
    expect(mergeMarker(markers, 'c/x', 200)).toBe(markers);
  });

  it('creates a missing key', () => {
    expect(mergeMarker({}, 'c/x', 50)).toEqual({ 'c/x': 50 });
  });
});

describe('summaryFlags', () => {
  it('is all-read for a missing summary', () => {
    expect(summaryFlags(undefined, 0)).toEqual({ unread: false, mentioned: false });
  });

  it('flags unread and mentioned against the marker', () => {
    const summary = { latest: 300, latestFromOthers: 300, latestMention: 250 };
    expect(summaryFlags(summary, 100)).toEqual({ unread: true, mentioned: true });
    expect(summaryFlags(summary, 250)).toEqual({ unread: true, mentioned: false });
    expect(summaryFlags(summary, 300)).toEqual({ unread: false, mentioned: false });
  });

  it('own messages alone never light unread', () => {
    const summary = { latest: 500, latestFromOthers: 0, latestMention: 0 };
    expect(summaryFlags(summary, 0)).toEqual({ unread: false, mentioned: false });
  });
});

describe('rollupArea', () => {
  const summaries = {
    ch1: { latest: 300, latestFromOthers: 300, latestMention: 0 },
    ch2: { latest: 200, latestFromOthers: 200, latestMention: 200 }
  };

  it('ORs unread across channels', () => {
    const markers = { 'cid/ch1': 300, 'cid/ch2': 100 };
    expect(rollupArea(summaries, markers, 'cid', 0)).toEqual({ unread: true, mentioned: true });
  });

  it('mention rollup is additionally gated by the community mention-read stamp', () => {
    const markers = { 'cid/ch1': 300, 'cid/ch2': 100 };
    // mentionReadTs at/after the mention suppresses the accent tier, unread stays
    expect(rollupArea(summaries, markers, 'cid', 200)).toEqual({ unread: true, mentioned: false });
  });

  it('is all-clear when every channel is read', () => {
    const markers = { 'cid/ch1': 300, 'cid/ch2': 200 };
    expect(rollupArea(summaries, markers, 'cid', 0)).toEqual({ unread: false, mentioned: false });
  });
});

describe('resolveLevel', () => {
  it('defaults to all and reads the stored level', () => {
    expect(resolveLevel({}, 'c', 'x')).toBe('all');
    expect(resolveLevel({ 'c/x': 'mentions' }, 'c', 'x')).toBe('mentions');
    expect(resolveLevel({ 'c/x': 'nothing' }, 'c', 'x')).toBe('nothing');
  });
});

describe('shouldToast', () => {
  const base = {
    createdAt: 1000,
    isMention: false,
    level: 'all',
    enabled: true,
    permissionGranted: true,
    tabVisible: false,
    isActiveChannel: false,
    marker: 0,
    startTime: 500,
    lastToastAt: 0,
    now: 100_000
  };

  it('fires for a fresh message with everything open', () => {
    expect(shouldToast(base)).toBe(true);
  });

  it('never fires when disabled or without permission', () => {
    expect(shouldToast({ ...base, enabled: false })).toBe(false);
    expect(shouldToast({ ...base, permissionGranted: false })).toBe(false);
  });

  it('respects the per-channel level', () => {
    expect(shouldToast({ ...base, level: 'nothing' })).toBe(false);
    expect(shouldToast({ ...base, level: 'mentions' })).toBe(false);
    expect(shouldToast({ ...base, level: 'mentions', isMention: true })).toBe(true);
  });

  it('suppresses the on-screen active channel but fires when the tab is hidden', () => {
    expect(shouldToast({ ...base, tabVisible: true, isActiveChannel: true })).toBe(false);
    expect(shouldToast({ ...base, tabVisible: false, isActiveChannel: true })).toBe(true);
    expect(shouldToast({ ...base, tabVisible: true, isActiveChannel: false })).toBe(true);
  });

  it('drops already-read and pre-start (cache replay) messages', () => {
    expect(shouldToast({ ...base, marker: 1000 })).toBe(false);
    expect(shouldToast({ ...base, createdAt: 400 })).toBe(false); // before startTime 500
  });

  it('throttles to one toast per channel per 30s', () => {
    expect(shouldToast({ ...base, lastToastAt: 100_000 - 10_000 })).toBe(false);
    expect(shouldToast({ ...base, lastToastAt: 100_000 - 31_000 })).toBe(true);
  });
});

describe('pruneMarkers', () => {
  it('drops markers for channels no longer live, keeps the rest', () => {
    const markers = { 'c/live': 1, 'c/gone': 2 };
    expect(pruneMarkers(markers, new Set(['c/live']))).toEqual({ 'c/live': 1 });
  });

  it('returns the same object when nothing is pruned', () => {
    const markers = { 'c/live': 1 };
    expect(pruneMarkers(markers, new Set(['c/live']))).toBe(markers);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/lib/__tests__/concord-notification-helpers.test.js`
Expected: FAIL — cannot resolve `$lib/concord/notification-helpers.js`.

- [ ] **Step 3: Implement `src/lib/concord/notification-helpers.js`**

```js
// Pure helpers for Concord unread/mention/toast state (spec: docs/superpowers/
// specs/2026-07-24-concord-notifications-design.md). Zero imports — safe for
// node-env unit tests and any SSR-adjacent call site. Everything protocol-ish
// here is client-local invention: no CORD spec defines read-state or mentions,
// so these shapes only need to satisfy this app.

/** @typedef {{latest: number, latestFromOthers: number, latestMention: number}} ChannelSummary */

/** Marker/level map key for one channel. @param {string} communityId @param {string} channelId @returns {string} */
export function markerKey(communityId, channelId) {
  return `${communityId}/${channelId}`;
}

/**
 * Fold a channel's kind-9 rumor timeline into the three timestamps unread
 * logic needs. Mentions follow Armada's convention exactly: a `p` tag equal
 * to the user's pubkey on someone ELSE's decrypted rumor — never content
 * scanning, and a self-authored self-p-tag never counts.
 * @param {Array<{pubkey?: string, created_at?: number, tags?: string[][]}>} rumors
 * @param {string} myPubkey
 * @returns {ChannelSummary}
 */
export function foldChannelSummary(rumors, myPubkey) {
  let latest = 0;
  let latestFromOthers = 0;
  let latestMention = 0;
  for (const rumor of rumors ?? []) {
    const at = typeof rumor?.created_at === 'number' ? rumor.created_at : 0;
    if (!at) continue;
    if (at > latest) latest = at;
    if (rumor.pubkey === myPubkey) continue;
    if (at > latestFromOthers) latestFromOthers = at;
    const mentionsMe = (rumor.tags ?? []).some((t) => t?.[0] === 'p' && t?.[1] === myPubkey);
    if (mentionsMe && at > latestMention) latestMention = at;
  }
  return { latest, latestFromOthers, latestMention };
}

/**
 * Monotonically raise one marker. Returns the SAME object when nothing
 * changed so callers can cheap-compare before persisting/reassigning state.
 * @param {Record<string, number>} markers
 * @param {string} key
 * @param {number} timestamp
 * @returns {Record<string, number>}
 */
export function mergeMarker(markers, key, timestamp) {
  if (timestamp <= (markers[key] ?? 0)) return markers;
  return { ...markers, [key]: timestamp };
}

/**
 * Per-channel badge flags against a read marker.
 * @param {ChannelSummary | undefined} summary
 * @param {number} marker
 * @returns {{unread: boolean, mentioned: boolean}}
 */
export function summaryFlags(summary, marker) {
  if (!summary) return { unread: false, mentioned: false };
  return {
    unread: summary.latestFromOthers > marker,
    mentioned: summary.latestMention > marker
  };
}

/**
 * OR-rollup for one community's area/tab badge. The mention tier is
 * additionally gated by the community-level mention-read stamp so a mention
 * inside a channel that later became inaccessible can't wedge the accent dot.
 * @param {Record<string, ChannelSummary>} channelSummaries channelId → summary
 * @param {Record<string, number>} markers
 * @param {string} communityId
 * @param {number} mentionReadTs
 * @returns {{unread: boolean, mentioned: boolean}}
 */
export function rollupArea(channelSummaries, markers, communityId, mentionReadTs) {
  let unread = false;
  let mentioned = false;
  for (const [channelId, summary] of Object.entries(channelSummaries ?? {})) {
    const marker = markers[markerKey(communityId, channelId)] ?? 0;
    const flags = summaryFlags(summary, marker);
    if (flags.unread) unread = true;
    if (flags.mentioned && summary.latestMention > mentionReadTs) mentioned = true;
    if (unread && mentioned) break;
  }
  return { unread, mentioned };
}

/**
 * Per-channel toast level; absent = 'all' (levels gate toasts ONLY, never badges).
 * @param {Record<string, string>} levels
 * @param {string} communityId
 * @param {string} channelId
 * @returns {'all'|'mentions'|'nothing'}
 */
export function resolveLevel(levels, communityId, channelId) {
  const level = levels[markerKey(communityId, channelId)];
  return level === 'mentions' || level === 'nothing' ? level : 'all';
}

/**
 * The complete OS-toast gate (spec §6), pure so every branch is unit-testable.
 * `startTime` is the service start in unix SECONDS (cache-replay guard);
 * `lastToastAt`/`now` are Date.now() MILLISECONDS (throttle).
 * @param {{createdAt: number, isMention: boolean, level: 'all'|'mentions'|'nothing',
 *   enabled: boolean, permissionGranted: boolean, tabVisible: boolean,
 *   isActiveChannel: boolean, marker: number, startTime: number,
 *   lastToastAt: number, now: number, throttleMs?: number}} args
 * @returns {boolean}
 */
export function shouldToast(args) {
  const throttleMs = args.throttleMs ?? 30_000;
  if (!args.enabled || !args.permissionGranted) return false;
  if (args.level === 'nothing') return false;
  if (args.level === 'mentions' && !args.isMention) return false;
  if (args.createdAt <= args.marker) return false;
  if (args.createdAt <= args.startTime) return false;
  if (args.tabVisible && args.isActiveChannel) return false;
  if (args.now - args.lastToastAt < throttleMs) return false;
  return true;
}

/**
 * Drop marker entries whose channel is gone (lazy cleanup on save). Returns
 * the same object when nothing was pruned.
 * @param {Record<string, number>} markers
 * @param {Set<string>} liveKeys
 * @returns {Record<string, number>}
 */
export function pruneMarkers(markers, liveKeys) {
  const keys = Object.keys(markers);
  const kept = keys.filter((k) => liveKeys.has(k));
  if (kept.length === keys.length) return markers;
  return Object.fromEntries(kept.map((k) => [k, markers[k]]));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/__tests__/concord-notification-helpers.test.js`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/lib/concord/notification-helpers.js src/lib/__tests__/concord-notification-helpers.test.js
git commit -m "feat(concord): pure notification helpers (fold/markers/levels/toast gate)"
```

---

### Task 2: Active-channel store

**Files:**
- Create: `src/lib/concord/active-channel.svelte.js`
- Test: `src/lib/__tests__/concord-active-channel.svelte.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Tasks 3, 5, 9):
  - `setActiveConcordChannel(communityId, channelId)`
  - `clearActiveConcordChannel()`
  - `getActiveConcordChannel() → {communityId: string, channelId: string} | null`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/concord-active-channel.svelte.test.js`:

```js
// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import {
  setActiveConcordChannel,
  clearActiveConcordChannel,
  getActiveConcordChannel
} from '$lib/concord/active-channel.svelte.js';

describe('active concord channel', () => {
  it('starts empty, tracks set/clear', () => {
    clearActiveConcordChannel();
    expect(getActiveConcordChannel()).toBeNull();
    setActiveConcordChannel('cid', 'chid');
    expect(getActiveConcordChannel()).toEqual({ communityId: 'cid', channelId: 'chid' });
    setActiveConcordChannel('cid', 'other');
    expect(getActiveConcordChannel()).toEqual({ communityId: 'cid', channelId: 'other' });
    clearActiveConcordChannel();
    expect(getActiveConcordChannel()).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/lib/__tests__/concord-active-channel.svelte.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/concord/active-channel.svelte.js`**

```js
// Which Concord channel is on screen right now. Component-local
// selectedChannelId (PrivateChannelsView) can't be read by the notifications
// service, so the view mirrors it here. "Being viewed" additionally requires
// document.visibilityState === 'visible' — that check lives with the callers
// (notifications.svelte.js), not here, so this module stays trivially pure.
// No package imports — SSR-safe for any chrome component chain.

let active = $state.raw(/** @type {{communityId: string, channelId: string} | null} */ (null));

/** @param {string} communityId @param {string} channelId */
export function setActiveConcordChannel(communityId, channelId) {
  active = { communityId, channelId };
}

export function clearActiveConcordChannel() {
  active = null;
}

/** @returns {{communityId: string, channelId: string} | null} */
export function getActiveConcordChannel() {
  return active;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/__tests__/concord-active-channel.svelte.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/concord/active-channel.svelte.js src/lib/__tests__/concord-active-channel.svelte.test.js
git commit -m "feat(concord): shared active-channel state for read/toast logic"
```

---

### Task 3: Notifications service (fan-out, folding, markers, getters)

**Files:**
- Create: `src/lib/concord/notifications.svelte.js`
- Test: `src/lib/__tests__/concord-notifications.svelte.test.js`

**Interfaces:**
- Consumes: Task 1 helpers, Task 2 active-channel, `deriveVisibleChannels` from `./community.svelte.js`, `ConcordStorage` shape from `storage.js` (`getItem`/`setItem`).
- Produces (used by Tasks 4, 5, 6, 9):
  - `startConcordNotifications({client, storage, pubkey}) → Promise<void>`
  - `stopConcordNotifications()`
  - `markChannelRead(communityId, channelId)`
  - `channelUnreadState(communityId, channelId) → {unread, mentioned}` (reactive — reads `$state.raw`)
  - `areaUnreadState(communityId) → {unread, mentioned}` (reactive)
  - `getChannelLevel(communityId, channelId) → 'all'|'mentions'|'nothing'`
  - `setChannelLevel(communityId, channelId, level) → Promise<void>`
  - `getToastsEnabled() → boolean` / `setToastsEnabled(enabled) → Promise<void>`
  - internal hook point `_onChannelRumors` is NOT exported; Task 9 adds the toast dispatcher inside this module.

**Design notes for the implementer:**
- This is a plain module-level service (no `$effect` — it runs outside component context). RxJS subscriptions are managed manually with a `generation` counter like `client.svelte.js` (simplified: `stop()` bumps generation; every async continuation re-checks).
- The community id of a `CommunityState` entry is `communityState.material.community_id` (see `unlinked-areas.js` `concordAreaDisplayName`).
- `timeline()` emits newest-first arrays (see ChannelChat.svelte:30-38).
- Markers must be loaded from storage BEFORE the first fan-out subscription so a reload never flashes all-unread.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/concord-notifications.svelte.test.js`:

```js
// @ts-nocheck
/* eslint-disable no-undef -- runes available in .svelte.test.js context */
/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BehaviorSubject, Subject } from 'rxjs';
import {
  startConcordNotifications,
  stopConcordNotifications,
  markChannelRead,
  channelUnreadState,
  areaUnreadState,
  getChannelLevel,
  setChannelLevel
} from '$lib/concord/notifications.svelte.js';
import { setActiveConcordChannel, clearActiveConcordChannel } from '$lib/concord/active-channel.svelte.js';

const ME = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const CID = 'c'.repeat(64);
const CH = 'd'.repeat(64);

function rumor({ pubkey = OTHER, created_at, tags = [] }) {
  return { id: `${pubkey}-${created_at}`, kind: 9, pubkey, created_at, tags, content: 'x' };
}

/** In-memory ConcordStorage. */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: vi.fn(async (k) => map.get(k) ?? null),
    setItem: vi.fn(async (k, v) => void map.set(k, v)),
    removeItem: vi.fn(async (k) => void map.delete(k))
  };
}

/** Fake ConcordClient with one community and one channel timeline. */
function fakeClient() {
  const timeline$ = new BehaviorSubject([]);
  const channels$ = new BehaviorSubject([{ channel_id: CH, name: 'general', private: false }]);
  const communities$ = new BehaviorSubject([
    { material: { community_id: CID, channels: [], name: 'Area' }, metadata: { name: 'Area' } }
  ]);
  const community = {
    material: { community_id: CID, channels: [], name: 'Area' },
    channels$,
    channelStore: vi.fn(() => ({ timeline: vi.fn(() => timeline$) }))
  };
  return {
    communities$,
    channels$,
    timeline$,
    getCommunity: vi.fn(() => community)
  };
}

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('concord notifications service', () => {
  beforeEach(() => {
    stopConcordNotifications();
    clearActiveConcordChannel();
  });

  it('flags unread for a new message from someone else, clears via markChannelRead', async () => {
    const client = fakeClient();
    const storage = fakeStorage();
    await startConcordNotifications({ client, storage, pubkey: ME });
    await flush();

    client.timeline$.next([rumor({ created_at: 100 })]);
    expect(channelUnreadState(CID, CH)).toEqual({ unread: true, mentioned: false });
    expect(areaUnreadState(CID)).toEqual({ unread: true, mentioned: false });

    markChannelRead(CID, CH);
    expect(channelUnreadState(CID, CH)).toEqual({ unread: false, mentioned: false });
    expect(areaUnreadState(CID)).toEqual({ unread: false, mentioned: false });
    // persisted
    await flush();
    expect(storage.setItem).toHaveBeenCalledWith('notif:read', expect.stringContaining(`${CID}/${CH}`));
  });

  it('own messages never light unread; p-tag mentions light the mention tier', async () => {
    const client = fakeClient();
    await startConcordNotifications({ client, storage: fakeStorage(), pubkey: ME });
    await flush();

    client.timeline$.next([rumor({ pubkey: ME, created_at: 100 })]);
    expect(channelUnreadState(CID, CH)).toEqual({ unread: false, mentioned: false });

    client.timeline$.next([
      rumor({ created_at: 200, tags: [['p', ME]] }),
      rumor({ pubkey: ME, created_at: 100 })
    ]);
    expect(channelUnreadState(CID, CH)).toEqual({ unread: true, mentioned: true });
    expect(areaUnreadState(CID).mentioned).toBe(true);
  });

  it('loads persisted markers before flagging (no unread flash after reload)', async () => {
    const client = fakeClient();
    const storage = fakeStorage({ 'notif:read': JSON.stringify({ [`${CID}/${CH}`]: 100 }) });
    await startConcordNotifications({ client, storage, pubkey: ME });
    await flush();

    client.timeline$.next([rumor({ created_at: 100 })]);
    expect(channelUnreadState(CID, CH)).toEqual({ unread: false, mentioned: false });
    client.timeline$.next([rumor({ created_at: 150 }), rumor({ created_at: 100 })]);
    expect(channelUnreadState(CID, CH).unread).toBe(true);
  });

  it('auto-marks the active visible channel as read on new rumors', async () => {
    const client = fakeClient();
    await startConcordNotifications({ client, storage: fakeStorage(), pubkey: ME });
    await flush();
    setActiveConcordChannel(CID, CH);
    // jsdom documents report visibilityState 'visible' by default
    client.timeline$.next([rumor({ created_at: 100 })]);
    expect(channelUnreadState(CID, CH).unread).toBe(false);
  });

  it('stores and resolves per-channel levels', async () => {
    const client = fakeClient();
    const storage = fakeStorage();
    await startConcordNotifications({ client, storage, pubkey: ME });
    await flush();
    expect(getChannelLevel(CID, CH)).toBe('all');
    await setChannelLevel(CID, CH, 'mentions');
    expect(getChannelLevel(CID, CH)).toBe('mentions');
    expect(storage.setItem).toHaveBeenCalledWith('notif:levels', expect.stringContaining('mentions'));
  });

  it('stop() tears down and getters return all-read defaults', async () => {
    const client = fakeClient();
    await startConcordNotifications({ client, storage: fakeStorage(), pubkey: ME });
    await flush();
    client.timeline$.next([rumor({ created_at: 100 })]);
    expect(channelUnreadState(CID, CH).unread).toBe(true);
    stopConcordNotifications();
    expect(channelUnreadState(CID, CH)).toEqual({ unread: false, mentioned: false });
    expect(client.timeline$.observers.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/__tests__/concord-notifications.svelte.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/concord/notifications.svelte.js`**

```js
// Central Concord notifications service (spec §2): one subscription per
// accessible channel across all communities, folded into a reactive summary
// map that badge components read via plain getter functions. Runs OUTSIDE
// component context — manual RxJS subscription management, no $effect.
// Started/stopped by client.svelte.js's setup()/teardown() under the same
// account lifecycle; imports only sibling concord submodules + pure helpers,
// so any chrome component may import this file directly (SSR-clean).
import {
  markerKey,
  foldChannelSummary,
  mergeMarker,
  summaryFlags,
  rollupArea,
  resolveLevel,
  pruneMarkers
} from './notification-helpers.js';
import { deriveVisibleChannels } from './community.svelte.js';
import { getActiveConcordChannel } from './active-channel.svelte.js';

const READ_KEY = 'notif:read';
const MENTION_READ_KEY = 'notif:mention-read';
const LEVELS_KEY = 'notif:levels';
export const TOASTS_ENABLED_KEY = 'notif:toasts-enabled';

/** @typedef {import('./notification-helpers.js').ChannelSummary} ChannelSummary */

// Reactive surface — reassigned whole, never mutated ($state.raw rule).
let summaries = $state.raw(/** @type {Record<string, Record<string, ChannelSummary>>} */ ({}));
let readMarkers = $state.raw(/** @type {Record<string, number>} */ ({}));
let mentionRead = $state.raw(/** @type {Record<string, number>} */ ({}));
let levels = $state.raw(/** @type {Record<string, string>} */ ({}));
let toastsEnabled = $state.raw(false);

// Non-reactive service internals.
/** @type {import('./storage.js').ConcordStorage | undefined} */
let storage;
let myPubkey = '';
let startTime = 0; // unix seconds — toast cache-replay guard (Task 9)
let generation = 0;
/** @type {import('rxjs').Subscription | undefined} */
let communitiesSub;
/** @type {Map<string, {channelsSub: import('rxjs').Subscription, channelSubs: Map<string, import('rxjs').Subscription>, communityName: string, channelNames: Map<string, string>}>} */
let watchers = new Map();
/** @type {(() => void) | undefined} */
let removeVisibilityListener;

/** Parse a stored JSON object, tolerating null/corruption. @param {string|null} raw */
function parseMap(raw) {
  try {
    const value = raw ? JSON.parse(raw) : null;
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

/** Fire-and-forget persist — kv failure degrades to session-only markers. @param {string} key @param {unknown} value */
function persist(key, value) {
  storage?.setItem(key, JSON.stringify(value)).catch((error) => {
    console.warn('concord: notification state persist failed', error);
  });
}

/** @param {string} communityId @param {string} channelId @param {any[]} rumors */
function onChannelRumors(communityId, channelId, rumors) {
  const prev = summaries[communityId]?.[channelId];
  const summary = foldChannelSummary(rumors, myPubkey);
  summaries = {
    ...summaries,
    [communityId]: { ...(summaries[communityId] ?? {}), [channelId]: summary }
  };
  const active = getActiveConcordChannel();
  if (
    active?.communityId === communityId &&
    active?.channelId === channelId &&
    typeof document !== 'undefined' &&
    document.visibilityState === 'visible'
  ) {
    markChannelRead(communityId, channelId);
  }
  maybeToast(communityId, channelId, rumors, prev, summary);
}

/**
 * Toast dispatcher stub — Task 9 fills this in (gates + Notification). Kept
 * as a named function so the fan-out above never changes.
 * @param {string} _communityId @param {string} _channelId @param {any[]} _rumors
 * @param {ChannelSummary | undefined} _prev @param {ChannelSummary} _summary
 */
function maybeToast(_communityId, _channelId, _rumors, _prev, _summary) {}

/** Diff-subscribe one community's accessible channels. @param {any} client @param {string} communityId @param {number} myGeneration */
function watchCommunity(client, communityId, myGeneration) {
  const community = client.getCommunity(communityId);
  if (!community) return;
  /** @type {Map<string, import('rxjs').Subscription>} */
  const channelSubs = new Map();
  const watcher = {
    channelSubs,
    communityName: '',
    channelNames: new Map(),
    channelsSub: community.channels$.subscribe((/** @type {any[]} */ channels) => {
      if (myGeneration !== generation) return;
      const held = (community.material?.channels ?? []).map((/** @type {{id: string}} */ k) => k.id);
      const visible = deriveVisibleChannels(channels ?? [], held).filter((c) => c.accessible);
      const liveIds = new Set(visible.map((c) => c.channel_id));
      watcher.channelNames = new Map(visible.map((c) => [c.channel_id, c.name ?? '']));
      for (const [channelId, sub] of channelSubs) {
        if (!liveIds.has(channelId)) {
          sub.unsubscribe();
          channelSubs.delete(channelId);
          if (summaries[communityId]?.[channelId]) {
            const { [channelId]: _gone, ...rest } = summaries[communityId];
            summaries = { ...summaries, [communityId]: rest };
          }
        }
      }
      for (const channel of visible) {
        if (channelSubs.has(channel.channel_id)) continue;
        channelSubs.set(
          channel.channel_id,
          community
            .channelStore(channel.channel_id)
            .timeline([{ kinds: [9] }])
            .subscribe((/** @type {any[]} */ rumors) => {
              if (myGeneration !== generation) return;
              onChannelRumors(communityId, channel.channel_id, rumors ?? []);
            })
        );
      }
    })
  };
  watchers.set(communityId, watcher);
}

/**
 * Start the service for one account. Idempotent per start/stop cycle — the
 * caller (client.svelte.js) stops before any restart. Markers are loaded
 * BEFORE the fan-out subscribes so a reload never flashes all-unread.
 * @param {{client: any, storage: import('./storage.js').ConcordStorage, pubkey: string}} args
 */
export async function startConcordNotifications({ client, storage: kv, pubkey }) {
  stopConcordNotifications();
  generation += 1;
  const myGeneration = generation;
  storage = kv;
  myPubkey = pubkey;
  startTime = Math.floor(Date.now() / 1000);

  const [readRaw, mentionRaw, levelsRaw, enabledRaw] = await Promise.all([
    kv.getItem(READ_KEY).catch(() => null),
    kv.getItem(MENTION_READ_KEY).catch(() => null),
    kv.getItem(LEVELS_KEY).catch(() => null),
    kv.getItem(TOASTS_ENABLED_KEY).catch(() => null)
  ]);
  if (myGeneration !== generation) return; // superseded while loading
  readMarkers = parseMap(readRaw);
  mentionRead = parseMap(mentionRaw);
  levels = parseMap(levelsRaw);
  toastsEnabled = enabledRaw === '1';

  communitiesSub = client.communities$.subscribe((/** @type {any[]} */ communities) => {
    if (myGeneration !== generation) return;
    const liveIds = new Set(
      (communities ?? [])
        .map((c) => c?.material?.community_id)
        .filter((/** @type {string|undefined} */ id) => !!id)
    );
    for (const [communityId, watcher] of watchers) {
      if (liveIds.has(communityId)) continue;
      watcher.channelsSub.unsubscribe();
      for (const sub of watcher.channelSubs.values()) sub.unsubscribe();
      watchers.delete(communityId);
      if (summaries[communityId]) {
        const { [communityId]: _gone, ...rest } = summaries;
        summaries = rest;
      }
    }
    for (const communityState of communities ?? []) {
      const communityId = communityState?.material?.community_id;
      if (!communityId || watchers.has(communityId)) continue;
      watchCommunity(client, communityId, myGeneration);
      const watcher = watchers.get(communityId);
      if (watcher) {
        watcher.communityName =
          communityState?.metadata?.name || communityState?.material?.name || '';
      }
    }
  });

  const onVisibility = () => {
    if (document.visibilityState !== 'visible') return;
    const active = getActiveConcordChannel();
    if (active) markChannelRead(active.communityId, active.channelId);
  };
  document.addEventListener('visibilitychange', onVisibility);
  removeVisibilityListener = () => document.removeEventListener('visibilitychange', onVisibility);
}

export function stopConcordNotifications() {
  generation += 1;
  communitiesSub?.unsubscribe();
  communitiesSub = undefined;
  for (const watcher of watchers.values()) {
    watcher.channelsSub.unsubscribe();
    for (const sub of watcher.channelSubs.values()) sub.unsubscribe();
  }
  watchers = new Map();
  removeVisibilityListener?.();
  removeVisibilityListener = undefined;
  storage = undefined;
  myPubkey = '';
  summaries = {};
  readMarkers = {};
  mentionRead = {};
  levels = {};
  toastsEnabled = false;
}

/**
 * Stamp a channel read up to its newest rumor (monotonic — never rewinds,
 * which also defuses far-future clock-skewed messages once viewed). Updates
 * reactive state synchronously; persists fire-and-forget. Prunes markers of
 * gone channels lazily on save.
 * @param {string} communityId @param {string} channelId
 */
export function markChannelRead(communityId, channelId) {
  const summary = summaries[communityId]?.[channelId];
  if (!summary) return;
  const key = markerKey(communityId, channelId);
  const next = mergeMarker(readMarkers, key, summary.latest);
  if (next !== readMarkers) {
    const liveKeys = new Set();
    for (const [cid, channels] of Object.entries(summaries)) {
      for (const chid of Object.keys(channels)) liveKeys.add(markerKey(cid, chid));
    }
    readMarkers = pruneMarkers(next, liveKeys) === next ? next : pruneMarkers(next, liveKeys);
    persist(READ_KEY, readMarkers);
  }
  if (summary.latestMention > (mentionRead[communityId] ?? 0)) {
    mentionRead = { ...mentionRead, [communityId]: summary.latestMention };
    persist(MENTION_READ_KEY, mentionRead);
  }
}

/**
 * Reactive per-channel badge flags — safe to call from templates/$derived
 * (reads module $state only, registers reactive deps at the call site).
 * @param {string|undefined} communityId @param {string|undefined} channelId
 * @returns {{unread: boolean, mentioned: boolean}}
 */
export function channelUnreadState(communityId, channelId) {
  if (!communityId || !channelId) return { unread: false, mentioned: false };
  return summaryFlags(
    summaries[communityId]?.[channelId],
    readMarkers[markerKey(communityId, channelId)] ?? 0
  );
}

/**
 * Reactive area/tab rollup for one community.
 * @param {string|undefined} communityId
 * @returns {{unread: boolean, mentioned: boolean}}
 */
export function areaUnreadState(communityId) {
  if (!communityId) return { unread: false, mentioned: false };
  return rollupArea(
    summaries[communityId] ?? {},
    readMarkers,
    communityId,
    mentionRead[communityId] ?? 0
  );
}

/** @param {string} communityId @param {string} channelId @returns {'all'|'mentions'|'nothing'} */
export function getChannelLevel(communityId, channelId) {
  return resolveLevel(levels, communityId, channelId);
}

/** @param {string} communityId @param {string} channelId @param {'all'|'mentions'|'nothing'} level */
export async function setChannelLevel(communityId, channelId, level) {
  levels = { ...levels, [markerKey(communityId, channelId)]: level };
  persist(LEVELS_KEY, levels);
}

/** @returns {boolean} */
export function getToastsEnabled() {
  return toastsEnabled;
}

/** @param {boolean} enabled */
export async function setToastsEnabled(enabled) {
  toastsEnabled = enabled;
  persist(TOASTS_ENABLED_KEY, enabled ? '1' : '0');
}
```

Note: `persist(TOASTS_ENABLED_KEY, …)` JSON-stringifies `'1'` to `'"1"'` — to keep the stored value exactly `'1'`, call `storage?.setItem(TOASTS_ENABLED_KEY, enabled ? '1' : '0')` directly in `setToastsEnabled` instead of going through `persist`. Do that; the test in Task 9 asserts the raw value.

Also fix the double-call wart in `markChannelRead` — compute pruning once:

```js
  if (next !== readMarkers) {
    const liveKeys = new Set();
    for (const [cid, channels] of Object.entries(summaries)) {
      for (const chid of Object.keys(channels)) liveKeys.add(markerKey(cid, chid));
    }
    readMarkers = pruneMarkers(next, liveKeys);
    persist(READ_KEY, readMarkers);
  }
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/lib/__tests__/concord-notifications.svelte.test.js`
Expected: PASS. Also run Task 1+2 files together:
`pnpm vitest run src/lib/__tests__/concord-notification-helpers.test.js src/lib/__tests__/concord-active-channel.svelte.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/concord/notifications.svelte.js src/lib/__tests__/concord-notifications.svelte.test.js
git commit -m "feat(concord): notifications service — per-channel unread/mention state"
```

---

### Task 4: Wire the service into the client lifecycle

**Files:**
- Modify: `src/lib/concord/client.svelte.js` (setup: after `await client.start()` resolves and generation still current; teardown: stop)
- Modify: `src/lib/concord/index.js` (barrel export for completeness — check the barrel's existing style first; `storage.js` stays un-exported)
- Test: extend `src/lib/__tests__/concord-client-generation-guard.test.js` mocks if they fail (the test mocks dynamic imports of client.svelte.js's deps; the new dynamic import of `./notifications.svelte.js` must be added to its `vi.mock` set if the suite breaks)

**Interfaces:**
- Consumes: `startConcordNotifications` / `stopConcordNotifications` (Task 3).
- Produces: a running service whenever the Concord client is running.

- [ ] **Step 1: Modify `client.svelte.js` — teardown**

In `teardown()` (line 70), stop the service before stopping the client. Use a dynamic import guard — `teardown()` is sync, so hold the module reference from setup instead. Add a module-level plain let near `currentClient` (line 28):

```js
/** @type {{ start: Function, stop: Function } | undefined} */ let notificationsModule;
```

In `teardown()`, first line:

```js
function teardown() {
  notificationsModule?.stop();
  for (const sub of clientSubs) sub.unsubscribe();
  ...
```

- [ ] **Step 2: Modify `client.svelte.js` — setup**

In `setup()`, after `currentClient = client; clientSubs = localSubs; state = { ...state, client };` (lines 251-253) and BEFORE `await client.start()`, add:

```js
    // Start the notifications service alongside the client (spec §2). Dynamic
    // import keeps module-load order unchanged; the service reuses the same
    // ConcordStorage the client got, so markers live in the same per-account
    // DB and are wiped together on logout.
    const notifications = await import('./notifications.svelte.js');
    if (myGeneration !== generation) return;
    notificationsModule = {
      start: notifications.startConcordNotifications,
      stop: notifications.stopConcordNotifications
    };
    await notifications.startConcordNotifications({
      client,
      storage: storageModule.createConcordStorage(dbName),
      pubkey: account.pubkey
    });
    if (myGeneration !== generation) {
      notifications.stopConcordNotifications();
      return;
    }
    await client.start();
```

Note the storage instance: `createConcordStorage(dbName)` — same DB as the client's own storage, cheap to create a second handle.

In the `catch` block (line 263), after the generation check, add `notificationsModule?.stop();` alongside the existing cleanup.

- [ ] **Step 3: Run the existing lifecycle tests**

Run: `pnpm vitest run src/lib/__tests__/concord-client-generation-guard.test.js src/lib/__tests__/concord-account-watcher.test.js src/lib/__tests__/concord-unlock.test.js`
Expected: PASS. If the generation-guard test fails on the new `import('./notifications.svelte.js')`, add it to that test's mocked-module set following the existing `vi.mock` pattern in the file (mock `startConcordNotifications`/`stopConcordNotifications` as `vi.fn()`), and add one assertion: after account B supersedes account A, the stale A setup never left the service running for A (i.e. `stopConcordNotifications` called at least once after B takes over).

- [ ] **Step 4: Check the barrel**

Read `src/lib/concord/index.js`; add re-exports matching its existing style for `notifications.svelte.js` and `active-channel.svelte.js` (both are SSR-clean — no package imports — so barrel exposure is safe, unlike `storage.js`).

- [ ] **Step 5: Run lint + check, commit**

```bash
pnpm run lint && pnpm run check
git add src/lib/concord/client.svelte.js src/lib/concord/index.js src/lib/__tests__/concord-client-generation-guard.test.js
git commit -m "feat(concord): start/stop notifications service with client lifecycle"
```

---

### Task 5: Channel-row badges, active-channel wiring, `?channel=` deep link

**Files:**
- Create: `src/lib/components/shared/ConcordUnreadDot.svelte`
- Modify: `src/lib/components/community/channels/PrivateChannelsView.svelte`
- Modify: `messages/en.json`, `messages/de.json`
- Test: `src/lib/components/__tests__/ConcordUnreadDot.test.js`

**Interfaces:**
- Consumes: `channelUnreadState`, `markChannelRead` (Task 3); `setActiveConcordChannel`/`clearActiveConcordChannel` (Task 2).
- Produces: `ConcordUnreadDot` props `{unread?: boolean, mentioned?: boolean, class?: string}` (used again in Task 6); `?channel=<id>` initial selection (used by Task 9's toast click).

- [ ] **Step 1: Add i18n messages**

In `messages/en.json` (alphabetically near the other `concord_` keys):

```json
"concord_notif_mentioned": "You were mentioned",
"concord_notif_unread": "Unread messages",
```

In `messages/de.json`:

```json
"concord_notif_mentioned": "Du wurdest erwähnt",
"concord_notif_unread": "Ungelesene Nachrichten",
```

- [ ] **Step 2: Write the failing component test**

Create `src/lib/components/__tests__/ConcordUnreadDot.test.js`:

```js
/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import ConcordUnreadDot from '$lib/components/shared/ConcordUnreadDot.svelte';

describe('ConcordUnreadDot', () => {
  it('renders nothing when read', () => {
    const { container } = render(ConcordUnreadDot, { unread: false, mentioned: false });
    expect(container.querySelector('[data-testid="concord-unread-dot"]')).toBeNull();
    expect(container.querySelector('[data-testid="concord-mention-pill"]')).toBeNull();
  });

  it('renders the neutral dot for plain unread', () => {
    const { container } = render(ConcordUnreadDot, { unread: true, mentioned: false });
    expect(container.querySelector('[data-testid="concord-unread-dot"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="concord-mention-pill"]')).toBeNull();
  });

  it('renders the accent @ pill when mentioned (wins over the dot)', () => {
    const { container } = render(ConcordUnreadDot, { unread: true, mentioned: true });
    expect(container.querySelector('[data-testid="concord-mention-pill"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="concord-unread-dot"]')).toBeNull();
  });
});
```

Check first how existing component tests render Svelte 5 components (see any file in `src/lib/components/__tests__/` — e.g. `InboxItem.test.js` — and mirror its render/import style exactly; if they use `mount` from `svelte` instead of testing-library, follow that).

- [ ] **Step 3: Run to verify failure**

Run: `pnpm vitest run src/lib/components/__tests__/ConcordUnreadDot.test.js`
Expected: FAIL — component not found.

- [ ] **Step 4: Implement `src/lib/components/shared/ConcordUnreadDot.svelte`**

```svelte
<!--
  ConcordUnreadDot — Armada-style binary unread indicator (spec §4).
  Mention tier wins over plain unread; renders nothing when read. Purely
  presentational so it can sit next to ConcordAreaBadge, on channel rows, and
  on the Kanäle tab without pulling any service state itself.
-->
<script>
  import * as m from '$lib/paraglide/messages';

  let { unread = false, mentioned = false, class: className = '' } = $props();
</script>

{#if mentioned}
  <span
    data-testid="concord-mention-pill"
    class="badge h-4 min-w-4 px-1 text-[10px] font-bold badge-secondary {className}"
    aria-label={m.concord_notif_mentioned()}>@</span
  >
{:else if unread}
  <span
    data-testid="concord-unread-dot"
    class="inline-block h-2 w-2 rounded-full bg-base-content {className}"
    aria-label={m.concord_notif_unread()}
  ></span>
{/if}
```

- [ ] **Step 5: Run the component test**

Run: `pnpm vitest run src/lib/components/__tests__/ConcordUnreadDot.test.js`
Expected: PASS.

- [ ] **Step 6: Wire PrivateChannelsView**

In `src/lib/components/community/channels/PrivateChannelsView.svelte`:

Add imports (after the existing concord imports, lines 13-14):

```js
  import { channelUnreadState, markChannelRead } from '$lib/concord/notifications.svelte.js';
  import {
    setActiveConcordChannel,
    clearActiveConcordChannel
  } from '$lib/concord/active-channel.svelte.js';
  import ConcordUnreadDot from '$lib/components/shared/ConcordUnreadDot.svelte';
  import { page } from '$app/stores';
  import { get } from 'svelte/store';
```

Change the `selectedChannelId` init (line 49) to read the deep-link param once:

```js
  // ?channel= deep link (spec §6: toast click target; also makes channels
  // linkable). Read once at init — subsequent selection is user-driven.
  let selectedChannelId = $state(get(page).url.searchParams.get('channel') ?? '');
```

Add the active-channel/mark-read effect after the `activeChannel` derivation (line 85):

```js
  // Mirror the on-screen channel into the shared active-channel store and
  // stamp it read. Reads deps BEFORE the early return (project gotcha:
  // effects that bail before reading reactive state capture no deps). The
  // responsive double-mount renders two instances tracking the same
  // selection — last-writer-wins is fine, both write the same value.
  $effect(() => {
    const cid = concord.communityId;
    const chid = activeChannel?.accessible ? activeChannel.channel_id : undefined;
    if (!cid || !chid) {
      clearActiveConcordChannel();
      return;
    }
    setActiveConcordChannel(cid, chid);
    markChannelRead(cid, chid);
    return () => clearActiveConcordChannel();
  });
```

In the channel-row `{#each}` (lines 138-154), add flags + indicator. Replace the row content:

```svelte
      {#each channels as channel (channel.channel_id)}
        {@const flags = channelUnreadState(concord.communityId, channel.channel_id)}
        <button
          class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors duration-150 {activeChannel?.channel_id ===
          channel.channel_id
            ? 'bg-primary/10 font-semibold text-primary'
            : 'text-base-content/80 hover:bg-base-300/60'}"
          onclick={() => {
            selectedChannelId = channel.channel_id;
            mobileChat = true;
          }}
        >
          <span aria-hidden="true">{channel.private ? '🔒' : '#'}</span>
          <span
            class="min-w-0 flex-1 truncate {channel.accessible ? '' : 'opacity-50'} {flags.unread
              ? 'font-bold'
              : ''}">{channel.name}</span
          >
          <ConcordUnreadDot unread={flags.unread} mentioned={flags.mentioned} />
        </button>
      {/each}
```

- [ ] **Step 7: Run checks + full concord test set**

```bash
pnpm run lint && pnpm run check
pnpm vitest run src/lib/__tests__ src/lib/components/__tests__/ConcordUnreadDot.test.js
```

Expected: PASS (modulo memory-documented pre-existing flakes if running broader sets).

- [ ] **Step 8: Commit**

```bash
git add src/lib/components/shared/ConcordUnreadDot.svelte \
  src/lib/components/__tests__/ConcordUnreadDot.test.js \
  src/lib/components/community/channels/PrivateChannelsView.svelte \
  messages/en.json messages/de.json
git commit -m "feat(concord): channel-row unread/mention badges + channel deep link"
```

---

### Task 6: Area & tab rollup dots

**Files:**
- Modify: `src/lib/components/community/layout/BottomTabBar.svelte`
- Modify: `src/lib/components/community/layout/ContentNavSidebar.svelte`
- Modify: `src/lib/components/Sidebar.svelte`
- Modify: `src/lib/components/community/layout/CommunitySidebar.svelte`

**Interfaces:**
- Consumes: `areaUnreadState(communityId)` (Task 3), `ConcordUnreadDot` (Task 5). In BottomTabBar/ContentNavSidebar the Concord community id is `getConcord().pointer?.communityId` (both files already call `useConcordCommunity` — verify the local variable name at the top of each file). In Sidebar/CommunitySidebar it is `area.communityId` from `useUnlinkedConcordAreas`.
- Produces: nothing new for later tasks.

- [ ] **Step 1: BottomTabBar** — in the tab loop (lines ~205-234), inside the existing `<span class="relative">` around the icon, add after the restricted-tabs block:

```svelte
              {#if type.id === 'channels'}
                {@const areaFlags = areaUnreadState(getConcord().pointer?.communityId)}
                <span class="absolute -top-1 -right-1.5">
                  <ConcordUnreadDot unread={areaFlags.unread} mentioned={areaFlags.mentioned} />
                </span>
              {/if}
```

Add imports at the top (match the file's existing import block):

```js
  import { areaUnreadState } from '$lib/concord/notifications.svelte.js';
  import ConcordUnreadDot from '$lib/components/shared/ConcordUnreadDot.svelte';
```

Verify the hook getter's actual local name in this file (the tab-injection code at line ~81 calls `const concord = getConcord();` inside a `$derived` — if `getConcord` isn't reachable in the template scope, compute a `$derived` at script level: `const concordAreaFlags = $derived(areaUnreadState(getConcord().pointer?.communityId));` and use `concordAreaFlags` in the template instead).

- [ ] **Step 2: ContentNavSidebar** — same change in its tab loop (lines ~151-165): same imports, and inside the `<span class="relative">` wrapping the label:

```svelte
            {#if type.id === 'channels'}
              <span class="absolute -top-1.5 -right-4">
                <ConcordUnreadDot unread={concordAreaFlags.unread} mentioned={concordAreaFlags.mentioned} />
              </span>
            {/if}
```

with the script-level `const concordAreaFlags = $derived(areaUnreadState(getConcord().pointer?.communityId));`.

- [ ] **Step 3: Sidebar.svelte** — in the private-areas `{#each}` (lines 166-185), wrap the `ConcordAreaBadge` in a relative span with an overlaid dot:

```svelte
          {@const areaFlags = areaUnreadState(area.communityId)}
          <span class="relative shrink-0">
            <ConcordAreaBadge
              name={area.name}
              communityId={area.communityId}
              iconPointer={area.iconPointer}
              class="h-8 w-8 shrink-0"
            />
            <span class="absolute -top-0.5 -right-0.5">
              <ConcordUnreadDot unread={areaFlags.unread} mentioned={areaFlags.mentioned} />
            </span>
          </span>
```

Import `areaUnreadState` + `ConcordUnreadDot` following the file's existing import style (it already imports `ConcordAreaBadge`).

- [ ] **Step 4: CommunitySidebar.svelte** — apply the same wrap at BOTH `ConcordAreaBadge` sites (collapsed rail ~line 137, expanded list ~line 245), same imports.

- [ ] **Step 5: Verify**

```bash
pnpm run lint && pnpm run check && pnpm vitest run src/lib/__tests__
```
Expected: PASS. Then a quick visual smoke via the dev server is deferred to Task 10's e2e (badges need two accounts to light up).

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/community/layout/BottomTabBar.svelte \
  src/lib/components/community/layout/ContentNavSidebar.svelte \
  src/lib/components/Sidebar.svelte \
  src/lib/components/community/layout/CommunitySidebar.svelte
git commit -m "feat(concord): area + Kanäle-tab unread rollup dots"
```

---

### Task 7: Reply p-tag (package alias + send wrapper)

**Files:**
- Modify: `package.json` (dependencies), `eslint.config.js` (restricted-import patterns)
- Create: `src/lib/concord/send-message.js`
- Modify: `src/lib/components/community/channels/ChannelChat.svelte` (`send()`)
- Test: `src/lib/__tests__/concord-send-message.test.js`

**Interfaces:**
- Consumes: `applesauce-common-concord/factories` `ChatMessageFactory` (`.create(text)`, `.replyTo({id, author})`, `.mention(pubkey)`); `community.sendMessage` / `community.sendEvent`.
- Produces: `sendChannelMessage(community, channelId, text, replyTo, myPubkey) → Promise<void>` where `replyTo` is `{id: string, author: string} | null | undefined`.

- [ ] **Step 1: Add the alias dependency**

In `package.json` `"dependencies"`, alphabetically before `"applesauce-concord"`:

```json
"applesauce-common-concord": "npm:applesauce-common@0.0.0-concord-20260714212055",
```

Run: `pnpm install`
Expected: lockfile updates, `node_modules/applesauce-common-concord` resolves to the pinned concord build (verify: `ls node_modules/applesauce-common-concord/dist/factories/chat-message.js` exists).

**IMPORTANT (project memory):** the pre-push hook runs in the MAIN checkout — before any future `git push`, run `pnpm install` in `/home/laoc/coding/edufeed/edufeed-app` too.

- [ ] **Step 2: Extend the lint fence**

In `eslint.config.js`, the restricted-import patterns block (~lines 56-61) currently lists `applesauce-concord`, `applesauce-concord/*`, `applesauce-core-concord`, `applesauce-core-concord/*`. Add:

```js
                'applesauce-common-concord',
                'applesauce-common-concord/*'
```

(the `ignores: ['src/lib/concord/**']` at line 48 already exempts the wrapper directory).

- [ ] **Step 3: Write the failing tests**

Create `src/lib/__tests__/concord-send-message.test.js`:

```js
/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { sendChannelMessage } from '$lib/concord/send-message.js';

const ME = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

function fakeCommunity() {
  return { sendMessage: vi.fn(async () => {}), sendEvent: vi.fn(async () => {}) };
}

describe('sendChannelMessage', () => {
  it('delegates non-replies to sendMessage unchanged', async () => {
    const community = fakeCommunity();
    await sendChannelMessage(community, 'chid', 'hello', null, ME);
    expect(community.sendMessage).toHaveBeenCalledWith('chid', 'hello');
    expect(community.sendEvent).not.toHaveBeenCalled();
  });

  it('replies go through sendEvent with q tag AND mention p tag for the parent author', async () => {
    const community = fakeCommunity();
    await sendChannelMessage(community, 'chid', 'reply text', { id: 'parent-id', author: OTHER }, ME);
    expect(community.sendMessage).not.toHaveBeenCalled();
    expect(community.sendEvent).toHaveBeenCalledTimes(1);
    const [channelId, source] = community.sendEvent.mock.calls[0];
    expect(channelId).toBe('chid');
    const template = await source; // EventFactory is PromiseLike
    expect(template.kind).toBe(9);
    expect(template.content).toBe('reply text');
    const qTag = template.tags.find((t) => t[0] === 'q');
    expect(qTag?.[1]).toBe('parent-id');
    const pTags = template.tags.filter((t) => t[0] === 'p').map((t) => t[1]);
    expect(pTags).toContain(OTHER);
  });

  it('self-replies get the q tag but NO self p tag', async () => {
    const community = fakeCommunity();
    await sendChannelMessage(community, 'chid', 'note to self', { id: 'parent-id', author: ME }, ME);
    const [, source] = community.sendEvent.mock.calls[0];
    const template = await source;
    expect(template.tags.find((t) => t[0] === 'q')?.[1]).toBe('parent-id');
    expect(template.tags.filter((t) => t[0] === 'p')).toHaveLength(0);
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `pnpm vitest run src/lib/__tests__/concord-send-message.test.js`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement `src/lib/concord/send-message.js`**

```js
// Reply-aware channel send (spec §5). The pinned dist's
// community.sendMessage(…, replyTo) writes only the NIP-C7 `q` tag — no `p`
// tag for the parent author, so a reply never lights the recipient's mention
// tier. The factory it uses HAS a .mention() operation; we just can't reach
// it through sendMessage's signature. So replies are built app-side with the
// same ChatMessageFactory (via the lockstep-pinned applesauce-common-concord
// alias) and published through community.sendEvent, which applies the
// identical channel/epoch binding + sealing path (dist/client/community.js).
// Non-replies keep using sendMessage — its content pipeline already turns
// nostr:npub… mentions into p tags (setShortTextContent → tagPubkeyMentions).
//
// Dynamic import: this module is imported by ChannelChat.svelte; a static
// package import would drag the concord dep tree toward SSR chunks, against
// the src/lib/concord convention (see CLAUDE.md).

/**
 * @param {any} community ConcordCommunity
 * @param {string} channelId
 * @param {string} text
 * @param {{id: string, author: string} | null | undefined} replyTo
 * @param {string} myPubkey
 * @returns {Promise<void>}
 */
export async function sendChannelMessage(community, channelId, text, replyTo, myPubkey) {
  if (!replyTo) {
    await community.sendMessage(channelId, text);
    return;
  }
  const { ChatMessageFactory } = await import('applesauce-common-concord/factories');
  let factory = ChatMessageFactory.create(text).replyTo({ id: replyTo.id, author: replyTo.author });
  if (replyTo.author !== myPubkey) factory = factory.mention(replyTo.author);
  await community.sendEvent(channelId, factory);
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run src/lib/__tests__/concord-send-message.test.js`
Expected: PASS. (If `template.kind` comes back undefined, inspect the resolved template shape — `blankEventTemplate(kinds.ChatMessage)` sets kind 9; the factory resolves via `await`.)

- [ ] **Step 7: Switch ChannelChat to the wrapper**

In `src/lib/components/community/channels/ChannelChat.svelte`:

Add import:

```js
  import { sendChannelMessage } from '$lib/concord/send-message.js';
```

In `send()` (line 108) replace:

```js
      await community.sendMessage(channel.channel_id, body, replyTo ?? undefined);
```

with:

```js
      await sendChannelMessage(
        community,
        channel.channel_id,
        body,
        replyTo ?? undefined,
        getActiveUser()?.pubkey ?? ''
      );
```

- [ ] **Step 8: Verify + commit**

```bash
pnpm run lint && pnpm run check
pnpm vitest run src/lib/__tests__/concord-send-message.test.js src/lib/__tests__/concord-chat-helpers.test.js
git add package.json pnpm-lock.yaml eslint.config.js src/lib/concord/send-message.js \
  src/lib/__tests__/concord-send-message.test.js \
  src/lib/components/community/channels/ChannelChat.svelte
git commit -m "feat(concord): reply p-tags via applesauce-common-concord factory path"
```

---

### Task 8: @-mention autocomplete

**Files:**
- Modify: `src/lib/concord/chat-helpers.js` (add pure mention-query helpers)
- Create: `src/lib/components/community/channels/MentionAutocomplete.svelte`
- Modify: `src/lib/components/community/channels/ChannelChat.svelte` (composer wiring)
- Test: extend `src/lib/__tests__/concord-chat-helpers.test.js`; create `src/lib/components/__tests__/MentionAutocomplete.test.js`

**Interfaces:**
- Consumes: `community.members$` (already bridged in ChannelChat as `getMembers()`), `useProfileMap`, `getUserDisplayName`, `nip19` from `nostr-tools` (app convention: `import { nip19 } from 'nostr-tools'`).
- Produces:
  - `detectMentionQuery(text, caret) → {start: number, query: string} | null`
  - `applyMention(text, start, caret, npub) → {text: string, caret: number}`
  - `MentionAutocomplete.svelte` props: `{candidates: Array<{pubkey: string, name: string, profile: any}>, highlightIndex: number, onSelect: (pubkey: string) => void}`
- Mention → p-tag conversion is already handled by `sendMessage`'s content pipeline; rendering of `nostr:npub…` is already handled by `NostrContentRenderer` (`node.type === 'mention'`, line 116) — NO changes needed there, but Step 8 verifies it live.

- [ ] **Step 1: Write failing unit tests for the pure helpers**

Append to `src/lib/__tests__/concord-chat-helpers.test.js`:

```js
import { detectMentionQuery, applyMention } from '$lib/concord/chat-helpers.js';

describe('detectMentionQuery', () => {
  it('finds @query at the caret', () => {
    expect(detectMentionQuery('hello @ali', 10)).toEqual({ start: 6, query: 'ali' });
  });

  it('requires @ at start or after whitespace (emails do not trigger)', () => {
    expect(detectMentionQuery('mail me a@b', 11)).toBeNull();
    expect(detectMentionQuery('@a', 2)).toEqual({ start: 0, query: 'a' });
  });

  it('stops at whitespace and closes after a space', () => {
    expect(detectMentionQuery('hey @ali how', 8)).toEqual({ start: 4, query: 'ali' });
    expect(detectMentionQuery('hey @ali how', 12)).toBeNull();
  });

  it('returns null with no @ before the caret', () => {
    expect(detectMentionQuery('plain text', 5)).toBeNull();
  });
});

describe('applyMention', () => {
  it('replaces @query with nostr:npub + trailing space and reports the new caret', () => {
    const npub = 'npub1xyz';
    const result = applyMention('hey @ali how', 4, 8, npub);
    expect(result.text).toBe('hey nostr:npub1xyz  how');
    expect(result.caret).toBe(4 + `nostr:${npub} `.length);
  });

  it('works at the end of the text', () => {
    const result = applyMention('hey @ali', 4, 8, 'npub1xyz');
    expect(result.text).toBe('hey nostr:npub1xyz ');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/__tests__/concord-chat-helpers.test.js`
Expected: FAIL — `detectMentionQuery` not exported.

- [ ] **Step 3: Implement the helpers in `src/lib/concord/chat-helpers.js`**

Append (keeping the file pure — no imports):

```js
/**
 * Detect an in-progress `@query` immediately before the caret (spec §5).
 * The `@` must sit at the text start or after whitespace so emails/handles
 * mid-word never trigger; the query itself contains no whitespace.
 * @param {string} text
 * @param {number} caret cursor position (selectionStart)
 * @returns {{start: number, query: string} | null}
 */
export function detectMentionQuery(text, caret) {
  const upToCaret = text.slice(0, caret);
  const at = upToCaret.lastIndexOf('@');
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(upToCaret[at - 1])) return null;
  const query = upToCaret.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { start: at, query };
}

/**
 * Replace the `@query` span with a NIP-27 `nostr:npub…` reference plus a
 * trailing space. The send pipeline (setShortTextContent → tagPubkeyMentions
 * in the pinned dist) turns the reference into a `p` tag at publish time.
 * @param {string} text
 * @param {number} start index of the `@`
 * @param {number} caret current cursor position (end of the query)
 * @param {string} npub bech32 npub of the selected member
 * @returns {{text: string, caret: number}}
 */
export function applyMention(text, start, caret, npub) {
  const inserted = `nostr:${npub} `;
  const nextText = text.slice(0, start) + inserted + text.slice(caret);
  return { text: nextText, caret: start + inserted.length };
}
```

- [ ] **Step 4: Run helper tests**

Run: `pnpm vitest run src/lib/__tests__/concord-chat-helpers.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing component test**

Create `src/lib/components/__tests__/MentionAutocomplete.test.js` (mirror the render style of the existing component tests, as in Task 5):

```js
/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import MentionAutocomplete from '$lib/components/community/channels/MentionAutocomplete.svelte';

const CANDIDATES = [
  { pubkey: 'a'.repeat(64), name: 'Alice', profile: null },
  { pubkey: 'b'.repeat(64), name: 'Bob', profile: null }
];

describe('MentionAutocomplete', () => {
  it('lists candidates and highlights the given index', () => {
    const { getAllByRole } = render(MentionAutocomplete, {
      candidates: CANDIDATES,
      highlightIndex: 1,
      onSelect: () => {}
    });
    const options = getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[1].getAttribute('aria-selected')).toBe('true');
  });

  it('fires onSelect with the pubkey on click', async () => {
    const onSelect = vi.fn();
    const { getAllByRole } = render(MentionAutocomplete, {
      candidates: CANDIDATES,
      highlightIndex: 0,
      onSelect
    });
    await fireEvent.mousedown(getAllByRole('option')[1]);
    expect(onSelect).toHaveBeenCalledWith('b'.repeat(64));
  });

  it('renders nothing for an empty candidate list', () => {
    const { container } = render(MentionAutocomplete, {
      candidates: [],
      highlightIndex: 0,
      onSelect: () => {}
    });
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });
});
```

- [ ] **Step 6: Implement `MentionAutocomplete.svelte`**

```svelte
<!--
  MentionAutocomplete — presentational @-mention dropdown for the Concord
  composer (spec §5). ChannelChat owns detection state (detectMentionQuery on
  the input) and keyboard handling; this component only renders candidates
  and reports a pick. mousedown (not click) so selection wins the race
  against the input losing focus.
-->
<script>
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';

  /** @type {{candidates: Array<{pubkey: string, name: string, profile: any}>, highlightIndex: number, onSelect: (pubkey: string) => void}} */
  let { candidates = [], highlightIndex = 0, onSelect } = $props();
</script>

{#if candidates.length > 0}
  <ul
    role="listbox"
    class="absolute right-4 bottom-full left-4 z-40 mb-1 max-h-60 overflow-y-auto rounded-box border border-base-300 bg-base-100 p-1 shadow-lg"
  >
    {#each candidates as candidate, i (candidate.pubkey)}
      <li role="option" aria-selected={i === highlightIndex}>
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm {i ===
          highlightIndex
            ? 'bg-primary/10 text-primary'
            : 'hover:bg-base-300/60'}"
          onmousedown={(e) => {
            e.preventDefault();
            onSelect(candidate.pubkey);
          }}
        >
          <ProfileAvatar pubkey={candidate.pubkey} profile={candidate.profile} size="xs" />
          <span class="min-w-0 flex-1 truncate">{candidate.name}</span>
        </button>
      </li>
    {/each}
  </ul>
{/if}
```

Check `ProfileAvatar`'s size prop values first (grep `size=` usages); use the smallest existing size token.

- [ ] **Step 7: Run the component test**

Run: `pnpm vitest run src/lib/components/__tests__/MentionAutocomplete.test.js`
Expected: PASS.

- [ ] **Step 8: Wire the composer in ChannelChat**

In `ChannelChat.svelte`:

Imports:

```js
  import { nip19 } from 'nostr-tools';
  import { detectMentionQuery, applyMention } from '$lib/concord/chat-helpers.js';
  import MentionAutocomplete from './MentionAutocomplete.svelte';
```

State + derivations (after the existing `replyTo` state, line 67):

```js
  /** @type {HTMLInputElement | undefined} */
  let inputEl;
  let mention = $state(/** @type {{start: number, query: string} | null} */ (null));
  let mentionIndex = $state(0);
  // Member profiles for the @-picker (getProfiles above only covers message
  // authors; lurkers must be mentionable too).
  const getMemberProfiles = useProfileMap(() => [...getMembers()]);
  const mentionCandidates = $derived.by(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    const me = getActiveUser()?.pubkey;
    return [...getMembers()]
      .filter((pubkey) => pubkey !== me)
      .map((pubkey) => ({
        pubkey,
        name: getUserDisplayName(pubkey, getMemberProfiles().get(pubkey)),
        profile: getMemberProfiles().get(pubkey)
      }))
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .slice(0, 8);
  });

  function refreshMention() {
    mention = inputEl ? detectMentionQuery(text, inputEl.selectionStart ?? text.length) : null;
    mentionIndex = 0;
  }

  /** @param {string} pubkey */
  function pickMention(pubkey) {
    if (!mention || !inputEl) return;
    const caret = inputEl.selectionStart ?? text.length;
    const result = applyMention(text, mention.start, caret, nip19.npubEncode(pubkey));
    text = result.text;
    mention = null;
    inputEl.focus();
    // restore caret after Svelte flushes the value
    const nextCaret = result.caret;
    requestAnimationFrame(() => inputEl?.setSelectionRange(nextCaret, nextCaret));
  }

  /** @param {KeyboardEvent} event */
  function onComposerKeydown(event) {
    if (!mention || mentionCandidates.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      mentionIndex = (mentionIndex + 1) % mentionCandidates.length;
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      mentionIndex = (mentionIndex - 1 + mentionCandidates.length) % mentionCandidates.length;
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      pickMention(mentionCandidates[mentionIndex].pubkey);
    } else if (event.key === 'Escape') {
      mention = null;
    }
  }
```

Template: make the form's wrapper `relative` and mount the dropdown. Replace the composer form (lines 312-330):

```svelte
  <div class="relative">
    <MentionAutocomplete
      candidates={mentionCandidates}
      highlightIndex={mentionIndex}
      onSelect={pickMention}
    />
    <form
      class="m-4 mt-0 flex shrink-0 items-center gap-2 rounded-full border border-base-300 bg-base-100 p-1.5"
      onsubmit={(e) => {
        e.preventDefault();
        if (mention && mentionCandidates.length > 0) return; // Enter picked a mention
        send();
      }}
    >
      <input
        class="input flex-1 input-ghost focus:outline-none"
        data-testid="concord-chat-input"
        bind:this={inputEl}
        bind:value={text}
        oninput={refreshMention}
        onclick={refreshMention}
        onkeydown={onComposerKeydown}
        placeholder={m.concord_input_placeholder({ name: channel.name })}
      />
      <button
        class="btn btn-circle btn-sm btn-neutral"
        type="submit"
        disabled={sending || !text.trim()}>➤</button
      >
    </form>
  </div>
```

- [ ] **Step 9: Verify rendering end-to-end (manual smoke)**

`NostrContentRenderer` already renders `nostr:npub…` as an inline profile mention (line 116-117) — no code change. Confirm with the dev server (see the `run` skill / project dev command; there may already be a running dev server — check ports per project memory): send a message containing a mention in a test channel, confirm it renders as a profile chip, and REQ nothing — this is sealed content, browser-only check.

- [ ] **Step 10: Full verify + commit**

```bash
pnpm run lint && pnpm run check
pnpm vitest run src/lib/__tests__/concord-chat-helpers.test.js src/lib/components/__tests__/MentionAutocomplete.test.js
git add src/lib/concord/chat-helpers.js src/lib/__tests__/concord-chat-helpers.test.js \
  src/lib/components/community/channels/MentionAutocomplete.svelte \
  src/lib/components/__tests__/MentionAutocomplete.test.js \
  src/lib/components/community/channels/ChannelChat.svelte
git commit -m "feat(concord): @-mention autocomplete over the community roster"
```

---

### Task 9: Foreground OS toasts + bell toggle + level menu

**Files:**
- Modify: `src/lib/concord/notifications.svelte.js` (fill in `maybeToast`, add name lookups)
- Modify: `src/lib/components/community/channels/PrivateChannelsView.svelte` (bell toggle)
- Modify: `src/lib/components/community/channels/ChannelChat.svelte` (level menu in the ⋯ dropdown)
- Modify: `messages/en.json`, `messages/de.json`
- Test: extend `src/lib/__tests__/concord-notifications.svelte.test.js`

**Interfaces:**
- Consumes: `shouldToast`/`resolveLevel` (Task 1), `getActiveConcordChannel` (Task 2), watcher-held `communityName`/`channelNames` (Task 3), `eventStore.getReplaceable(0, pubkey)` (sync profile read — the established app pattern, see `dm-service.svelte.js:240`), `getProfileContent` from `applesauce-core/helpers` (the app's own applesauce-core 6.2.0 — NOT concord-fenced), `getUserDisplayName` from `$lib/helpers/message-utils.js`, `goto` from `$app/navigation`.
- Produces: working toasts; bell + level UI.

- [ ] **Step 1: Add i18n messages**

`messages/en.json`:

```json
"concord_notif_toast_body": "New message from {name}",
"concord_notif_bell_on": "Browser notifications on — click to disable",
"concord_notif_bell_off": "Enable browser notifications",
"concord_notif_bell_denied": "Notifications are blocked in your browser settings",
"concord_notif_level_label": "Notifications",
"concord_notif_level_all": "All messages",
"concord_notif_level_mentions": "Mentions only",
"concord_notif_level_nothing": "Nothing",
```

`messages/de.json`:

```json
"concord_notif_toast_body": "Neue Nachricht von {name}",
"concord_notif_bell_on": "Browser-Benachrichtigungen an — klicken zum Deaktivieren",
"concord_notif_bell_off": "Browser-Benachrichtigungen aktivieren",
"concord_notif_bell_denied": "Benachrichtigungen sind in den Browser-Einstellungen blockiert",
"concord_notif_level_label": "Benachrichtigungen",
"concord_notif_level_all": "Alle Nachrichten",
"concord_notif_level_mentions": "Nur Erwähnungen",
"concord_notif_level_nothing": "Keine",
```

(Watch the project gotcha: no bare `@` before a `{param}` in message values — these are safe.)

- [ ] **Step 2: Write the failing dispatcher tests**

Append to `src/lib/__tests__/concord-notifications.svelte.test.js` (inside the existing describe, reusing `fakeClient`/`fakeStorage`/`rumor`/`flush`):

```js
  it('fires a Notification for a fresh post-start message when enabled', async () => {
    const created = [];
    class FakeNotification {
      static permission = 'granted';
      constructor(title, options) {
        created.push({ title, options });
      }
    }
    vi.stubGlobal('Notification', FakeNotification);
    const client = fakeClient();
    const storage = fakeStorage({ 'notif:toasts-enabled': '1' });
    await startConcordNotifications({ client, storage, pubkey: ME });
    await flush();
    // Baseline fold (cache replay analog) — must NOT toast.
    client.timeline$.next([rumor({ created_at: 100 })]);
    expect(created).toHaveLength(0);
    // New message stamped AFTER service start.
    const fresh = Math.floor(Date.now() / 1000) + 10;
    client.timeline$.next([rumor({ created_at: fresh }), rumor({ created_at: 100 })]);
    expect(created).toHaveLength(1);
    expect(created[0].options.tag).toBe(`concord-${CH}`);
    vi.unstubAllGlobals();
  });

  it('suppresses toasts for the visible active channel and for level=nothing', async () => {
    const created = [];
    class FakeNotification {
      static permission = 'granted';
      constructor(title, options) {
        created.push({ title, options });
      }
    }
    vi.stubGlobal('Notification', FakeNotification);
    const client = fakeClient();
    const storage = fakeStorage({ 'notif:toasts-enabled': '1' });
    await startConcordNotifications({ client, storage, pubkey: ME });
    await flush();
    client.timeline$.next([rumor({ created_at: 100 })]);

    setActiveConcordChannel(CID, CH); // jsdom tab is 'visible'
    const fresh = Math.floor(Date.now() / 1000) + 10;
    client.timeline$.next([rumor({ created_at: fresh }), rumor({ created_at: 100 })]);
    expect(created).toHaveLength(0);

    clearActiveConcordChannel();
    await setChannelLevel(CID, CH, 'nothing');
    client.timeline$.next([rumor({ created_at: fresh + 5 }), rumor({ created_at: 100 })]);
    expect(created).toHaveLength(0);
    vi.unstubAllGlobals();
  });
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm vitest run src/lib/__tests__/concord-notifications.svelte.test.js`
Expected: the two new tests FAIL (no toasts fire — `maybeToast` is a stub).

- [ ] **Step 4: Implement the dispatcher**

In `src/lib/concord/notifications.svelte.js`:

Add imports:

```js
import { resolveLevel, shouldToast } from './notification-helpers.js'; // merge into the existing helper import
import { goto } from '$app/navigation';
import { getProfileContent } from 'applesauce-core/helpers';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { getUserDisplayName } from '$lib/helpers/message-utils.js';
import * as m from '$lib/paraglide/messages';
```

Add near the other plain lets:

```js
/** @type {Map<string, number>} */
let lastToastAt = new Map();
```

(clear it in `stopConcordNotifications()`: `lastToastAt = new Map();`)

Replace the `maybeToast` stub:

```js
/**
 * Foreground OS toast (spec §6). Content stays minimal — channel/community
 * names and the sender's display name only, never message text (OS
 * notification centers persist content, which conflicts with sealed
 * channels). The Notification `tag` collapses bursts per channel; the pure
 * shouldToast() gate carries every suppression rule and is unit-tested in
 * concord-notification-helpers.test.js.
 * @param {string} communityId @param {string} channelId @param {any[]} rumors
 * @param {ChannelSummary | undefined} prev @param {ChannelSummary} summary
 */
function maybeToast(communityId, channelId, rumors, prev, summary) {
  if (typeof Notification === 'undefined') return;
  if (!prev) return; // first fold for this channel = cache replay
  if (summary.latestFromOthers <= prev.latestFromOthers) return;
  const newest = (rumors ?? []).find((r) => r?.pubkey && r.pubkey !== myPubkey); // newest-first
  if (!newest) return;
  const isMention = (newest.tags ?? []).some((t) => t?.[0] === 'p' && t?.[1] === myPubkey);
  const active = getActiveConcordChannel();
  const fire = shouldToast({
    createdAt: newest.created_at ?? 0,
    isMention,
    level: resolveLevel(levels, communityId, channelId),
    enabled: toastsEnabled,
    permissionGranted: Notification.permission === 'granted',
    tabVisible: typeof document !== 'undefined' && document.visibilityState === 'visible',
    isActiveChannel: active?.communityId === communityId && active?.channelId === channelId,
    marker: readMarkers[markerKey(communityId, channelId)] ?? 0,
    startTime,
    lastToastAt: lastToastAt.get(channelId) ?? 0,
    now: Date.now()
  });
  if (!fire) return;
  lastToastAt.set(channelId, Date.now());
  const watcher = watchers.get(communityId);
  const channelName = watcher?.channelNames.get(channelId) || '#';
  const communityName = watcher?.communityName || '';
  let profile;
  try {
    const profileEvent = eventStore.getReplaceable(0, newest.pubkey);
    profile = profileEvent ? getProfileContent(profileEvent) : undefined;
  } catch {
    profile = undefined;
  }
  const displayName = getUserDisplayName(newest.pubkey, profile);
  const notification = new Notification(
    communityName ? `${channelName} · ${communityName}` : channelName,
    { body: m.concord_notif_toast_body({ name: displayName }), tag: `concord-${channelId}` }
  );
  notification.onclick = () => {
    window.focus();
    goto(`/private/${communityId}?channel=${channelId}`);
  };
}
```

Also apply the Task 3 note: `setToastsEnabled` must write the RAW `'1'`/`'0'` string (not JSON) so the loader's `enabledRaw === '1'` check matches.

If the imports of `eventStore`/`message-utils`/`paraglide` make the Task 3 unit test fail on unresolved SvelteKit modules (`$app/navigation`), add the standard mock at the top of the test file:

```js
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
```

(check how other tests in `src/lib/__tests__/` mock `$app/*` and follow that pattern).

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run src/lib/__tests__/concord-notifications.svelte.test.js src/lib/__tests__/concord-notification-helpers.test.js`
Expected: PASS.

- [ ] **Step 6: Bell toggle in PrivateChannelsView**

In the rail header (line 127-132), extend the right side:

```svelte
      <div class="flex items-center justify-between px-2 pt-2 pb-1">
        <span class="text-xs font-bold tracking-wider text-base-content/60 uppercase"
          >{m.concord_rail_channels()}</span
        >
        <span class="flex items-center gap-1">
          {#if notificationSupported}
            <button
              class="btn btn-circle btn-ghost btn-xs"
              data-testid="concord-notif-bell"
              disabled={permissionDenied}
              title={permissionDenied
                ? m.concord_notif_bell_denied()
                : toastsOn
                  ? m.concord_notif_bell_on()
                  : m.concord_notif_bell_off()}
              onclick={toggleToasts}
            >
              {toastsOn ? '🔔' : '🔕'}
            </button>
          {/if}
          <span class="badge badge-xs font-bold uppercase badge-accent">Beta</span>
        </span>
      </div>
```

Script additions:

```js
  import {
    channelUnreadState,
    markChannelRead,
    getToastsEnabled,
    setToastsEnabled
  } from '$lib/concord/notifications.svelte.js';

  // Notification API state. permissionDenied is a $state refreshed on toggle
  // attempts — the browser offers no permission-change event worth polling.
  const notificationSupported = typeof Notification !== 'undefined';
  let permissionDenied = $state(notificationSupported && Notification.permission === 'denied');
  const toastsOn = $derived(getToastsEnabled());

  async function toggleToasts() {
    if (getToastsEnabled()) {
      await setToastsEnabled(false);
      return;
    }
    if (Notification.permission !== 'granted') {
      const permission = await Notification.requestPermission();
      permissionDenied = permission === 'denied';
      if (permission !== 'granted') return;
    }
    await setToastsEnabled(true);
  }
```

(merge the import line with Task 5's existing import from `notifications.svelte.js`).

- [ ] **Step 7: Level menu in ChannelChat's ⋯ dropdown**

In `ChannelChat.svelte`, add to the imports from Task 7/8 block:

```js
  import { getChannelLevel, setChannelLevel } from '$lib/concord/notifications.svelte.js';
```

Add script state (needs the community id — `community.material.community_id`):

```js
  const communityId = $derived(community?.material?.community_id ?? '');
  const notifLevel = $derived(getChannelLevel(communityId, channel.channel_id));
  const LEVELS = /** @type {const} */ ([
    ['all', m.concord_notif_level_all],
    ['mentions', m.concord_notif_level_mentions],
    ['nothing', m.concord_notif_level_nothing]
  ]);
```

In the dropdown `<ul>` (after the backup `<li>`, before the owner-only dissolve block, ~line 219):

```svelte
        <li class="menu-title text-xs">{m.concord_notif_level_label()}</li>
        {#each LEVELS as [level, label] (level)}
          <li>
            <button
              class={notifLevel === level ? 'active' : ''}
              onclick={() => setChannelLevel(communityId, channel.channel_id, level)}
            >
              {notifLevel === level ? '✓' : ''} {label()}
            </button>
          </li>
        {/each}
```

- [ ] **Step 8: Verify + commit**

```bash
pnpm run lint && pnpm run check
pnpm vitest run src/lib/__tests__ src/lib/components/__tests__/ConcordUnreadDot.test.js src/lib/components/__tests__/MentionAutocomplete.test.js
git add src/lib/concord/notifications.svelte.js \
  src/lib/__tests__/concord-notifications.svelte.test.js \
  src/lib/components/community/channels/PrivateChannelsView.svelte \
  src/lib/components/community/channels/ChannelChat.svelte \
  messages/en.json messages/de.json
git commit -m "feat(concord): foreground OS toasts with bell toggle + per-channel levels"
```

---

### Task 10: E2E flow + coverage doc

**Files:**
- Create: `e2e/concord-notifications.test.js`
- Modify: `e2e/COVERAGE.md`

**Interfaces:**
- Consumes: the two-account fixtures/patterns in `e2e/concord-channels.test.js` (invite round trip — READ THAT FILE FIRST and reuse its helpers for founding a community, creating a channel, inviting + accepting with a second account, and its selector conventions, e.g. scoping to `.first()` because of the responsive double-mount).
- Produces: one E2E spec covering: unread dot appears → clears on open → stays cleared after reload → mention pill on reply.

- [ ] **Step 1: Read the existing Concord e2e**

Read `e2e/concord-channels.test.js` fully. Extract: how it obtains two authenticated pages (account A and B), how it founds an area + channel, how the invite round trip works, timeouts used, and any relay/env preconditions (nix shell, `CONCORD_ENABLED`). Do not proceed until the existing file's flow is understood — this test reuses it wholesale.

- [ ] **Step 2: Write `e2e/concord-notifications.test.js`**

Structure (adapt helper names to what Step 1 found — the assertions below are the contract):

```js
// E2E: Concord unread badges + mention tier (spec §8 — the ONE e2e flow).
// OS toasts are deliberately NOT tested here (headless Notification API is
// unreliable); their gate logic is unit-tested in
// concord-notification-helpers.test.js.
import { test, expect } from './fixtures.js'; // ← match concord-channels.test.js's import

test.describe('Concord notifications', () => {
  test('unread dot lights, clears on open, survives reload; reply lights mention pill', async ({
    /* two-account fixtures as in concord-channels.test.js */
  }) => {
    // 1. A founds an area + channel, invites B, B accepts (reuse existing flow).
    // 2. B sends a message while A is NOT viewing the channel (A navigates to
    //    the community Home tab first).
    // 3. A's Kanäle tab shows the neutral dot:
    //    await expect(pageA.locator('[data-testid="concord-unread-dot"]').first()).toBeVisible();
    // 4. A opens the channels tab + the channel → dot disappears:
    //    await expect(pageA.locator('[data-testid="concord-unread-dot"]')).toHaveCount(0);
    // 5. A reloads the page, reopens the community → still no dot (markers
    //    persisted in IDB).
    // 6. A sends a message; B replies to A's message (existing reply UI);
    //    A (on Home tab) now sees the mention pill:
    //    await expect(pageA.locator('[data-testid="concord-mention-pill"]').first()).toBeVisible();
  });
});
```

Fill in the real steps from the patterns found in Step 1. Keep it ONE test (serial flow) to avoid fixture cost; use the same generous timeouts as the existing Concord e2e.

- [ ] **Step 3: Run it (nix shell required)**

Run: `pnpm run test:e2e -- concord-notifications`
Expected: PASS. Also run the existing `pnpm run test:e2e -- concord-channels` to confirm no regression from the ChannelChat/PrivateChannelsView changes (a pre-existing chat-posting flake is documented in the progress ledger — verify any failure is that same flake by re-running, and by checking it fails identically on the base commit).

- [ ] **Step 4: Update `e2e/COVERAGE.md`**

Add a row/section for `concord-notifications.test.js` describing the covered flow (unread dot lifecycle + mention pill) and the explicit non-goal (OS toasts — unit-tested gate only).

- [ ] **Step 5: Commit**

```bash
git add e2e/concord-notifications.test.js e2e/COVERAGE.md
git commit -m "test(concord): e2e unread/mention badge flow"
```

---

### Task 11: Docs + verification sweep

**Files:**
- Modify: `CLAUDE.md` (Concord section)
- Verify: full test suite, dev-server smoke

- [ ] **Step 1: Update CLAUDE.md's Concord section**

Extend the lockstep-pin sentence to name all THREE aliases (`applesauce-concord`, `applesauce-core-concord`, `applesauce-common-concord` — bump together). Add two bullets:

```markdown
- Notifications/read-state (spec 2026-07-24): local-only per device, in the
  per-account Concord IDB `kv` store (keys `notif:read`, `notif:mention-read`,
  `notif:levels`, `notif:toasts-enabled`). Central service
  `src/lib/concord/notifications.svelte.js` (started with the client); badge
  components read `channelUnreadState`/`areaUnreadState` getters. Do NOT sync
  Concord read-state via NIP-78 — deliberate metadata-leak avoidance
  (mirrors Armada).
- Concord replies must go through `sendChannelMessage`
  (src/lib/concord/send-message.js), not community.sendMessage — the dist
  omits the reply `p` tag that the mention tier depends on.
```

- [ ] **Step 2: Full suite + lint + check**

```bash
pnpm run lint && pnpm run check && pnpm test
```

Expected: green except the memory-documented pre-existing flakes (inbox/DM parallel-run files, GlobalFAB exit). Any NEW failure must be fixed before proceeding.

- [ ] **Step 3: Live smoke (verify skill)**

With the dev server (verify which server answers the port — stale worktree servers squat 5199+ per project memory): two browser profiles, confirm badges light/clear and a toast fires with the tab in the background after enabling the bell. Screenshot the unread + mention states (all visual states — per project feedback memory) into the gitignored screenshot dir.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(concord): notifications service + triple lockstep pin"
```

---

## Self-Review Results

- **Spec coverage:** §1 data model → Tasks 1/3; §2 service → Tasks 3/4; §3 active channel → Tasks 2/5; §4 surfaces → Tasks 5/6; §5 mention producers → Tasks 7/8 (rendering pre-exists in NostrContentRenderer, verified Task 8 Step 9); §6 toasts → Task 9 (deep link Task 5); §7 edge cases → helpers (clock skew via monotonic max in markChannelRead; kv failure via persist catch + `.catch(() => null)` loads; gone channels via fold-drop + pruneMarkers + mention-read gate); §8 testing → per-task + Task 10.
- **Known judgment calls for the implementer:** (a) toast deep link goes to `/private/<id>` even for linked communities — accepted simplification, the standalone route renders any membership; (b) `deriveVisibleChannels` import into the service couples it to `community.svelte.js` — acceptable, same directory, already SSR-clean; (c) area-level dots for LINKED communities appear only via the Kanäle tab + CommunitySidebar sites where a Concord pointer is resolvable.
