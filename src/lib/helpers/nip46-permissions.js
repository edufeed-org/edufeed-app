/**
 * NIP-46 permissions the app asks for when it connects a remote signer.
 *
 * A bunker like Amber approves the CONNECTION once, but it signs a kind
 * automatically only if the client asked for `sign_event:<kind>` at connect
 * time. Every other signature lands in its approval queue — the user has to
 * switch to Amber and tap "allow" per kind. Without any permissions in the
 * connect, logging in alone put a kind 22242 (NIP-42 AUTH for the groups
 * relay, which challenges on connect) into that queue, so the slow-signer
 * toast "Waiting for your signing app…" greeted every bunker login, and each
 * reconnect (switching to Amber backgrounds the browser tab) queued the next
 * one (laoc, 2026-11-04: "NIP-46 login broken?"). Requesting the kinds up
 * front means one approval screen that lists them, then silent signing.
 *
 * Amber drops a bare `sign_event` permission (no kind), so every kind the
 * app signs with the USER's key has to be listed here. Events signed with a
 * community's own key (kind 10222 updates, community profile) never reach
 * the bunker and are not the point of this list. A kind that is missing only
 * falls back to today's behaviour — a per-kind prompt — so when a new signed
 * kind is added to the app, add it here too.
 */

/**
 * Event kinds the app signs with the logged-in user's key that are either
 * signed WITHOUT a user action (relay AUTH, DM seals, app data, identity
 * lists) or everyday member actions. Ascending.
 *
 * Deliberately not the whole catalogue: the list travels inside the
 * nostrconnect:// QR code, and every kind costs ~17 characters of QR
 * payload. ~40 kinds keep the code at QR version ≤ 25 (≈2.5 px per module
 * on the 320 px canvas, scannable from a laptop screen); the full catalogue
 * would be version 36 at 1.5 px per module and fail to scan. Admin,
 * moderator and beta kinds (NIP-29 moderation 9000-9010, call passes 9025,
 * form templates 30168, kanban 8571/30301/30302, labels 1985, Concord
 * 13302/13303/33301, the rarer NIP-51 lists) fall back to one Amber prompt
 * on first use, with "remember my choice". `nip46-permissions.test.js`
 * guards the payload budget.
 */
export const NIP46_SIGNED_KINDS = [
  0, // profile
  1, // note
  3, // contacts
  5, // deletion
  6, // repost
  7, // reaction (incl. "waves" on profiles)
  9, // community chat message
  11, // forum discussion
  13, // NIP-17 seal (DMs) — signed on every message sent
  16, // generic repost
  1018, // poll response
  1063, // file metadata (image license attestation on upload)
  1068, // poll
  1069, // form response (membership application)
  1111, // NIP-22 comment
  9021, // NIP-29 join request
  9022, // NIP-29 leave request
  9802, // highlight
  10000, // mute list
  10002, // NIP-65 relay list — published at signup and by the relay editor
  10003, // bookmark list
  10050, // NIP-17 DM relay list — published at signup
  10063, // Blossom server list
  22242, // NIP-42 relay AUTH — signed at login for the groups relay
  24242, // Blossom upload auth
  27235, // NIP-98 HTTP auth (LiveKit token)
  30000, // follow set (community membership)
  30002, // relay set (app relay overrides)
  30003, // bookmark set
  30023, // long-form article
  30024, // article draft
  30078, // NIP-78 app data — inbox last-seen marker, signed in the background
  30142, // AMB educational resource
  30818, // NIP-54 wiki article
  31922, // date-based calendar event
  31923, // time-based calendar event
  31924, // calendar
  31925, // RSVP
  39701 // NIP-B0 web bookmark
];

/** Encryption methods: NIP-17 DMs, NIP-51 hidden tags, Concord, legacy NIP-04 DMs. */
export const NIP46_ENCRYPTION_PERMISSIONS = [
  'nip04_encrypt',
  'nip04_decrypt',
  'nip44_encrypt',
  'nip44_decrypt'
];

/**
 * The `perms` list for a nostrconnect:// URI or a bunker:// `connect`
 * (NIP-46: `method[:param]`, comma-joined by the signer library).
 * @param {number[]} [kinds]
 * @returns {string[]}
 */
export function buildNip46Permissions(kinds = NIP46_SIGNED_KINDS) {
  return [
    'get_public_key',
    ...kinds.map((kind) => `sign_event:${kind}`),
    ...NIP46_ENCRYPTION_PERMISSIONS
  ];
}
