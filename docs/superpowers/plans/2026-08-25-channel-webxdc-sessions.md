# Channel Webxdc Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Launch webxdc apps (flagship: collaborative Yjs pad) inside NIP-29 channels with shared relay-backed state, an apps bar, and publish-snapshot export.

**Architecture:** Kind-9 chat messages carry the app as an NIP-92 `imeta` attachment with a session UUID (`webxdc` property); durable state = kind 9450, ephemeral realtime = kind 24450, both `["h", groupId]` + `["i", sessionId]` on the groups relay (Armada-compatible). A new `group-sync.js` implements the existing `AppSync` interface; `WebxdcPlayer` gets an injectable `sync`. Export rides the standard webxdc `sendToChat` API into the article/wiki create flow.

**Tech Stack:** SvelteKit + Svelte 5 runes, applesauce-relay (pool.relay subscriptions), Vitest (node + jsdom), paraglide i18n.

**Spec:** `docs/superpowers/specs/2026-08-25-channel-webxdc-sessions-design.md`

## Global Constraints

- Base branch: `feat/community-group-pointer` (this worktree already sits on it).
- Worktree setup before first task: `pnpm install` (husky/lint-staged need local node_modules) and copy `.env` from the main checkout (`cp /home/laoc/coding/edufeed/edufeed-app/.env .`).
- All state/realtime publishes go through `publishToGroupRelay` / GroupChat's `signAndPublish` — never outbox relays.
- `getUpdates()` MUST be append-only in arrival order (serials = array index + 1); never re-sort after listeners attach (`src/lib/webxdc/local-sync.js:6-11`).
- Every user-facing string is a paraglide message added to BOTH `messages/en.json` and `messages/de.json` (never put `@` directly before a `{param}` in a message value).
- Event arrays holding relay events use `$state.raw()`.
- Run targeted tests per task with `pnpm vitest run <file>`; full `pnpm test` only in the final task (paraglide HMR storm — warn user if a dev server is open).
- DaisyUI: `btn-sm` default chrome, `btn-xs` only for icon chrome; small dialogs = `modal-box max-w-sm`.
- Kind constants: 9450 durable state, 24450 ephemeral realtime, mime `application/x-webxdc`.

---

### Task 0: Worktree setup

**Files:** none (environment only)

- [ ] **Step 1:** `pnpm install` in the worktree root.
- [ ] **Step 2:** `cp /home/laoc/coding/edufeed/edufeed-app/.env .` (gitignored, needed for dev-server verification later).
- [ ] **Step 3:** Baseline: `pnpm vitest run src/lib/webxdc/__tests__/ src/lib/__tests__/concord-attachments.test.js src/lib/__tests__/groups-helpers.test.js` — all pass before any change.

---

### Task 1: Shared imeta parser (+ `webxdc` property)

Move the generic NIP-92 parser out of the Concord namespace so the NIP-29 lane can use it, and teach it the `webxdc` session property.

**Files:**
- Create: `src/lib/helpers/imeta.js`
- Modify: `src/lib/concord/attachments.js` (becomes a re-export shim)
- Test: `src/lib/__tests__/imeta.test.js` (new), `src/lib/__tests__/concord-attachments.test.js` (stays green, untouched)

**Interfaces:**
- Produces: `getMessageAttachments(message) => MediaAttachment[]`, `classifyAttachment(att)`, `stripAttachmentUrls(content, attachments)` from `$lib/helpers/imeta.js`. `MediaAttachment` gains optional `webxdc?: string` (session UUID).

- [ ] **Step 1: Write the failing test** — `src/lib/__tests__/imeta.test.js`:

```js
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { getMessageAttachments, classifyAttachment } from '$lib/helpers/imeta.js';

const xdcTag = [
  'imeta',
  'url https://blossom.example/abc.xdc',
  'm application/x-webxdc',
  'x ' + 'a'.repeat(64),
  'image https://blossom.example/icon.png',
  'webxdc 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'
];

describe('shared imeta parser', () => {
  it('parses the webxdc session property', () => {
    const [att] = getMessageAttachments({ tags: [xdcTag] });
    expect(att.url).toBe('https://blossom.example/abc.xdc');
    expect(att.type).toBe('application/x-webxdc');
    expect(att.sha256).toBe('a'.repeat(64));
    expect(att.image).toBe('https://blossom.example/icon.png');
    expect(att.webxdc).toBe('9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d');
  });
  it('classifies x-webxdc as file', () => {
    expect(classifyAttachment({ type: 'application/x-webxdc' })).toBe('file');
  });
  it('is null-safe', () => {
    expect(getMessageAttachments(null)).toEqual([]);
  });
});
```

- [ ] **Step 2:** `pnpm vitest run src/lib/__tests__/imeta.test.js` — FAIL (module not found).
- [ ] **Step 3: Implement** — move the ENTIRE current content of `src/lib/concord/attachments.js` to `src/lib/helpers/imeta.js` (keep `parseEncryption` — it is inert for non-Concord callers and keeps the shim a pure re-export). In `parseImetaTag`, after the `blurhash` line add:

```js
  if (entry.webxdc) att.webxdc = entry.webxdc;
```

Add `webxdc?: string` to the `MediaAttachment` typedef. Update the header comment: this is the shared NIP-92 parser; Concord's encryption fields are parsed here too so `src/lib/concord/attachments.js` can stay a re-export.

Replace `src/lib/concord/attachments.js` body with:

```js
// Shared NIP-92 imeta parsing moved to $lib/helpers/imeta.js so the NIP-29
// lane can use it without importing from the Concord namespace. This shim
// keeps the historical import path for ChannelChat + existing tests.
export {
  getMessageAttachments,
  classifyAttachment,
  stripAttachmentUrls
} from '$lib/helpers/imeta.js';
```

(If `concord-attachments.test.js` imports non-exported internals, re-export those too — check first.)

- [ ] **Step 4:** `pnpm vitest run src/lib/__tests__/imeta.test.js src/lib/__tests__/concord-attachments.test.js` — both PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "refactor(imeta): shared NIP-92 parser in helpers, learns webxdc session property"`

---

### Task 2: Session event builders (`session-events.js`)

Pure builders/parsers for the wire format — no relay code, fully unit-tested.

**Files:**
- Create: `src/lib/webxdc/session-events.js`
- Test: `src/lib/webxdc/__tests__/session-events.test.js`

**Interfaces (produced, used by Tasks 3, 5, 6, 7, 9):**

```js
export const WEBXDC_STATE_KIND = 9450;
export const WEBXDC_REALTIME_KIND = 24450;
export const WEBXDC_MIME = 'application/x-webxdc';
mintSessionId() => string                       // crypto.randomUUID()
buildAppShareTemplate(groupId, app, sessionId)  // app = {url, sha256, name, iconUrl}
  => kind-9 template {kind, content, created_at, tags} with ['h',groupId] + imeta tag
buildStateTemplate(groupId, sessionId, payload, meta?) => kind-9450 template
buildRealtimeTemplate(groupId, sessionId, bytes /* Uint8Array */) => kind-24450 template
parseStateEvent(event) => {payload, info?, document?, summary?} | null
parseRealtimeEvent(event) => Uint8Array | null
getWebxdcAttachment(message) => (MediaAttachment & {webxdc: string}) | null
deriveSessions(messages) => Array<{sessionId, app: {url, sha256, name, iconUrl}, messageId, created_at}>
```

- [ ] **Step 1: Write the failing test** — `src/lib/webxdc/__tests__/session-events.test.js`:

```js
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  WEBXDC_STATE_KIND,
  WEBXDC_REALTIME_KIND,
  mintSessionId,
  buildAppShareTemplate,
  buildStateTemplate,
  buildRealtimeTemplate,
  parseStateEvent,
  parseRealtimeEvent,
  getWebxdcAttachment,
  deriveSessions
} from '../session-events.js';

