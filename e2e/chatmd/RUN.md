# chat-markdown real-route harness

Drives the real `/groups/[pointer]` chat route in Chrome against a local
fixture relay and asserts the restricted-markdown subset on **relay-delivered**
events — the store/relay path, not component props. Not part of the playwright
`e2e/` suite (`testMatch` only collects `*.test.js`); run it by hand.

Everything here is regenerable — `mkfixtures.mjs` re-signs the events,
`keys.json` holds the test key (throwaway, fixtures only) so anything ever
published stays deletable.

## 1. Relay

    nak serve --port 17030 --events $PWD/e2e/chatmd/events.jsonl   # absolute path required

15 kind-9 messages + one kind-39000 group, `h`-tagged `chatmd`. Each message
carries a `probe` tag naming its case.

## 2. App

Override the relay vars via **process env, not `.env`** — nothing to back up,
nothing to restore wrong.

    cd <this checkout>
    set -a; . ./.env; set +a
    AMB_RELAYS=ws://127.0.0.1:17030 CALENDAR_RELAYS=ws://127.0.0.1:17030 \
    COMMUNIKEY_RELAYS=ws://127.0.0.1:17030 DM_RELAYS=ws://127.0.0.1:17030 \
    EDUFEED_PUBLISH_RELAYS=ws://127.0.0.1:17030 FALLBACK_RELAYS=ws://127.0.0.1:17030 \
    INDEXER_RELAYS=ws://127.0.0.1:17030 KANBAN_RELAYS=ws://127.0.0.1:17030 \
    LONGFORM_CONTENT_RELAY=ws://127.0.0.1:17030 RELAY_LIST_LOOKUP_RELAYS=ws://127.0.0.1:17030 \
    CORDN_CONTEXTVM_RELAYS=ws://127.0.0.1:17030 \
    pnpm dev --port 5187 --host 127.0.0.1

`--host 127.0.0.1` matters: vite binds `[::1]` only by default, so a v4 probe
reads a healthy server as dead.

**This does NOT isolate the app.** `/imprint` still dials
`wss://relay.edufeed.org` via the relay hint embedded in the
`CURATED_PUBKEYS_SETS_LONGFORM` naddr, which beats every env var at
`curated-authors-service.svelte.js:421`. Reads only. The probe's socket ledger
reports any such dial; the chat route itself dials none.

## 3. Drive it

    CHROMIUM_BIN=/etc/profiles/per-user/laoc/bin/google-chrome node e2e/chatmd/probe.mjs

Runnable from anywhere: it resolves `@playwright/test` against the checkout it
lives in (ESM resolves bare specifiers relative to the importing file, so a
copy elsewhere needs `CHATMD_WORKTREE=<checkout>`).

URL is `/groups/<urlencoded ws://127.0.0.1:17030'chatmd>`.

## Determinism (the emojiFallback race, fixed)

All image loads are intercepted in the probe: the `:sob:` emoji is aborted,
every other image is fulfilled with an inline 1x1 PNG. Without this the run
races the real network in both directions — markdown `<img alt>` exists only
until the fixture host's load _fails_, while the emoji placeholder appears
only _after_ its load fails — and a single-snapshot probe reads 1-pass-in-4.
The probe also waits for the **end state** of both families (placeholder
present, all images `complete && naturalWidth > 0`) before evaluating.
Side effect: the image layer is fully offline.

## Traps this harness already pays for

- `@noble/hashes` does not resolve under vitest's worktree quirks, hence the
  inline `bytesToHex` in `mkfixtures.mjs`.
- The emoji placeholder carries `aria-label=":sob:"` and **no** `alt`.
  Selecting on `img[alt=":sob:"]` reports 0 and reads as a missing feature.
- Wait on `body.app-ready`, then on the bubble count. A fixed sleep races a
  cold vite transform and returns an empty page that reads as a broken route.
- Playwright matches routes in REVERSE registration order — a general image
  route registered after a specific abort silently overrides it. One handler
  branches instead.
