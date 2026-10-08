import { WebSocketServer } from 'ws';
import http from 'http';
import { createHmac } from 'crypto';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { matchesFilter, queryEvents } from './mock-relay.js';

// Fidelity gap: real NIP-29 relays seat the kind-9007 create-group event's
// author as a 39001 admin at creation time. This mock leaves a group's
// rosters empty until the first 9000 (put-user) or 9021 (join-request)
// lands — applyModerationEvent's CREATE_GROUP_KIND branch only applies
// metadata tags, it does not add the creator to `group.admins`. Recorded,
// not fixed: a future application-flow E2E that asserts the creator shows
// up as admin immediately after 9007 (before any 9000/9021) needs
// creator-as-admin implemented here first — or pass `creatorIsAdmin: true`
// to startRelay (the breakout-room harness does: a breakout room's creator
// must be its admin to seat people and delete it).

// NIP-29 event kinds (mirrors applesauce-common/helpers/groups constants —
// duplicated here so this module has no app dependency beyond nostr-tools).
const CREATE_GROUP_KIND = 9007;
const EDIT_METADATA_KIND = 9002;
const PUT_USER_KIND = 9000;
const REMOVE_USER_KIND = 9001;
const CREATE_INVITE_KIND = 9009;
const JOIN_REQUEST_KIND = 9021;
const LEAVE_REQUEST_KIND = 9022;
const DELETE_EVENT_KIND = 9005;
const DELETE_GROUP_KIND = 9008;
const GROUP_METADATA_KIND = 39000;
const GROUP_ADMINS_KIND = 39001;
const GROUP_MEMBERS_KIND = 39002;

const MODERATION_KINDS = new Set([
  CREATE_GROUP_KIND,
  EDIT_METADATA_KIND,
  PUT_USER_KIND,
  REMOVE_USER_KIND,
  CREATE_INVITE_KIND,
  JOIN_REQUEST_KIND,
  LEAVE_REQUEST_KIND,
  DELETE_EVENT_KIND,
  DELETE_GROUP_KIND
]);

const NIP11 = JSON.stringify({
  name: 'Mock NIP-29 Relay',
  supported_nips: [1, 9, 11, 29],
  software: 'mock-nip29-relay',
  version: '0.0.1'
});

/** @param {string[][]} tags @param {string} name @returns {string|undefined} */
function tagValue(tags, name) {
  return tags.find((t) => t[0] === name)?.[1];
}

/**
 * @typedef {object} GroupState
 * @property {string} id
 * @property {{name?: string, about?: string, picture?: string, isPublic: boolean, isOpen: boolean, restricted: boolean, hidden: boolean, livekit: boolean, parent?: string, ephemeral?: string, until?: number}} metadata
 * @property {Map<string, string[]>} admins pubkey -> roles (only entries with roles.length > 0 are kept)
 * @property {Set<string>} members
 * @property {Set<string>} inviteCodes registered via kind 9009
 */

/** @param {string} id @returns {GroupState} */
function createGroupState(id) {
  return {
    id,
    metadata: { isPublic: false, isOpen: false, restricted: false, hidden: false, livekit: false },
    admins: new Map(),
    members: new Set(),
    inviteCodes: new Set()
  };
}

/**
 * Apply create/edit-metadata tags onto a group's metadata. Mirrors
 * group-management.js's metadataTags(): every field is optional, but the
 * public/private and open/closed pairs are mutually-exclusive markers — the
 * side present in the event wins.
 * @param {GroupState['metadata']} metadata
 * @param {string[][]} tags
 */