const app = {
  url: 'https://blossom.example/abc.xdc',
  sha256: 'a'.repeat(64),
  name: 'Pad',
  iconUrl: 'https://blossom.example/icon.png'
};
const GROUP = 'deadbeef00000000';
const SID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

describe('buildAppShareTemplate', () => {
  it('builds a kind-9 with h + imeta carrying the session uuid', () => {
    const t = buildAppShareTemplate(GROUP, app, SID);
    expect(t.kind).toBe(9);
    expect(t.tags[0]).toEqual(['h', GROUP]);
    const imeta = t.tags.find((tag) => tag[0] === 'imeta');
    expect(imeta).toContain(`url ${app.url}`);
    expect(imeta).toContain('m application/x-webxdc');
    expect(imeta).toContain(`x ${app.sha256}`);
    expect(imeta).toContain(`image ${app.iconUrl}`);
    expect(imeta).toContain(`alt Webxdc app: ${app.name}`);
    expect(imeta).toContain(`webxdc ${SID}`);
    expect(t.content).toContain(app.url); // clients without imeta support see the link
  });
  it('round-trips through getWebxdcAttachment', () => {
    const att = getWebxdcAttachment(buildAppShareTemplate(GROUP, app, SID));
    expect(att).toMatchObject({ url: app.url, sha256: app.sha256, webxdc: SID });
  });
  it('getWebxdcAttachment ignores non-xdc and session-less imeta', () => {
    expect(getWebxdcAttachment({ tags: [['imeta', 'url https://x/y.png', 'm image/png']] })).toBe(
      null
    );
    expect(
      getWebxdcAttachment({ tags: [['imeta', `url ${app.url}`, 'm application/x-webxdc']] })
    ).toBe(null);
  });
});

describe('state events', () => {
  it('builds and parses a 9450 with meta tags', () => {
    const t = buildStateTemplate(GROUP, SID, { move: 'e2e4' }, { info: 'White moved', summary: '1 move' });
    expect(t.kind).toBe(WEBXDC_STATE_KIND);
    expect(t.tags).toContainEqual(['h', GROUP]);
    expect(t.tags).toContainEqual(['i', SID]);
    const parsed = parseStateEvent(t);
    expect(parsed).toEqual({ payload: { move: 'e2e4' }, info: 'White moved', summary: '1 move' });
  });
  it('omits absent meta tags and survives bad JSON', () => {
    const t = buildStateTemplate(GROUP, SID, 42);
    expect(t.tags.find((tag) => tag[0] === 'info')).toBeUndefined();
    expect(parseStateEvent({ ...t, content: '{not json' })).toBe(null);
  });
});

describe('realtime events', () => {
  it('round-trips bytes through base64', () => {
    const bytes = Uint8Array.from([0, 1, 2, 250, 255]);
    const t = buildRealtimeTemplate(GROUP, SID, bytes);
    expect(t.kind).toBe(WEBXDC_REALTIME_KIND);
    expect(parseRealtimeEvent(t)).toEqual(bytes);
  });
});

describe('deriveSessions', () => {
  it('lists newest-first, one entry per session uuid', () => {
    const m1 = { ...buildAppShareTemplate(GROUP, app, SID), id: 'm1', created_at: 100 };
    const m2 = { ...buildAppShareTemplate(GROUP, app, mintSessionId()), id: 'm2', created_at: 200 };
    const plain = { id: 'm3', created_at: 300, tags: [['h', GROUP]] };
    const sessions = deriveSessions([plain, m1, m2]);
    expect(sessions.map((s) => s.messageId)).toEqual(['m2', 'm1']);
    expect(sessions[1]).toMatchObject({ sessionId: SID, app: { name: app.name } });
  });
});
```

- [ ] **Step 2:** `pnpm vitest run src/lib/webxdc/__tests__/session-events.test.js` — FAIL.
- [ ] **Step 3: Implement** `src/lib/webxdc/session-events.js`:

```js
/**
 * Wire format for shared webxdc sessions in NIP-29 channels (spec
 * 2026-08-25-channel-webxdc-sessions-design.md). Armada-compatible: durable
 * state kind 9450, ephemeral realtime 24450, both scoped ["h", groupId] +
 * ["i", sessionId]; the session is minted into a kind-9 imeta attachment.
 */
import { getMessageAttachments } from '$lib/helpers/imeta.js';

export const WEBXDC_STATE_KIND = 9450;
export const WEBXDC_REALTIME_KIND = 24450;
export const WEBXDC_MIME = 'application/x-webxdc';

const now = () => Math.floor(Date.now() / 1000);

export function mintSessionId() {
  return crypto.randomUUID();
}

/**
 * @param {string} groupId
 * @param {{url: string, sha256: string, name?: string, iconUrl?: string}} app
 * @param {string} sessionId
 */
export function buildAppShareTemplate(groupId, app, sessionId) {
  const imeta = ['imeta', `url ${app.url}`, `m ${WEBXDC_MIME}`, `x ${app.sha256}`];
  if (app.iconUrl) imeta.push(`image ${app.iconUrl}`);
  if (app.name) imeta.push(`alt Webxdc app: ${app.name}`);
  imeta.push(`webxdc ${sessionId}`);
  return { kind: 9, content: app.url, created_at: now(), tags: [['h', groupId], imeta] };
}

/**
 * @param {string} groupId @param {string} sessionId @param {any} payload
 * @param {{info?:*, document?:*, summary?:*}} [meta]
 */
export function buildStateTemplate(groupId, sessionId, payload, meta) {
  const tags = [
    ['h', groupId],
    ['i', sessionId]
  ];
  for (const key of ['info', 'document', 'summary']) {
    if (meta?.[key] !== undefined) tags.push([key, String(meta[key])]);
  }
  return { kind: WEBXDC_STATE_KIND, content: JSON.stringify(payload ?? null), created_at: now(), tags };
}

/** @param {string} groupId @param {string} sessionId @param {Uint8Array} bytes */
export function buildRealtimeTemplate(groupId, sessionId, bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return {
    kind: WEBXDC_REALTIME_KIND,
    content: btoa(bin),
    created_at: now(),
    tags: [
      ['h', groupId],
      ['i', sessionId]
    ]
  };
}

/** @param {{kind?: number, content?: string, tags?: string[][]}} event */
export function parseStateEvent(event) {
  if (event?.kind !== WEBXDC_STATE_KIND) return null;
  let payload;
  try {
    payload = JSON.parse(event.content ?? '');
  } catch {
    return null;
  }
  const out = { payload };
  for (const key of ['info', 'document', 'summary']) {
    const tag = event.tags?.find((t) => t[0] === key);
    if (tag) out[key] = tag[1];
  }
  return out;
}

