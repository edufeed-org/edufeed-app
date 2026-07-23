# Edufeed-App - Claude Code Context

## Project Overview

Edufeed-App (formerly ComCal / Communikey Calendar; the display name is deployment-configurable via `APP_NAME`, default `Edufeed`) is a decentralized social education platform built on the Nostr protocol using SvelteKit. It enables users to:

- Create and interact in communities
- Create and manage events/calendars (NIP-52)
- Search through educational content (kind 30142 - AMB spec)
- Organize content in lists and share with communities
- Read and write long-form articles, wiki pages, publications, notes, and polls
- Exchange NIP-17 private DMs and follow notifications in the inbox
- Apply for a NIP-05 handle (membership application, admin-approved)

## Tech Stack

- **Framework:** SvelteKit with Svelte 5 (runes-based reactivity)
- **Styling:** TailwindCSS 4.0 + DaisyUI 5.0
- **Language:** JavaScript with JSDoc type annotations
- **Build:** Vite 7.x
- **i18n:** Paraglide.js
- **Protocol:** Nostr (Network of Simple Transport Relays)

### Key Dependencies

```
applesauce-core      # Event handling, models, stores, EventFactory
applesauce-common    # NIP-specific helpers and models (v5+)
applesauce-relay     # Relay pool and WebSocket management
applesauce-accounts  # Account management
applesauce-loaders   # Network data fetching
applesauce-signers   # Event signing (NIP-07, NIP-46)
applesauce-actions   # ActionRunner for event mutations (CRUD on existing events)
applesauce-content   # Content rendering utilities
nostr-tools          # Protocol utilities (DO NOT use directly for relay comm)
blossom-client-sdk   # File uploads with NIP-98 auth
rxjs                 # Reactive observables
```

## Critical Architecture Rules

### 1. ALWAYS Use Applesauce for Nostr Operations

**NEVER use nostr-tools directly for relay communication!** nostr-tools `SimplePool` has incorrect message serialization.

```javascript
// ❌ WRONG - nostr-tools sends malformed requests
import { SimplePool } from 'nostr-tools';
const pool = new SimplePool();
pool.subscribeMany(relays, [filter], opts);
// Sends: ["REQ", "sub:1", [{...}]] - MALFORMED!

// ✅ CORRECT - Use applesauce infrastructure
import { createTimelineLoader } from 'applesauce-loaders/loaders';
import { timedPool } from '$lib/loaders';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';

const loader = createTimelineLoader(timedPool, relays, filter, { eventStore, limit });
return loader(); // Returns Observable
```

**`timedPool` Wrapper**: The `timedPool` function wraps pool requests with a 2-second timeout. This prevents hanging relays (those that send events but never EOSE) from blocking pagination. Without this wrapper, v5's `pool.request()` waits for ALL relays to send EOSE before completing.

```javascript
// In $lib/loaders/base.js
import { timer } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

export const timedPool = (relays, filters) =>
  pool.request(relays, filters).pipe(takeUntil(timer(2_000)));
```

### 2. Loader/Model Pattern (Essential)

Three-layer reactive data architecture:

**Loaders** - Fetch from network → populate EventStore
**Models** - Subscribe to EventStore → transform/filter data
**Components** - Use `$effect()` to combine loader + model subscriptions, returning a cleanup that unsubscribes both

**Models do NOT fetch events** — they only subscribe to what's already in EventStore.

Canonical implementation: `src/routes/discover/+page.svelte`.

### Reusable Hooks

Use `useProfileMap(getPubkeys)` from `src/lib/stores/profile-map.svelte.js` instead of manual `profileLoader` + `ProfileModel` subscriptions for batch profile loading.

**Gotcha:** When the pubkey source is a `$state.raw()` array, the getter won't re-run on content changes (only on reassignment). Use a trigger counter:

```javascript
let items = $state.raw([]);
let profileTrigger = $state(0);
const getProfiles = useProfileMap(() => {
  const _ = profileTrigger; // dependency
  return items.map((i) => i.pubkey);
});
// On reload: items = newItems; profileTrigger++;
```

### addressLoader Relay Configuration

**CRITICAL:** `createAddressLoader` requires `relays` in the address pointer, not just in loader config:

```javascript
// ❌ WRONG - addressLoader won't query any relays
addressLoader({ kind: 0, pubkey }).subscribe();

// ✅ CORRECT - Pass relays in address pointer
const relays = getAllLookupRelays();
addressLoader({ kind: 0, pubkey, relays }).subscribe();
```

The `lookupRelays` option in `createAddressLoader` config is a fallback; explicit `relays` in the address pointer takes precedence and ensures the loader knows where to query.

### 3. Deletion Filtering

```javascript
// ❌ WRONG - Returns all events (including deleted)
eventStore.timeline({ ids: [...] })

// ✅ CORRECT - Filters deleted events automatically
eventStore.model(TimelineModel, { ids: [...] })
```

## Svelte 5 Critical Patterns

### $state() vs Plain let