function applyMetadataTags(metadata, tags) {
  for (const tag of tags) {
    switch (tag[0]) {
      case 'name':
        metadata.name = tag[1];
        break;
      case 'about':
        metadata.about = tag[1];
        break;
      case 'picture':
        metadata.picture = tag[1];
        break;
      case 'public':
        metadata.isPublic = true;
        break;
      case 'private':
        metadata.isPublic = false;
        break;
      case 'open':
        metadata.isOpen = true;
        break;
      case 'closed':
        metadata.isOpen = false;
        break;
      case 'restricted':
        metadata.restricted = true;
        break;
      // pyramid semantics: `hidden` has no negation tag (absence keeps the
      // value); `livekit` is overwritten from every 9002 (absence switches it
      // off); `parent` names the channel this group hangs under.
      case 'hidden':
        metadata.hidden = true;
        break;
      case 'livekit':
        metadata.livekit = true;
        break;
      case 'parent':
        metadata.parent = tag[1] || undefined;
        break;
      // NIP-29 extension "ephemeral groups" (docs/nips/nip29-ephemeral-groups.md):
      // stored and restated verbatim on the 39000, so the `#ephemeral` read
      // and `isBreakoutGroup` work against this mock as against pyramid
      // edufeed-v1.12. `until` may change on a later 9002; `ephemeral` is
      // fixed after creation (an edit that changes it is refused below).
      case 'ephemeral':
        metadata.ephemeral = tag[1] || undefined;
        break;
      case 'until': {
        const until = Number(tag[1]);
        metadata.until = Number.isFinite(until) ? until : undefined;
        break;
      }
    }
  }
}

/**
 * @param {GroupState['metadata']} metadata @param {string[][]} tags
 * @returns {string | null} a refusal reason, or null when applied
 */
function applyEditMetadataTags(metadata, tags) {
  const ephemeral = tagValue(tags, 'ephemeral');
  if ((metadata.ephemeral ?? undefined) !== (ephemeral || undefined)) {
    return 'restricted: ephemeral cannot be changed after creation';
  }
  metadata.livekit = false;
  // `until` is overwritten from every edit (absence removes the deadline).
  metadata.until = undefined;
  applyMetadataTags(metadata, tags);
  return null;
}

/**
 * Apply one NIP-29 moderation event to the relay's group-state map.
 * @param {Map<string, GroupState>} groups
 * @param {import('nostr-tools').NostrEvent} event
 * @param {{creatorIsAdmin?: boolean, enforceModeration?: boolean}} [options]
 * @param {Map<string, string>} [callHosts] group id -> pubkey hosting its call (enforceModeration)
 * @returns {{group: GroupState, changed: boolean, stored?: boolean, deletes?: string[], deletedGroup?: boolean, refused?: string} | null} null when the
 *   event carries no resolvable group id (or targets an unknown group,
 *   for any kind other than create).
 */
function applyModerationEvent(groups, event, options = {}, callHosts = new Map()) {
  const groupId = tagValue(event.tags, 'h');
  if (!groupId) return null;

  if (event.kind === CREATE_GROUP_KIND) {
    const group = groups.get(groupId) ?? createGroupState(groupId);
    applyMetadataTags(group.metadata, event.tags);
    if (options.creatorIsAdmin) {
      group.admins.set(event.pubkey, ['admin']);
      group.members.add(event.pubkey);
    }
    groups.set(groupId, group);
    return { group, changed: true };
  }

  const group = groups.get(groupId);
  if (!group) return null;

  // Rights, when asked to enforce them (off by default — the e2e suite's
  // open relay): put-user / remove-user / edit-metadata / delete-group from
  // the group's admins; for an EPHEMERAL group also from the parent's admins
  // and the parent's current call host (the extension's rule), the
  // co-hosts being unknown to this mock.
  if (
    options.enforceModeration &&
    [PUT_USER_KIND, REMOVE_USER_KIND, EDIT_METADATA_KIND, DELETE_GROUP_KIND].includes(event.kind)
  ) {
    const parent = group.metadata.ephemeral ? groups.get(group.metadata.ephemeral) : undefined;
    const allowed =
      group.admins.has(event.pubkey) ||
      (parent !== undefined &&
        (parent.admins.has(event.pubkey) || callHosts.get(parent.id) === event.pubkey));
    if (!allowed) return { group, changed: false, refused: 'restricted: insufficient permissions' };
  }

  switch (event.kind) {
    case EDIT_METADATA_KIND: {
      const refused = applyEditMetadataTags(group.metadata, event.tags);
      return refused ? { group, changed: false, refused } : { group, changed: true };
    }

    case DELETE_GROUP_KIND:
      // pyramid archives every event of the group and drops it from memory;
      // the caller fans the raw 9008 out live, drops the group's events and
      // publishes a `[deleted]` tombstone 39000 (what other relays emit).
      groups.delete(groupId);
      return { group, changed: false, deletedGroup: true };

    case PUT_USER_KIND: {
      const pTag = event.tags.find((t) => t[0] === 'p');
      if (!pTag?.[1]) return { group, changed: false };
      const [, pubkey, ...roles] = pTag;
      // Roles non-empty -> also an admin entry (39001); membership (39002)
      // is granted unconditionally.
      if (roles.length > 0) group.admins.set(pubkey, roles);
      group.members.add(pubkey);
      return { group, changed: true };
    }

    case REMOVE_USER_KIND: {
      const pubkey = tagValue(event.tags, 'p');
      if (!pubkey) return { group, changed: false };
      group.members.delete(pubkey); // 39002 only — admin roster untouched
      return { group, changed: true };
    }

    case CREATE_INVITE_KIND: {
      const code = tagValue(event.tags, 'code');
      if (code) group.inviteCodes.add(code);
      return { group, changed: false }; // invite codes aren't roster state
    }

    case JOIN_REQUEST_KIND: {
      const code = tagValue(event.tags, 'code');
      if (code) {
        if (!group.inviteCodes.has(code)) return { group, changed: false };
        group.members.add(event.pubkey);
        return { group, changed: true };
      }
      // Closed group, no code: real relays (pyramid, khatru) STORE the bare
      // request so admins can read it back as the "Beitrittsanfragen" queue
      // (JoinRequestsPanel). `stored: true` asks the caller to persist + fan
      // out the raw 9021 — the one moderation command that is queryable.
      if (!group.metadata.isOpen) return { group, changed: false, stored: true };
      group.members.add(event.pubkey);
      return { group, changed: true };
    }

    case DELETE_EVENT_KIND:
      // Admin delete-event: the caller drops every `e`-tagged event of this
      // group from the store (the declined 9021s, deleted chat messages).
      return {
        group,
        changed: false,
        deletes: event.tags.filter((t) => t[0] === 'e').map((t) => t[1])
      };

    case LEAVE_REQUEST_KIND:
      group.members.delete(event.pubkey); // 39002 only, symmetric with remove-user
      return { group, changed: true };

    default:
      return null;
  }
}

