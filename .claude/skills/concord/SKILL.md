---
name: concord
description: Concord (CORD) private channels inside communities via applesauce-concord: wrapper-module import rules, lockstep pins, relay sets, kind 1059/13302/13303 sync, notifications and read-state, reply sending. Use for any Concord, CORD, Kanäle, private-channel, kind-1059 gift-wrap stream, or applesauce-concord bump work.
---

## Concord Private Channels (CORD, Beta)

E2E-encrypted channels inside communities via `applesauce-concord` (pre-release,
exact-pinned together with the `applesauce-core-concord` and
`applesauce-common-concord` aliases — bump all three in lockstep and review
diffs; run the package's own vitest suite as a canary:
`cd $(mktemp -d) && npm pack applesauce-concord@concord` or test in the
applesauce repo's concord branch).

- All app access goes through `src/lib/concord/` (lint-enforced): never
  import `applesauce-concord` or `applesauce-core-concord` outside it.
  Within that, the actual rule (not an exception): every component imports
  Concord submodules DIRECTLY (e.g. `community.svelte.js`, `moderation.js`,
  `bridge.svelte.js`) rather than through the `src/lib/concord/index.js`
  barrel. The barrel serves non-component/dynamic-import call sites (e.g.
  `src/routes/+layout.svelte`'s `import('$lib/concord')` that boots
  `initConcordService`) and is the canonical export list for the directory.
  `storage.js` is intentionally NOT re-exported from the barrel — it
  statically imports `applesauce-core-concord`, and re-exporting it would
  pull that dependency tree into every barrel consumer's chunk (including
  server chunks); reach it via `client.svelte.js`'s internal dynamic
  `import('./storage.js')` or a direct test import instead.
- One Concord community per Communikey community; pointer tag
  `["concord", <id>, <relay>]` on kind 10222. Kanäle = CORD-03 private channels.
- Kind 1059 traffic never uses outbox/category relays or curated/WoT
  filtering, but not all of it stays on `CONCORD_RELAYS` alone: community
  STREAM traffic (channel/control/guestbook) stays on the community's
  `material.relays` (= `CONCORD_RELAYS` for wizard-founded areas), while the
  self-encrypted Community/Invite List (13302/13303) sync — and the
  direct-invite watcher — use the merged set that also includes CORD-05's
  public stock relays (`mergeRelaySets()`, `relay-sets.js`). Deliberate
  interop trade-off: list contents stay NIP-44-encrypted, but existence/timing
  metadata is exposed on those public relays.
- Feature flag `CONCORD_ENABLED` (default off). Spec:
  `docs/superpowers/specs/2026-07-23-concord-private-channels-design.md`.
- Concord code must never enter SSR chunks (dep tree has @noble/hashes v2 —
  see commit a9af9c87); the wrapper uses browser-guarded dynamic imports.
- Curated/WoT/gated modes need no Concord-specific code: Concord traffic never
  flows through the app's loaders or feed queries (the client subscribes
  directly with stream-author filters on its own relays), so author filtering
  cannot touch it. Do not "fix" this by adding kind-1059 exclusions to feed
  code.
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