```javascript
// ❌ WRONG - INFINITE LOOP! $state inside $effect causes re-triggers
let subscription = $state(undefined);
$effect(() => {
  subscription?.unsubscribe();
  subscription = eventStore.timeline({...}).subscribe(); // Triggers re-run!
});

// ✅ CORRECT - Use plain let for subscriptions/timers/internal refs
/** @type {import('rxjs').Subscription | undefined} */
let subscription;
$effect(() => {
  subscription?.unsubscribe();
  subscription = eventStore.timeline({...}).subscribe();
  return () => subscription?.unsubscribe();
});
```

**Rule:** `$state()` = value triggers UI re-renders. Plain `let` = internal references.

### $derived() Must Be Pure

```javascript
// ❌ WRONG - Mutates in $derived
let sorted = $derived(items.sort());

// ✅ CORRECT - Creates new array
let sorted = $derived([...items].sort());
// or
let sorted = $derived(items.toSorted((a, b) => a.name.localeCompare(b.name)));
```

### $state.raw() for Event Arrays with Symbol Data

Svelte 5's `$state()` creates deep reactive proxies. This breaks `Set.prototype.has()` and other built-in methods when accessed through the proxy, because `this` becomes a Proxy instead of a real Set.

```javascript
// ❌ WRONG - Deep proxy breaks Symbol-based properties (e.g. getSeenRelays)
// Set.prototype.has() throws: "Method Set.prototype.has called on incompatible receiver"
let events = $state([]);

// ✅ CORRECT - Shallow reactivity preserves Symbol-based properties
// Use when arrays are always replaced entirely (not mutated in place)
let events = $state.raw([]);
```

**When to use `$state.raw()`:**