/** @param {{kind?: number, content?: string}} event @returns {Uint8Array | null} */
export function parseRealtimeEvent(event) {
  if (event?.kind !== WEBXDC_REALTIME_KIND) return null;
  try {
    const bin = atob(event.content ?? '');
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * First launchable webxdc attachment on a chat message: must carry the
 * x-webxdc mime AND a session uuid (imeta `webxdc` property) — an attachment
 * without a session can't sync, so it isn't a launch card.
 * @param {{tags?: string[][]} | null | undefined} message
 */
export function getWebxdcAttachment(message) {
  for (const att of getMessageAttachments(message)) {
    if (att.type === WEBXDC_MIME && att.webxdc && att.url && att.sha256) {
      return /** @type {any} */ (att);
    }
  }
  return null;
}

/**
 * Channel session list for the apps bar, newest share first, deduped by
 * session uuid (a re-share of the same message id cannot happen; the same
 * uuid appearing twice keeps the newest message).
 * @param {Array<{id: string, created_at: number, tags?: string[][]}>} messages
 */
export function deriveSessions(messages) {
  const byId = new Map();
  const sorted = [...messages].sort((a, b) => b.created_at - a.created_at);
  for (const msg of sorted) {
    const att = getWebxdcAttachment(msg);
    if (!att || byId.has(att.webxdc)) continue;
    byId.set(att.webxdc, {
      sessionId: att.webxdc,
      app: {
        url: att.url,
        sha256: att.sha256,
        name: att.alt?.replace(/^Webxdc app: /, '') || '',
        iconUrl: att.image || ''
      },
      messageId: msg.id,
      created_at: msg.created_at
    });
  }
  return [...byId.values()];
}
```

- [ ] **Step 4:** `pnpm vitest run src/lib/webxdc/__tests__/session-events.test.js` — PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(webxdc): session event builders for channel sessions (9450/24450, imeta)"`

---

### Task 3: Relay-backed AppSync (`group-sync.js`)

**Files:**
- Create: `src/lib/webxdc/group-sync.js`
- Test: `src/lib/webxdc/__tests__/group-sync.test.js`

**Interfaces:**
- Consumes: builders/parsers from Task 2; a `relayConn` (applesauce `pool.relay(url)`) whose `.subscription(filters)` observable emits events and the literal string `'EOSE'`; a `publish(template) => Promise<signedEvent>` callback (GroupChat's `signAndPublish`).
- Produces: `createGroupSync({ relayConn, groupId, sessionId, publish, onError }) => AppSync & { stop(): void }`.

Behavior (spec §4): buffer 9450s until `'EOSE'`; then sort ONCE by `created_at` (tie-break: lexicographic `id`), freeze as the initial array, notify; afterwards append in arrival order, dedupe by event id. Own publishes append optimistically on resolve (deduped against a possible earlier relay echo). Realtime: 24450 subscription started lazily by `onRealtime`, own echoes skipped via a sent-id set. `stop()` tears both subscriptions down.

- [ ] **Step 1: Write the failing test** — `src/lib/webxdc/__tests__/group-sync.test.js`:

```js
/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { Subject } from 'rxjs';
import { createGroupSync } from '../group-sync.js';
import { buildStateTemplate, buildRealtimeTemplate } from '../session-events.js';

const GROUP = 'deadbeef00000000';
const SID = 'session-uuid-1';

function makeRelay() {
  const subjects = [];
  return {
    subjects,
    subscription: vi.fn(() => {
      const s = new Subject();
      subjects.push(s);
      return s.asObservable();
    })
  };
}
const stateEv = (id, created_at, payload) => ({
  ...buildStateTemplate(GROUP, SID, payload),
  id,
  created_at
});

describe('createGroupSync', () => {
  it('freezes backfill sorted by created_at, then appends live in arrival order', async () => {
    const relay = makeRelay();
    let seq = 0;
    const publish = vi.fn(async (t) => ({ ...t, id: `own${++seq}` }));
    const sync = createGroupSync({ relayConn: relay, groupId: GROUP, sessionId: SID, publish });
    const notified = vi.fn();
    sync.subscribe(notified);

    const s = relay.subjects[0];
    s.next(stateEv('b', 200, 2)); // out of order on purpose
    s.next(stateEv('a', 100, 1));
    expect(sync.getUpdates()).toEqual([]); // nothing before EOSE
    s.next('EOSE');
    expect(sync.getUpdates().map((u) => u.payload)).toEqual([1, 2]);
    expect(notified).toHaveBeenCalledTimes(1);

    s.next(stateEv('c', 150, 3)); // older timestamp, arrives late → APPENDED
    expect(sync.getUpdates().map((u) => u.payload)).toEqual([1, 2, 3]);
    s.next(stateEv('c', 150, 3)); // duplicate id ignored
    expect(sync.getUpdates()).toHaveLength(3);
  });

  it('sendState publishes and appends optimistically, deduped against echo', async () => {
    const relay = makeRelay();
    const publish = vi.fn(async (t) => ({ ...t, id: 'own1' }));
    const sync = createGroupSync({ relayConn: relay, groupId: GROUP, sessionId: SID, publish });
    relay.subjects[0].next('EOSE');
    sync.sendState({ x: 1 }, { info: 'hi' });
    await vi.waitFor(() => expect(sync.getUpdates()).toHaveLength(1));
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 9450, tags: expect.arrayContaining([['i', SID]]) })
    );
    relay.subjects[0].next({ ...publish.mock.results[0].value, id: 'own1', kind: 9450 });
    await Promise.resolve();
    expect(sync.getUpdates()).toHaveLength(1); // echo deduped
  });

  it('reports publish failures via onError', async () => {
    const relay = makeRelay();
    const onError = vi.fn();
    const publish = vi.fn(async () => {
      throw new Error('restricted: not a member');
    });
    const sync = createGroupSync({ relayConn: relay, groupId: GROUP, sessionId: SID, publish, onError });
    relay.subjects[0].next('EOSE');
    sync.sendState({ x: 1 });
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(sync.getUpdates()).toHaveLength(0);
  });

  it('realtime: lazy 24450 subscription, own frames skipped', async () => {
    const relay = makeRelay();
    let seq = 0;
    const publish = vi.fn(async (t) => ({ ...t, id: `rt${++seq}` }));
    const sync = createGroupSync({ relayConn: relay, groupId: GROUP, sessionId: SID, publish });
    relay.subjects[0].next('EOSE');
    expect(relay.subjects).toHaveLength(1); // no realtime sub yet

    const frames = [];
    const off = sync.onRealtime((bytes) => frames.push([...bytes]));
    expect(relay.subjects).toHaveLength(2);
    sync.sendRealtime(Uint8Array.from([7]));
    await vi.waitFor(() => expect(publish).toHaveBeenCalled());
    relay.subjects[1].next({ ...buildRealtimeTemplate(GROUP, SID, Uint8Array.from([7])), id: 'rt1' });
    relay.subjects[1].next({ ...buildRealtimeTemplate(GROUP, SID, Uint8Array.from([9])), id: 'peer' });
    expect(frames).toEqual([[9]]); // own echo (id rt1) skipped
    off();
  });
});
```

- [ ] **Step 2:** Run — FAIL (module not found).
- [ ] **Step 3: Implement** `src/lib/webxdc/group-sync.js`:

```js
/**
 * Relay-backed AppSync for shared channel sessions (spec §4). The append-only
 * contract from local-sync.js is preserved: one sort at EOSE, then arrival
 * order forever — a late 9450 with an older created_at is APPENDED, never
 * spliced (CRDT payloads are commutative; serials must not reshuffle).
 * Auth: relies on the caller's proactive authenticateOnce on the same
 * relayConn (GroupChat does this on mount) — NIP-42 is per-connection.
 */
import {
  WEBXDC_STATE_KIND,
  WEBXDC_REALTIME_KIND,
  buildStateTemplate,
  buildRealtimeTemplate,
  parseStateEvent,
  parseRealtimeEvent
} from './session-events.js';

/**
 * @param {{relayConn: any, groupId: string, sessionId: string,
 *          publish: (template: any) => Promise<any>,
 *          onError?: (err: unknown) => void}} args
 * @returns {import('./local-sync.js').AppSync & {stop: () => void}}
 */
export function createGroupSync({ relayConn, groupId, sessionId, publish, onError }) {
  /** @type {Array<{payload:any, info?:*, document?:*, summary?:*}>} */
  let updates = [];
  const seenIds = new Set();
  /** @type {any[]} */
  let pending = [];
  let synced = false;
  const subscribers = new Set();
  const sentRealtimeIds = new Set();

  const notify = () => {
    for (const cb of subscribers) {
      try {
        cb();
      } catch (err) {
        console.error('webxdc group-sync subscriber failed:', err);
      }
    }
  };

  /** @param {any} event */
  const append = (event) => {
    if (!event?.id || seenIds.has(event.id)) return false;
    const parsed = parseStateEvent(event);
    if (!parsed) return false;
    seenIds.add(event.id);
    updates = [...updates, parsed];
    return true;
  };

  const stateSub = relayConn
    .subscription([{ kinds: [WEBXDC_STATE_KIND], '#h': [groupId], '#i': [sessionId] }])
    .subscribe({
      next: (response) => {
        if (response === 'EOSE') {
          if (synced) return;
          synced = true;
          pending.sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1));
          for (const ev of pending) append(ev);
          pending = [];
          notify();
          return;
        }
        if (!synced) {
          pending.push(response);
          return;
        }
        if (append(response)) notify();
      },
      error: (err) => onError?.(err)
    });

  /** @type {import('rxjs').Subscription | null} */
  let realtimeSub = null;
  const realtimeListeners = new Set();

  return {
    getUpdates: () => [...updates],

    sendState(payload, meta) {
      const template = buildStateTemplate(groupId, sessionId, payload, meta);
      publish(template)
        .then((signed) => {
          if (append(signed)) notify();
        })
        .catch((err) => onError?.(err));
    },

    sendRealtime(bytes) {
      publish(buildRealtimeTemplate(groupId, sessionId, bytes))
        .then((signed) => signed?.id && sentRealtimeIds.add(signed.id))
        .catch((err) => onError?.(err));
    },

    onRealtime(cb) {
      realtimeListeners.add(cb);
      if (!realtimeSub) {
        realtimeSub = relayConn
          .subscription([{ kinds: [WEBXDC_REALTIME_KIND], '#h': [groupId], '#i': [sessionId] }])
          .subscribe({
            next: (response) => {
              if (response === 'EOSE') return;
              if (response?.id && sentRealtimeIds.has(response.id)) return;
              const bytes = parseRealtimeEvent(response);
              if (!bytes) return;
              for (const listener of realtimeListeners) listener(bytes);
            },
            error: (err) => onError?.(err)
          });
      }
      return () => realtimeListeners.delete(cb);
    },

    subscribe(cb) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },

    stop() {
      stateSub.unsubscribe();
      realtimeSub?.unsubscribe();
      realtimeSub = null;
      realtimeListeners.clear();
      subscribers.clear();
    }
  };
}
```

Note for the test's realtime echo: `sendRealtime` resolves `publish` before the frame comes back in the test (the test `await`s the publish call first) — the `sentRealtimeIds.add` happens on resolution, before `subjects[1].next(...)`.

- [ ] **Step 4:** `pnpm vitest run src/lib/webxdc/__tests__/group-sync.test.js` — PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(webxdc): relay-backed AppSync for channel sessions (group-sync)"`

---

### Task 4: Host `sendToChat` + injectable sync in the player

**Files:**
- Modify: `src/lib/webxdc/webxdc-host.js`, `src/lib/webxdc/WebxdcPlayer.svelte`
- Test: `src/lib/webxdc/__tests__/webxdc-host.test.js` (extend)

**Interfaces:**
- `createWebxdcHost(sync, identity, opts = {})` — new third param; `opts.onShareFile?: (file: {name: string, plainText?: string, base64?: string, mime?: string}) => void`. New RPC `webxdc.sendToChat` with params `{file: {name, plainText?, base64?, mime?}}`; throws `'sendToChat is not supported'` when no `onShareFile`, throws `'sendToChat: file name and content required'` on bad payload.
- `WebxdcPlayer.svelte` new props: `sync = null` (an `AppSync`; falls back to `createLocalSync('webxdc:state:' + appKey)`), `onShareFile = null` (forwarded to the host; when null the player provides a browser-download fallback).

- [ ] **Step 1: Write failing tests** — append to `src/lib/webxdc/__tests__/webxdc-host.test.js` (match its existing helper style — it builds a host and calls `handleRpc` directly):

```js
describe('webxdc.sendToChat', () => {
  const identity = { selfAddr: 'npub1x', selfName: 'x' };
  const makeSync = () => ({
    getUpdates: () => [],
    sendState: () => {},
    sendRealtime: () => {},
    onRealtime: () => () => {},
    subscribe: () => () => {}
  });

  it('forwards a validated text file to onShareFile', async () => {
    const onShareFile = vi.fn();
    const host = createWebxdcHost(makeSync(), identity, { onShareFile });
    await host.handleRpc('webxdc.sendToChat', { file: { name: 'Notes.txt', plainText: '# hi' } }, () => {});
    expect(onShareFile).toHaveBeenCalledWith({ name: 'Notes.txt', plainText: '# hi' });
  });

  it('rejects when unsupported or malformed', async () => {
    const host = createWebxdcHost(makeSync(), identity);
    await expect(host.handleRpc('webxdc.sendToChat', { file: { name: 'x', plainText: 'y' } }, () => {})).rejects.toThrow(
      /not supported/
    );
    const host2 = createWebxdcHost(makeSync(), identity, { onShareFile: vi.fn() });
    await expect(host2.handleRpc('webxdc.sendToChat', { file: { name: 'x' } }, () => {})).rejects.toThrow(
      /name and content/
    );
  });

  it('bridge script routes sendToChat through the RPC channel', () => {
    const host = createWebxdcHost(makeSync(), identity, { onShareFile: vi.fn() });
    expect(host.bridgeScript).toContain("request('webxdc.sendToChat'");
    expect(host.bridgeScript).not.toContain('sendToChat is not supported');
  });
});
```

- [ ] **Step 2:** Run `pnpm vitest run src/lib/webxdc/__tests__/webxdc-host.test.js` — new cases FAIL.
- [ ] **Step 3: Implement** in `webxdc-host.js`:
  - Signature: `export function createWebxdcHost(sync, identity, opts = {})`.
  - New RPC case before `default:`:

```js
        case 'webxdc.sendToChat': {
          if (!opts.onShareFile) throw new Error('sendToChat is not supported');
          const file = params?.file ?? {};
          const hasText = typeof file.plainText === 'string';
          const hasBlob = typeof file.base64 === 'string';
          if (typeof file.name !== 'string' || !file.name || (!hasText && !hasBlob)) {
            throw new Error('sendToChat: file name and content required');
          }
          opts.onShareFile({
            name: file.name,
            ...(hasText && { plainText: file.plainText }),
            ...(hasBlob && { base64: file.base64 }),
            ...(typeof file.mime === 'string' && { mime: file.mime })
          });
          return null;
        }
```

  - In `generateBridgeScript`, replace the stubbed `sendToChat` with:

```js
    sendToChat: function (message) {
      return request('webxdc.sendToChat', message || {});
    },
```

  (The bridge always forwards; a host without `onShareFile` rejects the promise — same observable behavior as today.)

  In `WebxdcPlayer.svelte`:
  - Props: `let { url = '', sha256 = '', bytes = null, name = '', iconUrl = '', appKey, sync = null, onShareFile = null } = $props();`
  - In `launch()` replace the two host lines with:

```js
      const appSync = sync ?? createLocalSync(`webxdc:state:${appKey}`);
      host = createWebxdcHost(appSync, identity(), { onShareFile: onShareFile ?? downloadShare });
```

  - Add the download fallback near `identity()`:

```js
  /** Default sendToChat handling outside a channel: save the file locally. */
  function downloadShare(file) {
    const blob = file.plainText
      ? new Blob([file.plainText], { type: 'text/plain' })
      : new Blob([Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0))], {
          type: file.mime || 'application/octet-stream'
        });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(a.href);
  }
```

- [ ] **Step 4:** `pnpm vitest run src/lib/webxdc/__tests__/webxdc-host.test.js src/lib/webxdc/__tests__/local-sync.test.js` — PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(webxdc): sendToChat host support + injectable sync in the player"`

---

### Task 5: Launch card in the chat timeline

**Files:**
- Create: `src/lib/components/groups/WebxdcAttachmentCard.svelte`
- Modify: `src/lib/components/groups/GroupChat.svelte` (pass the `attachments` snippet), `messages/en.json`, `messages/de.json`
- Test: `src/lib/__tests__/webxdc-attachment-card.svelte.test.js`

**Interfaces:**
- `WebxdcAttachmentCard.svelte` props: `{ attachment: {url, sha256, webxdc, alt?, image?}, onLaunch: (attachment) => void }`.
- Consumes: `getWebxdcAttachment(message)` (Task 2).
- Produces for Task 6: GroupChat state `let activeSession = $state.raw(null)` shaped `{ sessionId, app: {url, sha256, name, iconUrl} }` and `openSession(attachment)` setting it.

- [ ] **Step 1: i18n** — add to `messages/en.json`: `"webxdc_session_launch": "Open app"`, `"webxdc_session_shared_app": "Shared app"`; `messages/de.json`: `"webxdc_session_launch": "App öffnen"`, `"webxdc_session_shared_app": "Geteilte App"`. Then `pnpm exec paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide` if the test run doesn't compile automatically (check how existing svelte tests handle messages — they mock `$lib/paraglide/messages`; follow `src/lib/__tests__/groups-unread-markers.svelte.test.js`'s mock pattern).
- [ ] **Step 2: Write the failing component test** — `src/lib/__tests__/webxdc-attachment-card.svelte.test.js` (jsdom, mirror the render setup of `my-groups-empty-list.svelte.test.js`):

```js
/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import WebxdcAttachmentCard from '$lib/components/groups/WebxdcAttachmentCard.svelte';

const attachment = {
  url: 'https://blossom.example/a.xdc',
  sha256: 'a'.repeat(64),
  webxdc: 'uuid-1',
  alt: 'Webxdc app: Pad',
  image: 'https://blossom.example/icon.png'
};

describe('WebxdcAttachmentCard', () => {
  it('shows the app name and launches on click', async () => {
    const onLaunch = vi.fn();
    const { getByRole, getByText } = render(WebxdcAttachmentCard, { attachment, onLaunch });
    expect(getByText('Pad')).toBeTruthy();
    await fireEvent.click(getByRole('button'));
    expect(onLaunch).toHaveBeenCalledWith(attachment);
  });
});
```

(If paraglide messages need mocking in jsdom tests, add the same `vi.mock('$lib/paraglide/messages', ...)` block the groups svelte tests use.)

- [ ] **Step 3:** Run — FAIL. **Step 4: Implement** `WebxdcAttachmentCard.svelte`:

```svelte
<script>
  import * as m from '$lib/paraglide/messages';
  /** @type {{ attachment: any, onLaunch: (att: any) => void }} */
  let { attachment, onLaunch } = $props();
  const appName = $derived(attachment.alt?.replace(/^Webxdc app: /, '') || m.webxdc_session_shared_app());
</script>

<div class="mt-1 flex max-w-xs items-center gap-2 rounded-lg border border-base-300 bg-base-100 p-2">
  <div class="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded bg-primary/10">
    {#if attachment.image}<img src={attachment.image} alt="" class="size-full object-cover" />{:else}▦{/if}
  </div>
  <span class="min-w-0 flex-1 truncate text-sm font-semibold text-base-content">{appName}</span>
  <button type="button" class="btn btn-sm btn-primary" onclick={() => onLaunch(attachment)}>
    {m.webxdc_session_launch()}
  </button>
</div>
```

  In `GroupChat.svelte`: import `WebxdcAttachmentCard` and `getWebxdcAttachment` from `$lib/webxdc/session-events.js`; add state + handler near the other UI state:

```js
  /** @type {{sessionId: string, app: {url: string, sha256: string, name: string, iconUrl: string}} | null} */
  let activeSession = $state.raw(null);
  /** @param {any} att */
  function openSession(att) {
    activeSession = {
      sessionId: att.webxdc,
      app: {
        url: att.url,
        sha256: att.sha256,
        name: att.alt?.replace(/^Webxdc app: /, '') || '',
        iconUrl: att.image || ''
      }
    };
  }
```

  In the `messageRow` snippet, add an `attachments` snippet to `<ChatMessageRow ...>` (after the `reactions` snippet):

```svelte
      {#snippet attachments(/** @type {any} */ msg)}
        {@const xdc = getWebxdcAttachment(msg)}
        {#if xdc}
          <WebxdcAttachmentCard attachment={xdc} onLaunch={openSession} />
        {/if}
      {/snippet}
```

- [ ] **Step 5:** `pnpm vitest run src/lib/__tests__/webxdc-attachment-card.svelte.test.js` — PASS. Also `pnpm vitest run src/lib/__tests__/groups-unread-markers.svelte.test.js` (GroupChat still renders).
- [ ] **Step 6: Commit** — `git commit -am "feat(groups): webxdc launch card on channel messages"`

---

### Task 6: App stage above the timeline

**Files:**
- Create: `src/lib/components/groups/GroupAppStage.svelte`
- Modify: `src/lib/components/groups/GroupChat.svelte`, `messages/en.json`, `messages/de.json`
- Test: `src/lib/__tests__/group-app-stage.svelte.test.js`

**Interfaces:**
- `GroupAppStage.svelte` props: `{ pointer, session /* Task 5 shape */, publish: (template) => Promise<any>, onShareText: (file: {name: string, plainText: string}) => void, onClose: () => void }`.
- Consumes: `createGroupSync` (Task 3), `WebxdcPlayer` `sync`/`onShareFile` props (Task 4), `pool` from `$lib/stores/nostr-infrastructure.svelte` (same import GroupChat uses).

- [ ] **Step 1: i18n** — en: `"webxdc_session_stage_close": "Close app"`, `"webxdc_session_publish_failed": "Could not save app state: {reason}"`; de: `"webxdc_session_stage_close": "App schließen"`, `"webxdc_session_publish_failed": "App-Zustand konnte nicht gespeichert werden: {reason}"`.
- [ ] **Step 2: Write the failing test** — `src/lib/__tests__/group-app-stage.svelte.test.js`: render `GroupAppStage` with a mocked `$lib/stores/nostr-infrastructure.svelte` (`pool.relay()` returning `{ subscription: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }) }` — follow the pool-mock pattern in `src/lib/__tests__/my-groups-relays.svelte.test.js`), assert: (a) it renders the app name and a close button; (b) clicking close calls `onClose`; (c) the player receives a group sync, not local (assert `localStorage` stays empty after mount — no `webxdc:state:` key).
- [ ] **Step 3:** Run — FAIL. **Step 4: Implement**:

```svelte
<script>
  import { onDestroy } from 'svelte';
  import * as m from '$lib/paraglide/messages';
  import { pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { createGroupSync } from '$lib/webxdc/group-sync.js';
  import WebxdcPlayer from '$lib/webxdc/WebxdcPlayer.svelte';

  /** @type {{pointer: any, session: any, publish: (t: any) => Promise<any>,
   *          onShareText: (file: {name: string, plainText: string}) => void,
   *          onClose: () => void}} */
  let { pointer, session, publish, onShareText, onClose } = $props();

  let publishError = $state('');
  const sync = createGroupSync({
    relayConn: pool.relay(pointer.relay),
    groupId: pointer.id,
    sessionId: session.sessionId,
    publish,
    onError: (err) => {
      publishError = err instanceof Error ? err.message : String(err);
    }
  });
  onDestroy(() => sync.stop());

  /** @type {any} */
  let player;
  // Auto-launch: the stage exists because the user clicked Launch already.
  $effect(() => {
    player?.launchApp();
  });

  /** @param {{name: string, plainText?: string, base64?: string, mime?: string}} file */
  function handleShareFile(file) {
    if (typeof file.plainText === 'string') onShareText({ name: file.name, plainText: file.plainText });
    else {
      const blob = new Blob([Uint8Array.from(atob(file.base64 ?? ''), (c) => c.charCodeAt(0))], {
        type: file.mime || 'application/octet-stream'
      });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(a.href);
    }
  }
</script>

<div class="border-b border-base-300 bg-base-200/60 p-2" data-testid="group-app-stage">
  <div class="mb-1 flex items-center gap-2">
    <span class="flex-1 truncate text-sm font-semibold">{session.app.name}</span>
    <button type="button" class="btn btn-xs" onclick={onClose}>{m.webxdc_session_stage_close()}</button>
  </div>
  {#if publishError}
    <div class="alert alert-warning mb-1 py-1 text-xs">
      {m.webxdc_session_publish_failed({ reason: publishError })}
    </div>
  {/if}
  <WebxdcPlayer
    bind:this={player}
    url={session.app.url}
    sha256={session.app.sha256}
    name={session.app.name}
    iconUrl={session.app.iconUrl}
    appKey={`session:${session.sessionId}`}
    {sync}
    onShareFile={handleShareFile}
  />
</div>
```

  In `GroupChat.svelte`, mount the stage inside the timeline column, directly above the messages area (before the `{#if !atBottom}` scroll button, inside the `relative flex min-h-0 flex-1 flex-col` div):

```svelte
      {#if activeSession}
        <GroupAppStage
          {pointer}
          session={activeSession}
          publish={signAndPublish}
          onShareText={handleShareText}
          onClose={() => (activeSession = null)}
        />
      {/if}
```

  `handleShareText` is a placeholder in this task (Task 8 fills it): `function handleShareText(file) { console.warn('export not wired yet', file.name); }` — acceptable ONLY because Task 8 in this same plan replaces it; do not ship a release between these tasks.

- [ ] **Step 5:** `pnpm vitest run src/lib/__tests__/group-app-stage.svelte.test.js` — PASS.
- [ ] **Step 6: Commit** — `git commit -am "feat(groups): app stage hosting shared webxdc sessions above the timeline"`

---

### Task 7: Composer apps menu, pad config, app picker

**Files:**
- Create: `src/lib/components/groups/WebxdcAppPicker.svelte`
- Modify: `src/lib/components/chat/ChatComposer.svelte` (opt-in apps button), `src/lib/components/groups/GroupChat.svelte`, `src/routes/api/config/+server.js`, `src/lib/stores/config.svelte.js`, `.env.example`, `messages/en.json`, `messages/de.json`
- Test: `src/lib/__tests__/api-config-webxdc.test.js` (extend), `src/lib/__tests__/webxdc-app-picker.svelte.test.js`

**Interfaces:**
- Config: `runtimeConfig.webxdc.padApp = { url, sha256, iconUrl, name } | null` from env `PAD_APP_URL`, `PAD_APP_SHA256`, `PAD_APP_ICON`, `PAD_APP_NAME` (default name `"Pad"`); `null` unless url AND 64-hex sha256 are set.
- `ChatComposer.svelte` new optional prop `onOpenApps: (() => void) | null = null` — renders a `+` button before the input only when set.
- `WebxdcAppPicker.svelte` props: `{ padApp: {url,sha256,iconUrl,name} | null, onSelect: (app: {url,sha256,name,iconUrl}) => void, onClose: () => void }` — modal listing *Start pad* (when `padApp`) plus discovered 1063 apps.
- GroupChat produces `shareApp(app)`: mints a session, publishes the kind-9, opens the stage.

- [ ] **Step 1: Config test first** — extend `src/lib/__tests__/api-config-webxdc.test.js` (follow its existing env-mock pattern): `PAD_APP_URL=https://b/x.xdc` + `PAD_APP_SHA256=<64 a's>` → `config.webxdc.padApp` equals `{url, sha256, iconUrl: '', name: 'Pad'}`; unset or bad-length sha → `padApp: null`. Run — FAIL. Implement in `src/routes/api/config/+server.js` (inside the `webxdc:` block):

```js
    webxdc: {
      sandboxDomain: env.SANDBOX_DOMAIN || 'iframe.diy',
      padApp:
        env.PAD_APP_URL && /^[0-9a-f]{64}$/i.test(env.PAD_APP_SHA256 || '')
          ? {
              url: env.PAD_APP_URL,
              sha256: env.PAD_APP_SHA256.toLowerCase(),
              iconUrl: env.PAD_APP_ICON || '',
              name: env.PAD_APP_NAME || 'Pad'
            }
          : null
    }
```

  Mirror `padApp: null` into the `webxdc` default in `src/lib/stores/config.svelte.js` (line ~225). Document the four vars in `.env.example` next to `SANDBOX_DOMAIN`. Run — PASS.
- [ ] **Step 2: i18n** — en: `"webxdc_apps_button": "Apps"`, `"webxdc_apps_start_pad": "Start pad"`, `"webxdc_apps_pick_title": "Share an app"`, `"webxdc_apps_none": "No published apps found"`, `"webxdc_apps_share_failed": "Could not share the app: {reason}"`; de: `"webxdc_apps_button": "Apps"`, `"webxdc_apps_start_pad": "Pad starten"`, `"webxdc_apps_pick_title": "App teilen"`, `"webxdc_apps_none": "Keine veröffentlichten Apps gefunden"`, `"webxdc_apps_share_failed": "App konnte nicht geteilt werden: {reason}"`.
- [ ] **Step 3: Composer button** — in `ChatComposer.svelte` add to Props typedef and destructuring: `onOpenApps = null`. Inside the `<form>` before the `<input>`:

```svelte
  {#if onOpenApps}
    <button
      type="button"
      class="btn btn-circle btn-ghost btn-sm"
      data-testid="chat-apps-button"
      title={m.webxdc_apps_button()}
      onclick={onOpenApps}
      {disabled}>+</button
    >
  {/if}
```

  (Add the `import * as m from '$lib/paraglide/messages';` — the component has none yet.)
- [ ] **Step 4: Picker test** — `src/lib/__tests__/webxdc-app-picker.svelte.test.js` (jsdom): mock `$lib/stores/nostr-infrastructure.svelte`'s `pool.request` (pattern: `my-groups-relays.svelte.test.js`) to return an rxjs `of()` of two 1063 events (tags `url`/`x`/`m application/x-webxdc`/`alt Webxdc app: Quiz`/`image`) with the same `x` (dedupe → 1 row). Assert: pad row shown when `padApp` set; selecting a row calls `onSelect` with `{url, sha256, name, iconUrl}`; empty discovery + no pad shows `webxdc_apps_none`. Run — FAIL.
- [ ] **Step 5: Implement `WebxdcAppPicker.svelte`** — `modal modal-open` with `modal-box max-w-sm`; on mount, one-shot discovery:

```js
  import { pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { getEducationalRelays } from '$lib/helpers/relay-helper.js';
  import { WEBXDC_MIME } from '$lib/webxdc/session-events.js';
  import { timer } from 'rxjs';
  import { takeUntil, toArray } from 'rxjs/operators';

  let discovered = $state.raw([]);
  let loading = $state(true);
  $effect(() => {
    const sub = pool
      .request(getEducationalRelays(), [{ kinds: [1063], '#m': [WEBXDC_MIME], limit: 50 }])
      .pipe(takeUntil(timer(3000)), toArray())
      .subscribe((events) => {
        const byHash = new Map();
        for (const ev of [...events].sort((a, b) => b.created_at - a.created_at)) {
          const tag = (n) => ev.tags.find((t) => t[0] === n)?.[1];
          const x = tag('x');
          const url = tag('url');
          if (!x || !url || byHash.has(x)) continue;
          byHash.set(x, {
            url,
            sha256: x,
            name: tag('alt')?.replace(/^Webxdc app: /, '') || tag('title') || url.split('/').pop(),
            iconUrl: tag('image') || ''
          });
        }
        discovered = [...byHash.values()];
        loading = false;
      });
    return () => sub.unsubscribe();
  });
```

  Rows: pad first (when `padApp`, labelled `m.webxdc_apps_start_pad()`), then `discovered`; each row a button calling `onSelect(app)`; footer close button calling `onClose`. Run picker test — PASS.
- [ ] **Step 6: Wire GroupChat** — state `let appPickerOpen = $state(false);`. Pass `onOpenApps={canWrite ? () => (appPickerOpen = true) : null}` to the TIMELINE `<ChatComposer>` only (line ~977; the ThreadPanel composer at ~1005 stays untouched — sessions are channel-scoped). Handler:

```js
  import { mintSessionId, buildAppShareTemplate, getWebxdcAttachment } from '$lib/webxdc/session-events.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';

  /** @param {{url: string, sha256: string, name: string, iconUrl: string}} app */
  async function shareApp(app) {
    appPickerOpen = false;
    const sessionId = mintSessionId();
    try {
      await signAndPublish(buildAppShareTemplate(pointer.id, app, sessionId));
      activeSession = { sessionId, app };
    } catch (err) {
      sendError = err instanceof Error ? err.message : String(err); // reuse GroupChat's existing send-error surface; check the actual variable name and mirror sendMessage's catch
    }
  }
```

  Render `{#if appPickerOpen}<WebxdcAppPicker padApp={runtimeConfig.webxdc?.padApp ?? null} onSelect={shareApp} onClose={() => (appPickerOpen = false)} />{/if}` next to the other sheets/modals (~line 820). Before writing the catch, read GroupChat's `sendMessage` (~line 610) and reuse ITS error variable verbatim.
- [ ] **Step 7:** `pnpm vitest run src/lib/__tests__/api-config-webxdc.test.js src/lib/__tests__/webxdc-app-picker.svelte.test.js src/lib/__tests__/groups-unread-markers.svelte.test.js` — PASS.
- [ ] **Step 8: Commit** — `git commit -am "feat(groups): apps menu in the channel composer with pad + 1063 picker"`

---

### Task 8: Export → publish as article / wiki page

**Files:**
- Create: `src/lib/webxdc/export-share.js`
- Modify: `src/lib/components/groups/GroupChat.svelte` (replace the Task-6 placeholder), `src/routes/create/article/+page.js`, `src/routes/create/article/+page.svelte`, `src/routes/create/wiki/+page.js`, `src/routes/create/wiki/+page.svelte`, `messages/en.json`, `messages/de.json`
- Test: `src/lib/webxdc/__tests__/export-share.test.js`

**Interfaces:**
- `stashExport({name, plainText}) => void` — writes JSON to `sessionStorage['webxdc:export']`.
- `takeExport() => {name, plainText} | null` — reads AND removes (one-shot).
- `exportTitle(name) => string` — file name minus extension.
- Create routes accept `?prefill=webxdc`; on load they call `takeExport()` and prefill `title` + `editorContent`.

- [ ] **Step 1: Write the failing test** — `src/lib/webxdc/__tests__/export-share.test.js`:

```js
/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { stashExport, takeExport, exportTitle } from '../export-share.js';

describe('export-share handoff', () => {
  it('stash → take is one-shot', () => {
    stashExport({ name: 'Sitzung.txt', plainText: '# Notizen' });
    expect(takeExport()).toEqual({ name: 'Sitzung.txt', plainText: '# Notizen' });
    expect(takeExport()).toBe(null);
  });
  it('survives junk', () => {
    sessionStorage.setItem('webxdc:export', '{broken');
    expect(takeExport()).toBe(null);
  });
  it('strips the extension for the title', () => {
    expect(exportTitle('Sitzung.txt')).toBe('Sitzung');
    expect(exportTitle('no-extension')).toBe('no-extension');
  });
});
```

- [ ] **Step 2:** Run — FAIL. **Step 3: Implement** `export-share.js`:

```js
/** sessionStorage handoff from a channel app's sendToChat export to the
 *  article/wiki create routes (spec §5). One-shot by design. */
const KEY = 'webxdc:export';

/** @param {{name: string, plainText: string}} file */
export function stashExport(file) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(file));
  } catch {
    /* quota — the create page will just open empty */
  }
}

/** @returns {{name: string, plainText: string} | null} */
export function takeExport() {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return typeof parsed?.name === 'string' && typeof parsed?.plainText === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/** @param {string} name */
export function exportTitle(name) {
  return name.replace(/\.[^.]+$/, '');
}
```

- [ ] **Step 4: Target dialog in GroupChat** — i18n first — en: `"webxdc_export_title": "Publish export"`, `"webxdc_export_as_article": "As article"`, `"webxdc_export_as_wiki": "As wiki page"`, `"webxdc_export_cancel": "Cancel"`; de: `"webxdc_export_title": "Export veröffentlichen"`, `"webxdc_export_as_article": "Als Artikel"`, `"webxdc_export_as_wiki": "Als Wiki-Seite"`, `"webxdc_export_cancel": "Abbrechen"`. Replace the Task-6 `handleShareText` placeholder:

```js
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { stashExport } from '$lib/webxdc/export-share.js';

  /** @type {{name: string, plainText: string} | null} */
  let pendingExport = $state.raw(null);
  function handleShareText(file) {
    pendingExport = file;
  }
  /** @param {'article' | 'wiki'} target */
  function publishExport(target) {
    if (!pendingExport) return;
    stashExport(pendingExport);
    pendingExport = null;
    const params = new URLSearchParams({ prefill: 'webxdc' });
    if (communityPubkey) params.set('community', communityPubkey);
    goto(`${resolve(`/create/${target}`)}?${params}`);
  }
```

  New optional GroupChat prop `communityPubkey = ''` (add to the `$props()` destructuring + typedef). In `PrivateChannelsView.svelte`, pass the community pubkey it already has in scope to `<GroupChat ... communityPubkey={...}>` — read the surrounding code at the `GroupChat` call site (~line 771) for the variable holding the community's pubkey and use exactly that. The `/groups/[pointer]` route passes nothing (defaults to `''`).

  Dialog markup next to the other modals:

```svelte
  {#if pendingExport}
    <div class="modal modal-open">
      <div class="modal-box max-w-sm">
        <h3 class="text-sm font-bold">{m.webxdc_export_title()}</h3>
        <p class="truncate py-2 text-xs opacity-70">{pendingExport.name}</p>
        <div class="modal-action">
          <button class="btn btn-sm" onclick={() => (pendingExport = null)}>{m.webxdc_export_cancel()}</button>
          <button class="btn btn-sm" onclick={() => publishExport('wiki')}>{m.webxdc_export_as_wiki()}</button>
          <button class="btn btn-sm btn-primary" onclick={() => publishExport('article')}>{m.webxdc_export_as_article()}</button>
        </div>
      </div>
    </div>
  {/if}
```

- [ ] **Step 5: Prefill the create routes** — `src/routes/create/article/+page.js`: add `prefill: url.searchParams.get('prefill') || ''` to the returned data (next to `editNaddr`). In `+page.svelte`, after the form-state declarations add:

```js
  import { takeExport, exportTitle } from '$lib/webxdc/export-share.js';
  // Prefill from a channel app export (webxdc sendToChat → sessionStorage handoff).
  if (data.prefill === 'webxdc') {
    const exported = takeExport();
    if (exported) {
      title = exportTitle(exported.name);
      editorContent = exported.plainText;
    }
  }
```

  Apply the identical two edits to `src/routes/create/wiki/+page.js` / `+page.svelte` (same state names `title` / `editorContent` — verified).
- [ ] **Step 6:** `pnpm vitest run src/lib/webxdc/__tests__/export-share.test.js src/lib/__tests__/group-app-stage.svelte.test.js` — PASS.
- [ ] **Step 7: Commit** — `git commit -am "feat(webxdc): publish channel-app exports as article or wiki page"`

---

### Task 9: Apps bar

**Files:**
- Create: `src/lib/components/groups/GroupAppsBar.svelte`
- Modify: `src/lib/components/groups/GroupChat.svelte`, `messages/en.json`, `messages/de.json`
- Test: `src/lib/__tests__/group-apps-bar.svelte.test.js` (derivation logic already unit-tested in Task 2's `deriveSessions`)

**Interfaces:**
- `GroupAppsBar.svelte` props: `{ pointer, messages: any[], onOpen: (session: {sessionId, app}) => void }`. Renders nothing when no sessions.

- [ ] **Step 1: i18n** — en: `"webxdc_apps_bar_title": "Apps in this channel"`; de: `"webxdc_apps_bar_title": "Apps in diesem Kanal"`.
- [ ] **Step 2: Write the failing test** — jsdom: render with `messages` containing one webxdc share (reuse `buildAppShareTemplate(...)` + `id`/`created_at`/`pubkey` stubs) and one plain message; mock pool (enrichment query returns `of()` empty). Assert one row with the app name, clicking calls `onOpen` with `{sessionId, app}`; with zero webxdc messages the component renders nothing (`container.firstChild` collapsed/details absent).
- [ ] **Step 3: Implement**:

```svelte
<script>
  import * as m from '$lib/paraglide/messages';
  import { pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { toArray } from 'rxjs/operators';
  import { deriveSessions, WEBXDC_STATE_KIND } from '$lib/webxdc/session-events.js';

  /** @type {{pointer: any, messages: any[], onOpen: (s: any) => void}} */
  let { pointer, messages, onOpen } = $props();

  const sessions = $derived(deriveSessions(messages));

  // Latest 9450 per session for a live-ish subtitle (document/summary tags).
  // relay.request(filter, {timeout}) emits events and completes at EOSE —
  // same call shape as confirmGroupMetadata in group-management.js.
  let sessionMeta = $state.raw(new Map());
  $effect(() => {
    if (sessions.length === 0) return;
    const sub = pool
      .relay(pointer.relay)
      .request({ kinds: [WEBXDC_STATE_KIND], '#h': [pointer.id], limit: 100 }, { timeout: 2500 })
      .pipe(toArray())
      .subscribe((events) => {
        const meta = new Map();
        for (const ev of [...events].sort((a, b) => b.created_at - a.created_at)) {
          const sid = ev.tags?.find((t) => t[0] === 'i')?.[1];
          if (!sid || meta.has(sid)) continue;
          const tag = (n) => ev.tags.find((t) => t[0] === n)?.[1];
          meta.set(sid, tag('document') || tag('summary') || '');
        }
        sessionMeta = meta;
      });
    return () => sub.unsubscribe();
  });
</script>

{#if sessions.length > 0}
  <details class="border-b border-base-300 bg-base-200/40 px-3 py-1 text-sm">
    <summary class="cursor-pointer text-xs font-semibold opacity-70">
      {m.webxdc_apps_bar_title()} ({sessions.length})
    </summary>
    <ul class="flex flex-col gap-1 py-1">
      {#each sessions as session (session.sessionId)}
        <li>
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded p-1 text-left hover:bg-base-300/50"
            onclick={() => onOpen(session)}
          >
            {#if session.app.iconUrl}<img src={session.app.iconUrl} alt="" class="size-5 rounded" />{:else}▦{/if}
            <span class="truncate font-medium">{session.app.name || session.app.url}</span>
            {#if sessionMeta.get(session.sessionId)}
              <span class="truncate text-xs opacity-60">{sessionMeta.get(session.sessionId)}</span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  </details>
{/if}
```

  In `GroupChat.svelte`, mount directly above the `GroupAppStage` block: `<GroupAppsBar {pointer} messages={displayed} onOpen={(s) => (activeSession = s)} />` — check the actual name of the rendered-messages array in GroupChat (the messageRow snippet reads `displayed`; use that same variable).
- [ ] **Step 4:** Run the new test + `groups-unread-markers.svelte.test.js` — PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(groups): apps bar listing the channel's webxdc sessions"`

---

### Task 10: Groups relay — whitelist 9450/24450 (fork + homelab, outside this repo)

**Files:** relay fork repo (locate: `ls /home/laoc/coding/edufeed | grep -iE "pyramid|relay29|groups"`, or the `git.edufeed.org` org — the deployed relay is `groups.edufeed.org`, fork tag `edufeed-v1.1`) + homelab role for the groups relay.

- [ ] **Step 1:** Locate the fork's kind whitelist: `grep -rn "RestrictToSpecifiedKinds\|9021\|allowedKinds" <fork>/`. Add `9450` and `24450` to the allowed set with the comment: `// webxdc session sync (edufeed/Armada extension): 9450 durable state, 24450 ephemeral realtime, both h-scoped`. 24450 needs nothing else (NIP-01 ephemeral range — khatru forwards without storing).
- [ ] **Step 2:** Run the fork's test suite / `go build ./...`; commit; tag `edufeed-v1.2`.
- [ ] **Step 3:** Deploy via the homelab repo's groups-relay role (find it: `grep -rn "groups.edufeed.org" /home/laoc/coding/homelab/`); bump the image/tag reference to `edufeed-v1.2` and run the matching playbook. (Use the `homelab` agent if running as a subagent-driven task.)
- [ ] **Step 4: Verify live** (Node 22, no deps — adapt the memory snippet): publish a throwaway 9450 with `["h","<test-group>"],["i","smoke"]` via an authed member key, then REQ `{kinds:[9450],"#h":["<test-group>"],"#i":["smoke"]}` → event returned. Publish a 24450 → OK true, and a concurrent subscriber receives it while a later REQ returns nothing (ephemeral). A 9450 without membership → rejected.

---

### Task 11: Curated pad app — vendor, publish, configure (ops)

**Files:** ops checklist + `.env` on deployments; no app code (config landed in Task 7).

- [ ] **Step 1:** Build webxdc/editor pinned: `git clone https://codeberg.org/webxdc/editor.git && cd editor && git checkout <latest release tag> && pnpm install && pnpm build` — produces an `.xdc` (see its README; the packaged zip must have `index.html` at the root). Record tag + sha256 (`sha256sum editor.xdc`).
- [ ] **Step 2:** Upload `editor.xdc` + its icon to the deployment's Blossom server (the app's own upload flow or `blossom-client-sdk` script with laoc's key — the same flow used for interactive resources; laoc may prefer doing this via the app UI's normal interactive-resource upload, which ALSO emits the kind-1063 discovery event and license attestation in one go — recommended path).
- [ ] **Step 3:** Set `PAD_APP_URL`, `PAD_APP_SHA256`, `PAD_APP_ICON`, `PAD_APP_NAME=Pad` in the deployment `.env` (and the local worktree `.env` for testing); restart/redeploy.
- [ ] **Step 4:** Verify: composer `+` menu shows *Pad starten*; sharing publishes a kind-9 with the imeta attachment.

---

### Task 12: Verification & wrap-up

- [ ] **Step 1:** `pnpm vitest run src/lib/webxdc/__tests__/ src/lib/__tests__/imeta.test.js src/lib/__tests__/concord-attachments.test.js src/lib/__tests__/webxdc-attachment-card.svelte.test.js src/lib/__tests__/group-app-stage.svelte.test.js src/lib/__tests__/webxdc-app-picker.svelte.test.js src/lib/__tests__/group-apps-bar.svelte.test.js src/lib/__tests__/api-config-webxdc.test.js` — all green.
- [ ] **Step 2:** `pnpm check` and `pnpm lint` — clean (fix or `pnpm format`).
- [ ] **Step 3:** Full `pnpm test` (warn user first if they're using a dev server — paraglide HMR storm; known-flaky inbox/DM files failing under full parallel load are pre-existing, re-run those in isolation before blaming this branch).
- [ ] **Step 4:** Manual browser verification (needs Tasks 10+11 done, `GROUPS_ENABLED=true`, two accounts): start a pad in a channel → second account sees the launch card + apps bar entry → both edit, text converges → close, reopen from apps bar → content replayed → menu Export → dialog → article editor prefilled with markdown + community param. Screenshot the stage, the apps bar, and the prefilled editor (all states, per house rule) into the gitignored screenshot dir.
- [ ] **Step 5:** `e2e/COVERAGE.md`: add a "Channel webxdc sessions" row — covered by unit/component tests; no E2E in v1 (needs a NIP-29 relay fixture; revisit if a mock-relay harness lands).
- [ ] **Step 6:** Update the 2026-08-19 webxdc spec's Section 5 with a one-line pointer: superseded by `2026-08-25-channel-webxdc-sessions-design.md` (h = group id). `git add -f` (docs are gitignored) and commit.
- [ ] **Step 7:** Use superpowers:finishing-a-development-branch — target for merge is `feat/community-group-pointer` (this feature ships with the groups feature), NOT dev directly.
