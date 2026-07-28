# Concord: Fix Invites on Public Channels — Design

**Date:** 2026-07-28
**Status:** Approved (design), pending plan
**Branch:** `worktree-cordn-groups`
**Type:** Bug fix (regression exposed by the public/private channel toggle)

## Bug

Creating ANY invite (link or direct) while a **public** (`#`) channel is selected throws:

```
Error: not a private channel we hold a key for: <channelId>
  at buildInviteBundle → ConcordCommunity.createInvite → createChannelInviteOnce → ChannelInviteSheet
```

Reproduced live: on the fresh area's `# general` channel, the Link/QR mint fails and
direct invite would fail identically. (Not caught earlier because the old area had a
private channel selected by default, and the direct-invite path was only smoke-tested
up to npub resolution, never a real send.)

## Root cause (verified in `applesauce-concord/dist`)

`buildInviteBundle(material, { channels })` (`helpers/invite-bundle.js:140`) maps each
requested channel id through `material.channels.find(c => c.id === id)` — and
`material.channels` holds **only PRIVATE channel keys the user holds**. A public
channel derives its chat key from `material.community_root` (no per-channel key), so it
is absent → throws `not a private channel we hold a key for`.

Therefore, per the SDK's real model:
- **Public channel** → inviting = adding an **area member**; the bundle must use
  `channels: []` (an area invite; public channels become readable via `community_root`).
- **Private channel** → `channels: [id]` (area membership + that channel's key).
- `createInvite({ channels: [] })` **works** for the LINK (area invite).
- `grantChannelAccess(channels, member)` (`client/community.js:840`) **refuses**
  `channels: []` ("no channels to grant") and passes ids through `buildInviteBundle` —
  so it works ONLY for private channels. There is **no built-in direct/gift-wrap area
  invite** in the SDK.

Affected call sites (all pass a public channel id into the private-only path):
1. `ChannelInviteSheet` Link tab — `createChannelInviteOnce(..., { channels: [channel.channel_id] })`.
2. `ChannelInviteSheet` Direct tab — `grantChannelAccess(channel.channel_id, pubkey)`.
3. `ChannelCreateWizard.create()` — `grantChannelAccess(channelId, pubkey)` when the
   newly-created channel is public.

## Design (decision: add an area direct-invite helper)

### New helper: `src/lib/concord/area-invite.js`

A gift-wrapped **area** direct invite — mirrors `grantChannelAccess` (community.js:840-856)
but with `channels: []`. Uses dynamic package imports exactly like `send-message.js`
(SSR-safety: keeps the concord dep tree out of SSR chunks). Verified the exports and
instance fields exist: `buildInviteBundle` via `applesauce-concord/helpers`,
`DirectInviteFactory` via `applesauce-concord/factories`; the community instance exposes
`material`, `signer`, `pubkey`, `pool`, `eventStore`, `state$`, `relays()`.

```js
export async function directInviteToArea(community, member) {
  const { buildInviteBundle } = await import('applesauce-concord/helpers');
  const { DirectInviteFactory } = await import('applesauce-concord/factories');
  const state = community.state$?.value;
  const bundle = buildInviteBundle(community.material, {
    name: state?.metadata?.name,
    icon: state?.metadata?.icon,
    creator_npub: community.pubkey,
    channels: []
  });
  const wrap = await DirectInviteFactory.create(bundle, member, community.signer);
  community.eventStore.add(wrap);
  await community.pool
    .publish(community.relays(), wrap)
    .catch((e) => console.warn('concord: area invite publish failed', e));
}
```

### `src/lib/concord/invite-helpers.js`

Generalize `pickLatestChannelInvite` so a public channel reuses the latest live **area**
invite (`channels` empty) instead of never matching and re-minting. Signature becomes
`pickLatestChannelInvite(links, channelId, isPrivate = true)`; for `isPrivate=false`
match `!link.channels?.length`.

### `src/lib/components/community/channels/ChannelInviteSheet.svelte`

- Link effect: `pickLatestChannelInvite(..., channel.channel_id, channel.private)`, and
  mint with `channels: channel.private ? [channel.channel_id] : []`. Dedup key for the
  public case is stable per area (e.g. pass `channel.private ? channel.channel_id : 'area'`
  to `createChannelInviteOnce`).
- `directInvite(pubkey)`: if `channel.private` → `community.grantChannelAccess(channel.channel_id, pubkey)`;
  else → `(await import('$lib/concord/area-invite.js')).directInviteToArea(community, pubkey)`.
  Keep the existing success/error toasts.

### `src/lib/components/community/channels/ChannelCreateWizard.svelte`

In `create()`'s invitee loop: `isPrivate` → `target.grantChannelAccess(channelId, pubkey)`;
else → `directInviteToArea(target, pubkey)` (dynamic import). Founding + partial-failure
handling unchanged.

## Testing

- **`area-invite.test.js`** (unit): mock `applesauce-concord/helpers` + `applesauce-concord/factories`; assert `buildInviteBundle` called with `channels: []`, `DirectInviteFactory.create(bundle, member, signer)` called, and `community.pool.publish(relays, wrap)` called; a publish rejection is swallowed (no throw).
- **`invite-helpers`**: extend the pick test — a public channel picks the latest area invite (empty channels); a private channel still matches by id.
- **`ChannelInviteSheet`**: on a PUBLIC channel, `directInvite` routes to `directInviteToArea` (mock `area-invite.js`) and NOT `grantChannelAccess`; the link mint passes `channels: []`. On a PRIVATE channel, uses `grantChannelAccess(id, pubkey)` and `channels: [id]`.
- **`ChannelCreateWizard`**: creating a PUBLIC channel with a pre-selected invitee calls `directInviteToArea`; a PRIVATE channel calls `grantChannelAccess`.
- **Browser E2E (manual, in verification):** actually invite **laoc42** on `# general` — expect the "Einladung gesendet" toast, no console error, and the Link/QR tab renders a link.

## Scope boundaries

- No SDK/relay/protocol changes. The helper only calls existing exported SDK functions.
- No change to the receive/accept inbox, revoke, or the invite-link redemption route.
- `directInviteToArea` intentionally does not add a MANAGE_CHANNELS gate (area invites,
  like `createInvite` links, are not channel-key grants); the UI still gates the Direct
  tab on `signerHasNip44`.

## Files touched

- New: `src/lib/concord/area-invite.js` (+ test)
- `src/lib/concord/invite-helpers.js` (+ existing test)
- `src/lib/components/community/channels/ChannelInviteSheet.svelte` (+ test)
- `src/lib/components/community/channels/ChannelCreateWizard.svelte` (+ test)