/**
 * Build the relay-signed 39000/39001/39002 for a group's current state.
 * @param {GroupState} group
 * @param {Uint8Array} relaySecretKey
 * @returns {import('nostr-tools').NostrEvent[]}
 */
function buildRosterEvents(group, relaySecretKey) {
  const now = Math.floor(Date.now() / 1000);

  const metadataTags = [['d', group.id]];
  if (group.metadata.name) metadataTags.push(['name', group.metadata.name]);
  if (group.metadata.about) metadataTags.push(['about', group.metadata.about]);
  if (group.metadata.picture) metadataTags.push(['picture', group.metadata.picture]);
  metadataTags.push([group.metadata.isPublic ? 'public' : 'private']);
  metadataTags.push([group.metadata.isOpen ? 'open' : 'closed']);
  if (group.metadata.restricted) metadataTags.push(['restricted']);
  if (group.metadata.hidden) metadataTags.push(['hidden']);
  if (group.metadata.livekit) metadataTags.push(['livekit']);
  if (group.metadata.parent) metadataTags.push(['parent', group.metadata.parent]);
  if (group.metadata.ephemeral) metadataTags.push(['ephemeral', group.metadata.ephemeral]);
  if (group.metadata.until !== undefined)
    metadataTags.push(['until', String(group.metadata.until)]);

  const adminTags = [['d', group.id]];
  for (const [pubkey, roles] of group.admins) {
    if (roles.length > 0) adminTags.push(['p', pubkey, ...roles]);
  }

  const memberTags = [['d', group.id]];
  for (const pubkey of group.members) memberTags.push(['p', pubkey]);

  return [
    finalizeEvent(
      { kind: GROUP_METADATA_KIND, created_at: now, tags: metadataTags, content: '' },
      relaySecretKey
    ),
    finalizeEvent(
      { kind: GROUP_ADMINS_KIND, created_at: now, tags: adminTags, content: '' },
      relaySecretKey
    ),
    finalizeEvent(
      { kind: GROUP_MEMBERS_KIND, created_at: now, tags: memberTags, content: '' },
      relaySecretKey
    )
  ];
}

/**
 * Store an event, applying replaceable/addressable overwrite for kinds
 * 39000-39003 (latest per kind+d wins).
 * @param {import('nostr-tools').NostrEvent[]} storedEvents
 * @param {import('nostr-tools').NostrEvent} event
 */
