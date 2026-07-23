// Channel-level moderation. Control-plane edits alone do NOT sever key
// access — every removal rotates the channel key ("neues Schloss" — a new
// lock), delivering the fresh key only to the members we keep.
//
// Verified against node_modules/applesauce-concord/dist (Task 13):
//
// - `rotateChannel(channelId, {keep, exclude})` (dist/client/community.js):
//   `recipients = [...new Set([this.pubkey, ...opts.keep])].filter(pk =>
//   !excluded.has(pk))` — the ROTATOR'S OWN pubkey is unconditionally unioned
//   into recipients before the exclude-filter runs. So the moderator can
//   never lock themselves out of a channel they still hold MANAGE_CHANNELS
//   for, even if `keep` happened to omit them — self does NOT need special
//   handling here. (In this module `keep` is `currentMembers` minus the
//   target, and `currentMembers` already includes self via
//   `channelMemberList`, so self is passed explicitly anyway — belt and
//   braces, not a requirement.) `rotateChannel` itself throws synchronously
//   if the caller lacks `MANAGE_CHANNELS`, or tries to exclude someone they
//   don't strictly outrank (CORD-04) — both surface as a rejected promise
//   here, which the modal's try/catch turns into a toast.
// - `rotateChannel` publishes the rekey wraps with `pool.publish(...).catch
//   (err => console.warn(...))` per-wrap — i.e. relay-ack failures are
//   swallowed internally and never reject the returned promise. There is no
//   majority-ack requirement (unlike `refound`, whose plan explicitly warns
//   about ack thresholds) — from this module's perspective `rotateChannel`
//   resolving means "the rekey was built and publishes were attempted", not
//   "every relay stored it". We treat a resolved promise as success; a
//   totally offline relay set still resolves and the UI reports success
//   optimistically (same posture as `grantChannelAccess` elsewhere in this
//   codebase — best-effort delivery, not a two-phase commit).
// - `buildChannelRekey` (dist/helpers/keys.js) `throw`s synchronously if
//   `!signer.nip44` — a channel key can only be delivered wrapped, and
//   wrapping needs NIP-44. So both `kickFromChannel` and `banFromChannel`
//   require a NIP-44-capable signer. Callers MUST gate the moderation UI on
//   `concord.signerHasNip44` (see ChannelMembersModal.svelte) rather than
//   let this reject at click-time with a raw dist error.
// - `community.ban(member)` (delegates to `ConcordCommunityAdmin.ban`) has
//   NO client-side permission gate — unlike `rotateChannel`, it does not
//   throw for a caller lacking authority. Authority is enforced only on the
//   READ side: `foldControl` (dist/helpers/control.js) only honors a
//   BANLIST edition when `s.isOwner || hasPerm(s.permissions, PERM.BAN)` for
//   its author, so a ban from an unauthorized caller is folded away by every
//   other client and silently has no effect. This module doesn't add a
//   client-side check for it (Phase 1 gates the whole modal on `isOwner`,
//   who always holds every permission bit), but a future non-owner-moderator
//   UI must not treat `ban()` resolving as proof the ban took effect.
// - `ban()` already strips the member's roles (`grantRoles(member, [])`)
//   before publishing the banlist edition — no separate role-strip needed
//   here.

/**
 * Approximate member list of a private channel: authors observed writing in
 * the channel ∪ members we (locally) know we granted access to ∪ self.
 *
 * There is no authoritative per-channel roster in CORD Phase 1 — channel
 * membership is defined by key possession, which isn't directly observable
 * (a silent lurker who holds the key but never posted, and was granted
 * access in a PAST session we didn't witness, is invisible to us). The UI
 * labels this list as approximate for that reason.
 *
 * @param {{observed: string[], granted: string[], self: string|undefined}} args
 * @returns {string[]} self first (when present), then observed/granted in
 *   first-seen order, deduped
 */
export function channelMemberList({ observed, granted, self }) {
  const set = new Set(self ? [self] : []);
  for (const p of observed) set.add(p);
  for (const p of granted) set.add(p);
  return [...set];
}

/**
 * Remove `member` from this channel only, by rotating its key to every
 * OTHER current member (re-invitable — no community-level kick, since the
 * member may legitimately still belong to other channels).
 *
 * `currentMembers` is the best-effort list from {@link channelMemberList}:
 * anyone who never posted and wasn't locally recorded as granted is NOT in
 * it, so a rotation silently drops them from `keep` too — they lose the
 * channel key even though nobody asked to remove them. This is accepted
 * Phase-1 behavior (the spec's honest-approximation stance): they can always
 * be re-invited via {@link https://../invite-helpers.js|grantChannelAccess}.
 *
 * @param {{rotateChannel: (channelId: string, opts: {keep: string[], exclude?: string[]}) => Promise<void>}} community
 * @param {string} channelId
 * @param {string} member - pubkey to remove
 * @param {string[]} currentMembers - approximate roster, see {@link channelMemberList}
 * @returns {Promise<void>}
 */
export async function kickFromChannel(community, channelId, member, currentMembers) {
  const keep = currentMembers.filter((p) => p !== member);
  await community.rotateChannel(channelId, { keep, exclude: [member] });
}

/**
 * Ban `member` community-wide (banlist entry — blocks rejoining via any
 * invite link, once enforced by a future Refounding per CORD-06) AND rotate
 * this channel's key to sever their access to new messages immediately.
 *
 * Same `currentMembers` approximation caveat as {@link kickFromChannel}
 * applies to the rotation half of this call.
 *
 * @param {{ban: (member: string) => Promise<void>, rotateChannel: (channelId: string, opts: {keep: string[], exclude?: string[]}) => Promise<void>}} community
 * @param {string} channelId
 * @param {string} member - pubkey to ban
 * @param {string[]} currentMembers - approximate roster, see {@link channelMemberList}
 * @returns {Promise<void>}
 */
export async function banFromChannel(community, channelId, member, currentMembers) {
  await community.ban(member);
  const keep = currentMembers.filter((p) => p !== member);
  await community.rotateChannel(channelId, { keep, exclude: [member] });
}