- Arrays of Nostr events that carry Symbol-based metadata (relay provenance)
- Any array/object containing Sets, Maps, or other built-ins accessed via methods
- Data that is always replaced entirely (never `.push()` or mutated in place)
- Sets/Maps for per-relay pagination tracking (see [Per-Relay Pagination](#per-relay-pagination))

### Keyed {#each} over Tag-Derived Data Must Be Deduped

Values extracted from Nostr event tags are untrusted network input — a malformed event can repeat any tag, and a duplicate key in a keyed `{#each}` **crashes the whole page** (`each_key_duplicate`, thrown in production too). Run tag-derived arrays through `unique()` / `uniqueBy()` from `$lib/helpers/unique.js` before they feed a keyed block:

```javascript
// ❌ WRONG - a duplicated p-tag kills the page
const creators = $derived(event.tags.filter((t) => t[0] === 'p').map((t) => t[1]));
// {#each creators as pubkey (pubkey)}

// ✅ CORRECT - dedupe (and validate) at the data boundary
import { unique } from '$lib/helpers/unique.js';
const creators = $derived(unique(event.tags.filter((t) => t[0] === 'p').map((t) => t[1])));
```

Safe keys need no dedup: `event.id` (unique by construction, EventStore dedupes) and loop `index`. As a last line of defense, the route-level `<svelte:boundary>` in `src/routes/+layout.svelte` catches any render error and shows `RenderErrorCard` instead of a dead page — do not remove it, and don't rely on it instead of deduping.

### Applesauce Functions That Mutate

Some applesauce-core functions use internal caching that causes `state_unsafe_mutation` errors in `$derived()`:

```javascript
// ❌ WRONG - getReplaceableAddress() caches internally
import { getReplaceableAddress } from 'applesauce-core/helpers';
const filtered = $derived.by(() => {
  return items.filter((item) => {
    const address = getReplaceableAddress(item.data); // MUTATION!
  });
});

// ✅ CORRECT - Use pure function
function getAddressableReference(event) {
  if (!event || event.kind < 30000 || event.kind >= 40000) return undefined;
  const dTag = event.tags?.find((t) => t[0] === 'd')?.[1] || '';
  return `${event.kind}:${event.pubkey}:${dTag}`;
}
```

### RxJS Subscription Variable Order

```javascript
// ❌ WRONG - "Cannot access 'sub' before initialization"
let sub = eventStore.replaceable({...}).subscribe((event) => {
  if (sub) sub.unsubscribe(); // sub not initialized yet!
});

// ✅ CORRECT - Declare first, then assign
/** @type {import('rxjs').Subscription | undefined} */
let sub;
sub = eventStore.replaceable({...}).subscribe((event) => {
  if (sub) sub.unsubscribe();
});
```

### Hooks Cannot Be Called from Async Handlers

```javascript
// ❌ WRONG - Causes "effect_orphan" error
async function handleClick() {
  const getProfile = useUserProfile(pubkey); // FAILS
}

// ✅ CORRECT - Call hooks during component initialization
// In template:
{@const getProfile = useUserProfile(pubkey)}
```

## Project Structure

```
src/
├── lib/
│   ├── components/     # Svelte components, one folder per domain:
│   │   │               # calendar/, community/, educational/, article/,
│   │   │               # publication/, wiki/, polls/, notes/, waves/, meet/,
│   │   │               # dm/, inbox/, forms/, membership/, kanban/, thread/,
│   │   │               # feed/, dashboard/, discover/, bookmarks/, badges/,
│   │   │               # comments/, reactions/, assistant/ (Termi), landing/,
│   │   │               # lists/, profile/, settings/, icons/, shared/
│   │   └── __tests__/  # Component tests
│   ├── config/         # Static registries (resource-form-variants, create-actions, oer-sources)
│   ├── helpers/        # Utility functions
│   │   └── educational/# SKOS loader, search builders, draft store
│   ├── loaders/        # Applesauce loaders
│   ├── models/         # Custom applesauce models
│   ├── server/         # Server-only code (og.js link previews)
│   ├── services/       # Publish, relay, DM, inbox, curated-authors services
│   ├── stores/         # Svelte reactive stores
│   │   ├── nostr-infrastructure.svelte.js  # EventStore, RelayPool
│   │   ├── accounts.svelte.js              # User authentication
│   │   ├── config.svelte.js                # Runtime configuration
│   │   └── calendar-*.svelte.js            # Calendar domain
│   └── types/          # JSDoc types
├── routes/
│   ├── api/            # Server endpoints (config, enrich, oer, curricula, nip05)
│   ├── calendar/       # Calendar routes
│   ├── dashboard/      # Feed dashboard (relay feed picker)
│   ├── discover/       # Unified discovery page
│   ├── inbox/          # Notifications + DMs
│   ├── communities/    # Community directory
│   ├── bookmarks/      # Personal + social bookmarks
│   ├── wiki/           # Wiki articles
│   ├── forms/          # Form templates / responses
│   ├── admin/          # Admin panels (membership approvals)
│   ├── create/         # Content creation flows
│   ├── c/[pubkey]/     # Community pages
│   ├── p/[pubkey]/     # Profile pages
│   └── [naddr=naddr]/  # Dynamic Nostr address routes (+ [nevent], nostr shortcuts)
└── params/             # SvelteKit param matchers
```

## Event Kinds

### Core Kinds

| Kind        | NIP            | Description                                                                                     |
| ----------- | -------------- | ----------------------------------------------------------------------------------------------- |
| 0           | NIP-01         | User profile (metadata)                                                                         |
| 1           | NIP-01         | Text note / post (`NoteCard`, `NoteCreateModal`)                                                |
| 3           | NIP-02         | Contact list                                                                                    |
| 5           | NIP-09         | Deletion event                                                                                  |
| 7           | NIP-25         | Reaction (also "waves": reactions targeting kind 0 profiles)                                    |
| 8           | NIP-58         | Badge award                                                                                     |
| 9           | —              | Chat message (with `#h` tag for community chat)                                                 |
| 11          | —              | Forum discussion (`ForumView`)                                                                  |
| 1111        | NIP-22         | Comment (uses `#A` tag for root scope)                                                          |
| 1068        | NIP-88         | Poll (`PollsView`)                                                                              |
| 1018        | NIP-88         | Poll response                                                                                   |
| 1059        | NIP-59/CORD-01 | Gift wrap (private DMs; see `dm-service.svelte.js`); also Concord streams (see Concord section) |
| 1069        | —              | Form response (membership application, encrypted)                                               |
| 3313        | CORD-05        | Concord direct invite (rumor)                                                                   |
| 13302/13303 | CORD           | Concord community/invite lists (self-encrypted)                                                 |
| 9802        | NIP-84         | Highlight (social bookmarks)                                                                    |

### Replaceable / Parameterized Kinds

| Kind  | NIP        | Description                                                                                           |
| ----- | ---------- | ----------------------------------------------------------------------------------------------------- |
| 10002 | NIP-65     | Relay list (read/write relays for outbox model)                                                       |
| 10030 | NIP-51     | User emoji list (+ kind 30030 emoji packs)                                                            |
| 10050 | NIP-17     | DM relay list (published as a default at signup, `DM_RELAYS` env)                                     |
| 10063 | —          | Blossom server list (preferred file upload servers)                                                   |
| 10222 | Communikey | Community definition                                                                                  |
| 30002 | NIP-51     | Relay set (user app relay overrides per category)                                                     |
| 30009 | NIP-58     | Badge definition — **legacy access control**, read/delete only, no longer written                     |
| 30023 | NIP-23     | Long-form article (`ArticlesView`, article editor)                                                    |
| 30040 | —          | Publication — create + view work; discover integration and relay support still pending                |
| 30142 | AMB        | Educational resource (OER with SKOS metadata)                                                         |
| 30168 | —          | Form template (metadata/membership forms; responses are kind 1069)                                    |
| 30222 | Communikey | Targeted publication — **read-only legacy**, no longer created. Old communities may still have these. |
| 30301 | —          | Kanban board                                                                                          |
| 30302 | —          | Kanban card (config only)                                                                             |
| 30312 | NIP-53     | Meet room (interactive room; + 30313 room meta, 10312 room presence)                                  |
| 30818 | NIP-54     | Wiki article (`WikisView`, `/wiki/<topic>` route)                                                     |
| 30000 | NIP-51     | Follow set (d="communities" for community membership; also community section profile lists)           |
| 31922 | NIP-52     | Date-based calendar event                                                                             |
| 31923 | NIP-52     | Time-based calendar event                                                                             |
| 31924 | NIP-52     | Calendar collection                                                                                   |
| 31925 | NIP-52     | Calendar RSVP                                                                                         |
| 33301 | CORD-05    | Concord invite bundle                                                                                 |
| 39701 | NIP-B0     | Web bookmark (social bookmarks)                                                                       |
| 39737 | NIP-VOCAB  | SKOS ConceptScheme (vocabularies for resource forms, published via `pnpm run publish:vocabs`)         |

### Regular Kinds

| Kind | NIP    | Description                                                                                |
| ---- | ------ | ------------------------------------------------------------------------------------------ |
| 1063 | NIP-94 | File metadata — used for image license attestation (see Image License Attestation section) |
| 8571 | —      | Kanban patch (config only)                                                                 |

## Image License Attestation (Kind 1063 convention)

Edufeed uses NIP-94 (kind 1063) events to attest licenses for images, keyed by SHA-256 hash. A license attestation has these tags:

| Tag           | Required by NIP-94 | Required by edufeed | Notes                                 |
| ------------- | ------------------ | ------------------- | ------------------------------------- |
| `url`         | yes                | yes                 | Image location                        |
| `x`           | yes                | yes                 | SHA-256 hex — the PK we look up by    |
| `m`           | yes                | yes                 | MIME type                             |
| `size`, `dim` | no                 | optional            | Bytes, "WxH"                          |
| `license`     | no                 | **yes**             | License URL (CC, MIT, etc.)           |
| `credit`      | no                 | **yes**             | Human-readable attribution            |
| `source`      | no                 | optional            | Origin page where the image was found |
| `p`           | no                 | optional            | Attribution to a Nostr pubkey         |

**Lookup:** filter `{ kinds: [1063], '#x': [hash] }`. When multiple events exist, newest `created_at` wins; tie-break by lex order of `id`.

**Gate:** the resource form requires a license event for any image that came from an upload (`formData.imageWasUploaded === true`). Pasted URLs pass through with no gate; if the URL is a Blossom URL, `getSha256FromURL` extracts the hash and the resource event still gets an `["x", hash]` tag so the badge can render when a license event for that hash exists in the network.

**Helpers / files:**

- `src/lib/helpers/image-license.js` — `buildLicenseTemplate(...)` pure helper.
- `src/lib/stores/image-license.svelte.js` — `useLicenseForHash(getHash)` reactive hook.
- `src/lib/components/shared/LicensedImageInput.svelte` — upload/paste field + license modal.
- `src/lib/components/shared/LicenseBadge.svelte` — display badge for `AMBResourceCard` / `AMBResourceView`.

## Communikey Protocol

This app implements the Communikey community specification. Use `/communikey` skill for protocol details.

**Core concepts:**

- **Communities = npubs** - Any keypair can become a community (kind 10222)
- **Membership via kind 30000 follow set** - d="communities", p-tags = community pubkeys
- **H-tag community targeting** - Events target communities via `["h", communityPubkey]` tags directly on the content event. Multiple h-tags for multi-community targeting. Kind 9 (chat) and 11 (forum) are always single-community exclusive.
- **Profile-list access control (new spec)** - Content sections in kind 10222 can reference `["a", "30000:pubkey:d-tag", relay]` profile lists to control who can publish. Enforced client-side via `useProfileListAccess` (`src/lib/stores/profile-list-access.svelte.js`) — replaced the old badge-based access control.
- **Enforced relays (new spec)** - `["r", "url", "enforced"]` relays guarantee only profile-list members' content is stored. Write side is implemented (`communityTagBuilder.js` writes the tag; `publish-service.js` always includes enforced relays when publishing to a community). Read-side content filtering is still deferred.
- **Kind 30222 (legacy)** - Old-spec targeted publications are still read for backward compat but no longer created. New content uses h-tags only.

**Key implementation files:**

- `src/lib/helpers/community.js` - Join/leave logic (uses actionRunner + follow set actions)
- `src/lib/helpers/communityRelays.js` - Canonical content type parser (`parseCommunityContentTypes`, `parseCommunityMetadata`), community relay helpers
- `src/lib/stores/joined-communities-list.svelte.js` - Membership hooks (kind 30000 follow set)
- `src/lib/loaders/community.js` - Community loaders
- `src/lib/loaders/targeted-publications.js` - Targeted publication loaders (read-only, legacy 30222)

**Deferred work:**

- Enforced relay content filtering (read side — trusting enforced relays instead of client-side author filtering)
- Kind 30222 read removal once enough time passed (kind 30009 badge definitions are likewise legacy: read/delete only)

## Concord Private Channels (CORD, Beta)

E2E-encrypted channels inside communities via `applesauce-concord` (pre-release,
exact-pinned together with the `applesauce-core-concord` alias — bump both in
lockstep and review diffs; run the package's own vitest suite as a canary:
`cd $(mktemp -d) && npm pack applesauce-concord@concord` or test in the
applesauce repo's concord branch).

- All app access goes through `src/lib/concord/` (lint-enforced). EXCEPTION:
  components rendered during SSR (e.g. ContentNavSidebar, BottomTabBar) must
  import `shouldShowChannelsTab` and `useConcordCommunity` directly from
  `src/lib/concord/community.svelte.js` instead of the barrel — the barrel
  re-exports storage.js, which statically imports applesauce-core-concord
  and would otherwise pull that dependency tree into server chunks;
  community.svelte.js is SSR-clean because it only imports submodules.
  Never import `applesauce-concord` or `applesauce-core-concord` elsewhere.
- One Concord community per Communikey community; pointer tag
  `["concord", <id>, <relay>]` on kind 10222. Kanäle = CORD-03 private channels.
- Kind 1059 traffic goes ONLY to `CONCORD_RELAYS` (never outbox/category
  relays; never through curated/WoT filtering).
- Feature flag `CONCORD_ENABLED` (default off). Spec:
  `docs/superpowers/specs/2026-07-23-concord-private-channels-design.md`.
- Concord code must never enter SSR chunks (dep tree has @noble/hashes v2 —
  see commit a9af9c87); the wrapper uses browser-guarded dynamic imports.
- Curated/WoT/gated modes need no Concord-specific code: Concord traffic never
  flows through the app's loaders or feed queries (the client subscribes
  directly with stream-author filters on its own relays), so author filtering
  cannot touch it. Do not "fix" this by adding kind-1059 exclusions to feed
  code.

## Configuration

Runtime config loads from `/api/config` (sourced from `.env`) into `runtimeConfig` (`$lib/stores/config.svelte.js`). Wait for the `configReady` store before reading config at module load time.

Top-level shape:

- `appName` / `clientName` — branding (`APP_NAME`, `CLIENT_NAME` env; also drives kind 30002 d-tags — see User Relay Overrides)
- `appRelays.{calendar,communikey,educational,longform,kanban}` — per-content-type relays
- `fallbackRelays` — general-purpose, used when gated mode is OFF
- `feedRelays` / feed relay sources — dashboard feed picker (`FEED_RELAYS`, `FEED_RELAY_SOURCES` env: `config,custom,nip65,community`)
- `dmRelays` — NIP-17 DM relays (kind 10050) published as a default for new users at signup (`DM_RELAYS` env); falls back to `fallbackRelays` when unset. Use `getDefaultDmRelays()` from `relay-helper.js`.
- `gatedMode.{default,force}` — gated mode defaults / lockout
- `curatedMode` — curated authors (`CURATED_PUBKEYS_SETS`, `CURATED_PUBKEYS`, per-category overrides)
- `wotMode.{enabled,includeUserFollows,calendar,communikey,educational,longform,kanban}` — WoT config
- `blossom.serverUrl` — file upload server
- `ui.{defaultLightTheme,defaultDarkTheme}` — theme defaults (dark is inert)
- `educational` — search debounce, vocabulary choices, `schemeNaddrs` (kind 39737 ConceptScheme naddrs from `SCHEME_NADDR_*` env vars)
- `npubLogin.enabled` / `googleLogin.{enabled,centralUrl,operatorUrls}` — login methods (`NPUB_LOGIN_ENABLED`, `GOOGLE_LOGIN_ENABLED`, `POMEGRANATE_CENTRAL_URL`, `POMEGRANATE_OPERATOR_URLS`); Google = Pomegranate/promenade FROST bunker, accounts tagged via `account.metadata.pomegranateCentral`
- Whitelabel: `APP_LOGO`, hero images (`LANDING_HERO_IMAGE`, `DISCOVER_HERO_IMAGE`), favicons, imprint vars

### Server API Endpoints

Besides `/api/config`, the app has server-side proxy endpoints (all optional, 503/hidden when their env is unset):

- `/api/enrich` — URL → form-prefill metadata via the deployed AMB MCP server (`AMB_MCP_URL`, Keycloak client-credentials auth via `AMB_MCP_TOKEN_URL`/`AMB_MCP_CLIENT_ID`/`AMB_MCP_CLIENT_SECRET`)
- `/api/oer` — OER media-library image search proxy (`OER_PROXY_URL`)
- `/api/metaclean` — metadata-cleaner proxy for the pre-upload review step in `LicensedFileInput`/`LicensedImageInput` (`METADATA_CLEANER_URL`)
- `/api/curricula` — Lehrplan-ontology SPARQL cascade for the curriculum picker (`SPARQL_ENDPOINT_URL`)
- `/api/nip05` — membership/handle admin proxy to the standalone nip-05-service (`NIP05_SERVICE_URL`, `NIP05_SERVICE_API_KEY`, allowlist `MEMBERSHIP_ADMIN_PUBKEYS`; feature flag `MEMBERSHIP_ENABLED`)

### Gated Mode

Gated mode controls content sources for institutional/controlled deployments:

- **OFF** (default): app-specific relays + fallback relays (normal Nostr)
- **ON**: ONLY app-specific relays (curated experience)

Env vars: `GATED_MODE_DEFAULT`, `GATED_MODE_FORCE` (when true, users cannot toggle off). Toggle in `/settings`; page reloads on change.

Use the relay-helper functions (`getCalendarRelays`, `getEducationalRelays`, `getCommunikeyRelays`, `getLongformRelays`, `getKanbanRelays`) from `$lib/helpers/relay-helper.js` — they automatically respect gated mode + user overrides. Never read `runtimeConfig.appRelays.*` directly.

### WoT Content Filtering

WoT (Web of Trust) extends curated mode by using anchor pubkeys' follow graphs to build the allowed authors list.

**Effective Authors = Curated ∪ WoT Anchors ∪ WoT Follows (anchors' kind 3) ∪ User Follows**

Disabled by default. Unioned with curated in the same `getCuratedAuthors()` call — no separate API. Social content (reactions, comments, chat) is not filtered. Per-category anchors completely replace global anchors for that category.

**Env vars:** `WOT_ENABLED`, `WOT_INCLUDE_USER_FOLLOWS`, `WOT_ANCHOR_PUBKEYS` (global, hex or npub, comma-separated), plus per-category overrides `WOT_ANCHOR_PUBKEYS_{CALENDAR,COMMUNIKEY,EDUCATIONAL,LONGFORM,KANBAN}`.

**Key file:** `src/lib/services/curated-authors-service.svelte.js` (unified curated + WoT). User-follows lifecycle in `src/lib/stores/accounts.svelte.js`.

## Publishing & Relay Management

### App-Specific Relays

| Category    | Env Variable             | Event Kinds                |
| ----------- | ------------------------ | -------------------------- |
| calendar    | `CALENDAR_RELAYS`        | 31922, 31923, 31924, 31925 |
| communikey  | `COMMUNIKEY_RELAYS`      | 10222, 30222               |
| educational | `AMB_RELAYS`             | 30142                      |
| longform    | `LONGFORM_CONTENT_RELAY` | 30023                      |
| kanban      | `KANBAN_RELAYS`          | 30301, 30302, 8571         |

`kindToAppRelayCategory(kind)` and `getAppRelaysForCategory(category)` live in `$lib/services/app-relay-service.svelte.js`.

### User Relay Overrides (Kind 30002)

Users can override app-specific relays per category via NIP-51 relay sets (d-tag `{APP_NAME}/{category}`, e.g. `Edufeed/educational`). **Because the d-tag embeds `APP_NAME`, changing `APP_NAME` on an existing deployment orphans all users' relay-set overrides.** Resolution: user override → server default. On login, `accounts.svelte.js` waits for `configReady`, fetches user's kind 30002 events, and populates the cache in `app-relay-service.svelte.js`.

```javascript
// ❌ Bypasses user overrides
const relays = runtimeConfig.appRelays?.educational || [];

// ✅ Use relay-helper (respects user overrides + gated mode)
import { getEducationalRelays } from '$lib/helpers/relay-helper.js';
```

**Config timing:** `configReady` store in `config.svelte.js` signals when `/api/config` has loaded. Module-load-time code (like `accounts.svelte.js`) must await it before reading runtime config.

**Key files:** `relay-helper.js`, `app-relay-service.svelte.js` (cache + `parseRelaySetEvent`), `accounts.svelte.js` (login fetches kind 30002 via the service), `config.svelte.js` (`configReady`).

### NIP-65 Outbox Model

Use `publishEvent(signedEvent, taggedPubkeys, { communityEvent })` from `$lib/services/publish-service.js`. It unions: author write relays (NIP-65) + tagged users' read relays + app-specific relays for the kind + community relays (if h-tagged). Backed by `relay-service.svelte.js` (NIP-65 helpers) and `relay-list-loader.js` (kind 10002).

### Relay Hints

All `a`, `e`, `p` tags should include relay hints. Use `buildATagWithHint` / `buildETagWithHint` / `buildPTagsWithHints` from `$lib/services/publish-service.js` — each returns the tag with a `wss://...` hint appended.

### Relay Provenance (Seen Relays)

Applesauce tracks per-event relay provenance via `Symbol.for("seen-relays")`. Use `getSeenRelays(event)` (returns `Set<string> | undefined`) and `addSeenRelay` from `applesauce-core/helpers`. Always wrap relay URLs with `normalizeURL()` before comparison — it adds trailing slashes and lowercases hostnames.

**CRITICAL:** Event arrays using relay provenance MUST use `$state.raw()` — see [Svelte 5 Critical Patterns](#stateraw-for-event-arrays-with-symbol-data).

#### Supplemental Relay Loading

Loaders resolve relays at creation time, but user override relays (kind 30002) load asynchronously after login. Use a supplemental `$effect` that diffs `getXxxRelays()` against an initial set and spawns a fresh loader for newly-discovered relays — this preserves pagination state on the original loader. See `src/routes/discover/+page.svelte` for the canonical pattern.

#### Per-Relay Pagination

When paginating across multiple relays with different data sets (e.g., user-configured kind 30002 relays), track exhaustion and `until` timestamps **per relay**. A single global `until` + `hasMore` stops pagination as soon as the smallest relay empties.

Implementation lives in `src/routes/discover/+page.svelte` — `exhaustedRelays: Set<string>` and `perRelayOldestTimestamp: Map<string, number>`, both `$state.raw()`. `hasMore` is true while _any_ relay is unexhausted.

**Key points:**

- Use `$state.raw()` for Set/Map — `$state()` proxies break `.has()`/`.get()`/`.set()`
- Reassign the entire Set/Map (don't mutate in place) to trigger Svelte reactivity
- Subtract 1 from `until` to exclude already-fetched boundary events
- Only apply `until` for relays we've seen events from (lets new relays bootstrap)

### Event Deletion (NIP-09)

Use `deleteEvent(event, activeUser)` from `src/lib/helpers/eventDeletion.js` for any content type. Returns `{success: boolean, error?: string}`. Auto-resolves relay category from event kind, verifies ownership, applies the deletion to EventStore optimistically, and uses `factory.delete([event])` (proper NIP-09 with e-tag + a-tag).

### ActionRunner (Event Mutations)

Use the `actionRunner` singleton (`src/lib/stores/action-runner.svelte.js`) for **modifying existing events** (CRUD on replaceables). It reads current state from EventStore, builds a new signed event via EventFactory, publishes via `publishEvent()` (outbox model), and writes back to EventStore.

```javascript
import { actionRunner } from '$lib/stores/action-runner.svelte.js';
import { AddEventToCalendar } from 'applesauce-actions/actions';
await actionRunner.run(AddEventToCalendar, calendarEvent, eventToAdd);
```

Available actions live in `applesauce-actions/actions` — `AddEventToCalendar`/`RemoveEventFromCalendar`, `CreateCalendar`, `FollowUser`/`UnfollowUser`, `BookmarkEvent`, etc. Use `mcp__applesauce__search_methods` to discover the full list.

**Use ActionRunner for CRUD on replaceables.** For brand-new events with no prior state to read (e.g., `factory.delete()` for NIP-09), use EventFactory directly. Wrap calls in try/catch — rejections surface the underlying publish/sign error.

## Educational Content (AMB - kind 30142)

Educational content uses the AMB (Allgemeines Metadatenprofil) spec with JSON-flattening:

- Search via NIP-50 `search` filter parameter
- SKOS vocabularies for classification (learningResourceType, about, audience)
- Special relay for AMB indexing: `runtimeConfig.educational.ambRelays`

### NIP-50 Search Implementation

**IMPORTANT:** Use `pool.request()` directly for NIP-50 searches, NOT `createTimelineLoader` — `createTimelineLoader` strips unknown filter fields including `search`. See `src/lib/loaders/amb-search.js` and `src/lib/helpers/educational/searchQueryBuilder.js`.

### SKOS Filter Pattern

```javascript
// Use concept IDs, not labels
parts.push(`learningResourceType.id:${concept.id}`);
// Example: learningResourceType.id:https://w3id.org/kim/hcrt/text
```

### Resource Form Variants (kind 30142)

The "Share Learning Resource" flow runs through `ResourceFormWizard.svelte` with a `variantId` prop. Variants are deployment-gated via `RESOURCE_FORM_VARIANTS` env (comma-separated, default `amb`).

**NIP-32 labeling:** Published events carry `["L", "metadata-form"]` + `["l", variantId, "metadata-form"]` so edit flows can reopen the correct form. `resolveVariantFromEvent.js` falls back to `'amb'` when missing.

Single-variant deployments skip the picker modal (FAB navigates directly). Legacy `/create/resource` always redirects via `+page.svelte`, preserving `?community=` and `?edit=`. Registry lives in `src/lib/config/resource-form-variants.js`.

## DMs & Inbox

- **NIP-17 DMs:** `src/lib/services/dm-service.svelte.js` subscribes to kind 1059 gift wraps (`#p` = user) on the user's DM relays (kind 10050); sending goes through `gift-wrap-publish.js`. New users get a default kind 10050 pointing at `DM_RELAYS` at signup.
- **Inbox/notifications:** `src/lib/services/inbox-service.svelte.js`. Last-seen is synced as NIP-78 app data (d-tag `comcal/inbox/last-seen` — legacy name, do not change; existing users' state depends on it), per-item read state in localStorage. Notifications are intentionally **ungated**: the inbox always queries fallback + user read relays even in gated mode — do not re-gate.

## Calendar Events (NIP-52)

- Kind 31922: Date-based (all-day events)
- Kind 31923: Time-based (specific times)
- Required tags: `d` (identifier), `title`, `start`
- Always validate before display: `validateCalendarEvent(event)`

## SSR Considerations

Nostr-dependent routes must disable SSR:

```javascript
// +page.js
export const ssr = false;
export const prerender = false;

export async function load({ params }) {
  return { naddr: params.naddr };
}
```

Then fetch data client-side in the component using `$effect()`.

Link previews (OG tags) are injected server-side for ALL pages by `ogMetaHandle`
(`src/lib/server/og.js`): naddr/nevent content, `/p`+`/c` profiles, `/wiki/<topic>`,
and a default brand tag set (`static/og-default.png`, `APP_OG_DESCRIPTION`,
`OG_DEFAULT_IMAGE`) for everything else. Extraction reuses `getFeedCardData`.

## Development Environment

### Nix (Recommended)

The dev shell (Node 22 + pnpm + Chromium + Playwright drivers) auto-activates via `direnv allow`, or enter manually with `nix develop`. **E2E tests require the nix shell** — Chromium is provided by nix, not installed via `npx playwright install`.

### Git Worktrees

Prefer developing in **git worktrees** instead of swapping branches in the main checkout. This keeps the main working tree stable, avoids clobbering in-flight changes, and is essential for **multi-agent workflows** where several Claude sessions work in parallel on different branches without stepping on each other's files, dev servers, or `node_modules` state.

See the `superpowers:using-git-worktrees` skill for the mechanics (creating, listing, removing worktrees, branch isolation).

### Commands

```bash
pnpm install         # Install dependencies
pnpm run dev         # Start dev server
pnpm run build       # Production build
pnpm run check       # TypeScript checking
pnpm run lint        # Prettier + ESLint
pnpm run format      # Auto-format code
pnpm run machine-translate  # i18n translation
```

## Testing

This project uses **Test-Driven Development (TDD)** — write failing tests first, then implement.

**Prefer unit and component tests over E2E.** E2E tests are slow, flaky, and expensive to maintain. Use them sparingly, for user-visible flows that span multiple components or involve real network/relay behavior. For anything that can be verified with pure logic (helpers, stores, services) or a single rendered component, write a Vitest unit or component test instead. A good rule of thumb:

- **Unit test** (`src/lib/__tests__/`) — helpers, stores, services, pure logic, URL parsers, filter functions
- **Component test** (`src/lib/components/__tests__/`) — a single component's rendering, props, events, a11y
- **E2E test** (`e2e/`) — full-page user flows, multi-component interactions, real navigation/URL sync, real relay behavior

When a bug can be reproduced at the unit or component level, test it there — don't reach for E2E.

### Vitest (Unit + Component Tests)

Commands: `pnpm test` / `test:watch` / `test:unit` (node) / `test:component` (jsdom). Config in `vite.config.js` test block. Place unit tests under `src/lib/__tests__/`, component tests under `src/lib/components/__tests__/`. Annotate with `/** @vitest-environment node */` or `/** @vitest-environment jsdom */`.

### Playwright (E2E Tests)

Run via `pnpm run test:e2e` **inside the nix shell** (Chromium comes from nix; `CHROMIUM_BIN` / `PLAYWRIGHT_BROWSERS_PATH` are set automatically). Config in `playwright.config.js`, tests in `e2e/`.

**Always consult and update `e2e/COVERAGE.md`** when adding/removing/modifying E2E tests — it tracks what's covered and identifies gaps.

Put screenshots in the gitignored screenshot dir so they don't pollute the working tree.

### Test Workflow

Before changing existing behavior, always follow this sequence:

1. **Check** — Search for existing tests covering the code being modified
2. **Baseline** — Run those tests to confirm they pass before your changes
3. **Extend** — Add tests for the new/changed behavior (TDD: write failing test first)
4. **Implement** — Make the code changes
5. **Verify** — Re-run all related tests (unit + E2E) to confirm no regressions

For refactors that preserve behavior (like extracting a shared hook), add tests **before** the refactor to lock in the expected behavior, then verify they still pass after. Prefer component/unit tests for this; reach for E2E only when the behavior can't be exercised below the page level.

## Design Principles

1. **Applesauce First** — always use applesauce for Nostr operations.
2. **TDD + DRY + small comments** — see Testing for workflow.
3. **Verify Applesauce APIs via MCP** before writing new loader/model/subscription code: `mcp__applesauce__search_methods`, `search_docs`, `read_doc`. Use `/applesauce-core` and `/applesauce-relay` skills for protocol-level guidance.

## Theming & Colors

Single default theme: the **edufeed editorial** palette (warm beige page `base-200`, paper cards `base-100`, ink text, teal primary / red secondary / amber accent, Outfit font), defined as the DaisyUI `light` theme in `src/app.css`. Color mode is fixed to light — dark themes are retired; there is no user-facing theme picker. `stil`/`rpi` remain as env-gated deployment families (`THEME_DEFAULT_LIGHT`, exposed as `runtimeConfig.ui?.defaultLightTheme`; `THEME_DEFAULT_DARK` is inert).

**Style against tokens, never literals:** use DaisyUI semantic classes (`bg-base-100`, `text-primary`, …) or the global editorial aliases (`--c-hero`, `--c-band`, `--c-olive-2`, `--c-bg`, `--c-paper`, `--c-ink`, `--c-ink-soft`, `--c-cta`, `--c-rule`, `--font-display`, `--font-script`) defined once on `:root` in `src/app.css` from the active theme. Do NOT hardcode OKLCH values or define per-component `--c-*` blocks — pages must follow whichever theme a deployment ships.

| File                                         | Purpose                                       |
| -------------------------------------------- | --------------------------------------------- |
| `src/app.css`                                | Theme definition + `:root` editorial aliases  |
| `src/lib/stores/app-settings.svelte.js`      | Theme family state (colorMode fixed to light) |
| `src/routes/+layout.svelte` + `src/app.html` | Apply `data-theme` (keep both in sync)        |

## Icon System

Icons live under `src/lib/components/icons/` (subfolders: `calendar/`, `ui/`, `actions/`, `social/`) with a shared `Icon.svelte` wrapper using `currentColor`. Import via the barrel: `import { SearchIcon } from '$lib/components/icons'`. Default size `w-5 h-5`; override via `class_` prop. New icons follow existing examples and must be re-exported from `index.js`.

## Skills

- `/communikey` - Communikey protocol (kinds 10222, 30000, 30222) for community management
- `/applesauce-core` - EventStore operations, models, queries, deletion handling
- `/applesauce-relay` - Relay connections, event publishing, NIP-42 authentication
- `/applesauce-signers` - Event signing patterns and signer abstractions