function storeEvent(storedEvents, event) {
  if (event.kind >= 39000 && event.kind <= 39003) {
    const d = tagValue(event.tags, 'd') ?? '';
    for (let i = storedEvents.length - 1; i >= 0; i--) {
      const existing = storedEvents[i];
      if (existing.kind === event.kind && (tagValue(existing.tags, 'd') ?? '') === d) {
        storedEvents.splice(i, 1);
      }
    }
  }
  storedEvents.push(event);
}

/**
 * Push an event to every open subscription whose filters match it.
 * @param {Array<{ws: import('ws').WebSocket, subId: string, filters: import('nostr-tools').Filter[]}>} subscriptions
 * @param {import('nostr-tools').NostrEvent} event
 */
function fanOut(subscriptions, event) {
  for (const sub of subscriptions) {
    if (sub.filters.some((filter) => matchesFilter(event, filter))) {
      sub.ws.send(JSON.stringify(['EVENT', sub.subId, event]));
    }
  }
}

/** @param {string | Buffer} input */
const b64url = (input) => Buffer.from(input).toString('base64url');

/**
 * A LiveKit access token (HS256 JWT) the way livekit-server --dev accepts it
 * (API key `devkey`, secret `secret`): room join with full publish rights
 * and the participant metadata the relay would set (host / co-host / guest).
 * @param {{apiKey: string, apiSecret: string}} keys
 * @param {{room: string, identity: string, metadata?: string}} grant
 */
export function livekitDevToken({ apiKey, apiSecret }, { room, identity, metadata }) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      iss: apiKey,
      sub: identity,
      nbf: now - 10,
      exp: now + 6 * 3600,
      ...(metadata ? { metadata } : {}),
      video: {
        room,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true
      }
    })
  );
  const signature = createHmac('sha256', apiSecret).update(`${header}.${payload}`).digest();
  return `${header}.${payload}.${b64url(signature)}`;
}

/**
 * The pubkey of the NIP-98 event in an `Authorization: Nostr <base64>` header
 * (the mock trusts it — no signature check).
 * @param {string | undefined} header
 */
function nip98Pubkey(header) {
  if (!header?.startsWith('Nostr ')) return null;
  try {
    const event = JSON.parse(Buffer.from(header.slice(6), 'base64').toString('utf8'));
    return typeof event?.pubkey === 'string' ? event.pubkey : null;
  } catch {
    return null;
  }
}

/**
 * Start an in-process NIP-29-capable mock relay: in-memory NIP-01 base
 * (reusing mock-relay.js's matchesFilter/queryEvents), replaceable overwrite
 * for kinds 39000-39003, live subscription fan-out, and NIP-29 moderation
 * (9007/9002/9000/9001/9008/9009/9021/9022) that regenerates + fans out the
 * relay-signed 39000/39001/39002 after every accepted moderation event.
 * No NIP-42 — the relay is intentionally open.
 *
 * Options (all off by default, so the e2e suite's behaviour is unchanged):
 * - `creatorIsAdmin`: seat the 9007 author as admin + member at creation,
 *   like pyramid does.
 * - `livekit: {serverUrl, apiKey, apiSecret}`: serve the NIP-29 AV endpoints
 *   (`/.well-known/nip29/livekit` → 204, `/.well-known/nip29/livekit/<id>`
 *   → dev JWT for a livekit-enabled group; the first seat of a room is its
 *   host, exactly pyramid's "opener" rule) so a local livekit-server --dev
 *   can carry real calls against this relay.
 * Always on: the ephemeral-groups extension (`ephemeral` / `until` stored
 * and restated on the 39000, `#ephemeral` answered through the generic tag
 * filter, a 9002 that changes `ephemeral` refused), ephemeral kinds
 * (20000-29999) relayed without being stored, and `POST
 * /__mock/delete-group/<id>` as the relay-side deletion of an ephemeral
 * group (relay-signed 9008 + tombstone, like a user's 9008).
 * - `enforceModeration`: refuse 9000/9001/9002/9008 from anyone but the
 *   group's admins — and, for an ephemeral group, the parent's admins and
 *   the parent's current call host (`POST /__mock/call-host/<group>/<pubkey>`
 *   moves that seat, as pyramid does on a hand-over).
 * @param {number} port
 * @param {{creatorIsAdmin?: boolean, enforceModeration?: boolean, livekit?: {serverUrl: string, apiKey: string, apiSecret: string}}} [options]
 * @returns {Promise<{server: http.Server, wss: WebSocketServer, relayPubkey: string}>}
 */
