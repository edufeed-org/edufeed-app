# NIP-29 User Stories — Roadmap (umbrella)

**Date:** 2026-08-19 · **Owner:** laoc · **Session:** claude (group-pointer worktree)

This umbrella coordinates two implementation plans that together fulfill laoc's
three user stories (2026-08-19 conversation) for moderated communities:

1. **App plan:** `docs/superpowers/plans/2026-08-19-nip29-app-stories.md`
   (repo: edufeed-app, branch work in `.worktrees/group-pointer`)
2. **Relay plan:** `docs/superpowers/plans/2026-08-19-pyramid-edufeed-fork.md`
   (repo: `nostr://laoc.xyz/relay.ngit.dev/pyramid-edufeed`, local checkout
   `/home/laoc/coding/edufeed/pyramid-edufeed`; issues live on that repo)

## The three stories → mechanisms

| Story | Mechanism | Where |
| --- | --- | --- |
| S1: flip open→moderated ⇒ linked NIP-29 group, channels, shows in Armada with 10222 picture/description, invite npubs, invitees notified | Already-built root-group provisioning + 10009 `r`/`group` tags. NEW: metadata re-sync on 10222 edits (A7), invite-by-npub as DM with `naddr?invite=` + consent accept (A6), instant put-user kept as "add directly". Dedicated Armada space per community = virtual relay endpoints (R3). | App A6/A7, Relay R3 |
| S2: world-readable + world-joinable channel, join & write instantly, no approval | World tier becomes a NIP-29 `open` group (pyramid auto-admits bare 9021). | App A1 |
| S3: invited → accept; see all channels; join channels by own decision; admins pre-joined | Accept = invite-code redemption (A6). Channel list already public via 10222 pointers. Member self-join on members-tier channels = relay-side parent-member auto-join (R2) with graceful degradation to the pending queue on relays without the patch. Admins pre-joined via admin fan-out at channel creation + admin reconcile (A3/A4). | App A3/A4/A6, Relay R2 |

## Decisions locked in (laoc, 2026-08-19)

- **Both invite modes**: instant put-user ("direkt hinzufügen") AND single-use
  invite codes with consent (DM → accept). Pyramid codes are single-use.
- **World-open channels acceptable**, including non-community-members joining.
- **Members are NOT auto-added to channels** anymore — they see all channels
  and join by own decision. Admins ARE auto-joined. (Retires the blanket
  members-tier fan-out; the machinery is repurposed for admins.)
- **Applications**: keep the Beitrittsanfragen queue; the relay fork stores
  codeless 9021s to closed groups as pending (0xchat-compatible; NIP-29's
  "pending review" language covers it).
- **New default group relay**: `wss://groups.edufeed.org` (env `GROUPS_RELAYS`,
  already plumbed through `/api/config` → `runtimeConfig.groupsRelays`).
  Existing communities keep their pointers (Edufeed test community stays on
  groups.0xchat.com until migrated by hand).
- **Metadata re-sync**: re-issue kind-9002 whenever the 10222 profile changes.
- **Fork workflow**: issues on the pyramid-edufeed nostr repo, PRs reference
  them (`nostr:nevent…`), claude merges as maintainer, laoc builds/deploys.

## Relay fork issues (already filed)

- **R1 pending applications** — nevent1qqsxhzkg33e2mp9f642h294ydtnzjjzlukt4ylej3x65awrhmger76cpz3mhxue69uhhyetvv9ujumn8d96zuer9wcek2tdk
- **R2 parent-member self-join + 9002 parent authorization** — nevent1qqswrden87tjs8mfkj0ekdz93ettfuxwflakhj8xqwwdwt9uxg6uk5cpz3mhxue69uhhyetvv9ujumn8d96zuer9wczdcyfs
- **R3 virtual per-community endpoints** — nevent1qqsqfst0tsasqyr2ypptd949sn9ffpsj062d00zfmy6n3f4n9vyrp5spz3mhxue69uhhyetvv9ujumn8d96zuer9wcmh9yk4

## Sequencing

The two plans run in parallel; app tasks degrade gracefully on un-patched
relays (bare 9021 → stored/pending on 0xchat, rejected-with-reason on stock
pyramid), so nothing blocks on the fork deploy.

1. App A1–A5 (channel model + join UX) — independent.
2. Relay Task 0 (bootstrap fork) → R1 → R2 (R2 builds on R1's code paths).
3. App A6 (invites) + A7 (metadata sync) + A8 (env/docs/error UX) — independent.
4. Relay R3 (virtual endpoints) — after R1/R2 merge.
5. Ops (laoc): flip `.env` `GROUPS_RELAYS`, whitelist community founders on
   groups.edufeed.org (pyramid web UI; NIP-86 `allowpubkey` automation is a
   later option), build+deploy the fork, then point new pointers at
   `/c/<root-id>` endpoints once R3 is live.

## Verified environment facts the plans rely on

- pyramid (upstream HEAD, cloned 2026-08-19): closed-group codeless 9021 →
  final reject; open group → instant auto put-user; invite codes single-use;
  moderation events >60s old rejected; group creation needs NIP-42 auth +
  pyramid membership; private ⇒ closed enforced; 39000-39003 relay-generated.
- groups.edufeed.org NIP-11: khatru/pyramid, `restricted_writes: true`,
  GRASP-01. groups.0xchat.com: khatru (relay29-family), stores pending 9021s,
  rejects 9009.
- Armada: rail = relay URLs from 10009 `r` tags (paths preserved by
  `normalizeRelayUrl`); NIP-11 name/icon used for the rail entry; 39000s
  filtered by NIP-11 `self`; invite = 9009 code in a shared link
  (`naddr…?invite=<code>` per spec), auto-join on open; putUser only for roles;
  no subgroup rendering; no invite notifications.
- NIP-29 spec: subgroups via `parent`/`child` (fiatjaf.com/nostr nip29 lib
  already parses/applies `parent`); join-request rejection message SHOULD say
  whether pending; `naddr?invite=` is the standard invite identifier.