export function startRelay(port, options = {}) {
  /** @type {Map<string, GroupState>} */
  const groups = new Map();
  /** @type {Map<string, string>} group id -> pubkey hosting its call */
  const callHosts = new Map();
  const relaySecretKey = generateSecretKey();
  const relayPubkey = getPublicKey(relaySecretKey);
  /** @type {import('nostr-tools').NostrEvent[]} */
  const storedEvents = [];
  /** @type {Array<{ws: import('ws').WebSocket, subId: string, filters: import('nostr-tools').Filter[]}>} */
  const subscriptions = [];

  /**
   * Tear a group down the way pyramid does on a 9008 — a user's or, for an
   * ephemeral group, the relay's own (room finished, deadline, sweep): the
   * 9008 fans out live, the group's events are dropped and its 39000 becomes
   * the `[deleted]` tombstone.
   * @param {string} gid
   * @param {import('nostr-tools').NostrEvent} [deleteEvent] the 9008 (relay-signed when omitted)
   */
  function deleteGroup(gid, deleteEvent) {
    groups.delete(gid);
    const now = Math.floor(Date.now() / 1000);
    fanOut(
      subscriptions,
      deleteEvent ??
        finalizeEvent(
          { kind: DELETE_GROUP_KIND, created_at: now, tags: [['h', gid]], content: '' },
          relaySecretKey
        )
    );
    for (let i = storedEvents.length - 1; i >= 0; i--) {
      const stored = storedEvents[i];
      if (tagValue(stored.tags, 'h') === gid || tagValue(stored.tags, 'd') === gid) {
        storedEvents.splice(i, 1);
      }
    }
    callHosts.delete(gid);
    const tombstone = finalizeEvent(
      {
        kind: GROUP_METADATA_KIND,
        created_at: now,
        tags: [['d', gid], ['name', '[deleted]'], ['private'], ['closed']],
        content: ''
      },
      relaySecretKey
    );
    storeEvent(storedEvents, tombstone);
    fanOut(subscriptions, tombstone);
  }

  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const cors = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
      };
      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors);
        res.end();
        return;
      }
      // Test hook: the relay deletes an ephemeral group itself (what
      // pyramid does on room_finished / until / sweep) — POST
      // /__mock/delete-group/<id>. Only for groups that carry `ephemeral`.
      const callHost = req.url?.match(/^\/__mock\/call-host\/([^/?]+)\/([0-9a-f]{64})$/);
      if (callHost && req.method === 'POST') {
        callHosts.set(decodeURIComponent(callHost[1]), callHost[2]);
        res.writeHead(204, cors);
        res.end();
        return;
      }
      const relayDelete = req.url?.match(/^\/__mock\/delete-group\/([^/?]+)$/);
      if (relayDelete && req.method === 'POST') {
        const gid = decodeURIComponent(relayDelete[1]);
        const group = groups.get(gid);
        if (!group?.metadata.ephemeral) {
          res.writeHead(404, cors);
          res.end('no such ephemeral group');
          return;
        }
        deleteGroup(gid);
        res.writeHead(204, cors);
        res.end();
        return;
      }
      const livekitPath = req.url?.match(
        /^\/\.well-known\/nip29\/livekit(?:\/([^/?]+))?\/?(?:\?.*)?$/
      );
      if (!livekitPath && req.url?.startsWith('/.well-known/nip29/livekit/') && options.livekit) {
        // pass checks, moderation: not part of this mock
        res.writeHead(404, cors);
        res.end('not supported by the mock relay');
        return;
      }
      if (livekitPath && options.livekit) {
        const groupId = livekitPath[1] ? decodeURIComponent(livekitPath[1]) : null;
        if (!groupId) {
          res.writeHead(204, cors);
          res.end();
          return;
        }
        const pubkey = nip98Pubkey(req.headers.authorization);
        if (!pubkey) {
          res.writeHead(401, cors);
          res.end('missing nip-98 auth');
          return;
        }
        const group = groups.get(groupId);
        if (!group || !group.metadata.livekit) {
          res.writeHead(403, cors);
          res.end('livekit not enabled for this group');
          return;
        }
        if (!callHosts.has(groupId)) callHosts.set(groupId, pubkey);
        const identity = `${pubkey}:${Math.random().toString(36).slice(2, 8)}`;
        const metadata = callHosts.get(groupId) === pubkey ? JSON.stringify({ host: true }) : '';
        const token = livekitDevToken(options.livekit, { room: groupId, identity, metadata });
        res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ server_url: options.livekit.serverUrl, participant_token: token })
        );
        return;
      }
      if (req.headers.accept?.includes('application/nostr+json')) {
        res.writeHead(200, {
          'Content-Type': 'application/nostr+json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(NIP11);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Mock NIP-29 Relay');
    });

    const wss = new WebSocketServer({ server });

    wss.on('connection', (ws) => {
      ws.on('close', () => {
        for (let i = subscriptions.length - 1; i >= 0; i--) {
          if (subscriptions[i].ws === ws) subscriptions.splice(i, 1);
        }
      });

      /** @param {any} raw */
      const onMessage = (raw) => {
        let message;
        try {
          message = JSON.parse(raw.toString());
        } catch {
          return;
        }

        const [type, ...rest] = message;

        if (type === 'REQ') {
          const [subId, ...filters] = rest;
          const results = queryEvents(storedEvents, filters);
          for (const event of results) {
            ws.send(JSON.stringify(['EVENT', subId, event]));
          }
          ws.send(JSON.stringify(['EOSE', subId]));
          // Leave the subscription registered so subsequently published
          // matching events are fanned out live.
          for (let i = subscriptions.length - 1; i >= 0; i--) {
            if (subscriptions[i].ws === ws && subscriptions[i].subId === subId) {
              subscriptions.splice(i, 1);
            }
          }
          subscriptions.push({ ws, subId, filters });
        } else if (type === 'CLOSE') {
          const [subId] = rest;
          for (let i = subscriptions.length - 1; i >= 0; i--) {
            if (subscriptions[i].ws === ws && subscriptions[i].subId === subId) {
              subscriptions.splice(i, 1);
            }
          }
        } else if (type === 'EVENT') {
          /** @type {import('nostr-tools').NostrEvent} */
          const event = rest[0];
          if (!event?.id) return;

          if (MODERATION_KINDS.has(event.kind)) {
            const result = applyModerationEvent(groups, event, options, callHosts);
            if (result?.refused) {
              ws.send(JSON.stringify(['OK', event.id, false, result.refused]));
              return;
            }
            ws.send(JSON.stringify(['OK', event.id, true, '']));
            if (result?.deletedGroup) {
              // live subscribers see the 9008 itself; afterwards the group's
              // events are gone and its 39000 is the `[deleted]` tombstone
              deleteGroup(result.group.id, event);
              return;
            }
            if (result?.changed) {
              for (const rosterEvent of buildRosterEvents(result.group, relaySecretKey)) {
                storeEvent(storedEvents, rosterEvent);
                fanOut(subscriptions, rosterEvent);
              }
            }
            if (result?.deletes?.length) {
              const gone = new Set(result.deletes);
              for (let i = storedEvents.length - 1; i >= 0; i--) {
                if (gone.has(storedEvents[i].id)) storedEvents.splice(i, 1);
              }
            }
            // Raw moderation commands aren't persisted/queryable — only the
            // roster state they produce (39000/39001/39002) is. The one
            // exception is a bare join request on a closed group, which real
            // relays keep for the admin queue.
            if (result?.stored) {
              storeEvent(storedEvents, event);
              fanOut(subscriptions, event);
            }
            return;
          }

          ws.send(JSON.stringify(['OK', event.id, true, '']));
          // Ephemeral kinds (20000-29999, NIP-01): relayed to whoever listens
          // right now, never stored — what a kind-20002 call broadcast needs.
          if (event.kind >= 20000 && event.kind < 30000) {
            fanOut(subscriptions, event);
            return;
          }
          storeEvent(storedEvents, event);
          fanOut(subscriptions, event);
        }
      };
      ws.on('message', onMessage);
    });

    server.listen(port, () => {
      resolve({ server, wss, relayPubkey });
    });
  });
}

/**
 * Stop the mock relay server.
 * @param {{server: http.Server, wss: WebSocketServer}} relay
 * @returns {Promise<void>}
 */
export function stopRelay({ server, wss }) {
  return new Promise((resolve) => {
    for (const client of wss.clients ?? []) {
      client.terminate();
    }
    wss.close(() => {
      server.close(() => resolve());
    });
  });
}
