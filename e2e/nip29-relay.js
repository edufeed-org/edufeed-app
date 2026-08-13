import { WebSocketServer } from 'ws';
import http from 'http';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { matchesFilter, queryEvents } from './mock-relay.js';

// NIP-29 event kinds (mirrors applesauce-common/helpers/groups constants —
// duplicated here so this module has no app dependency beyond nostr-tools).
const CREATE_GROUP_KIND = 9007;
const EDIT_METADATA_KIND = 9002;
const PUT_USER_KIND = 9000;
const REMOVE_USER_KIND = 9001;
const CREATE_INVITE_KIND = 9009;
const JOIN_REQUEST_KIND = 9021;
const LEAVE_REQUEST_KIND = 9022;
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
  LEAVE_REQUEST_KIND
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
 * @property {{name?: string, about?: string, picture?: string, isPublic: boolean, isOpen: boolean, restricted: boolean}} metadata
 * @property {Map<string, string[]>} admins pubkey -> roles (only entries with roles.length > 0 are kept)
 * @property {Set<string>} members
 * @property {Set<string>} inviteCodes registered via kind 9009
 */

/** @param {string} id @returns {GroupState} */
function createGroupState(id) {
  return {
    id,
    metadata: { isPublic: false, isOpen: false, restricted: false },
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
    }
  }
}

/**
 * Apply one NIP-29 moderation event to the relay's group-state map.
 * @param {Map<string, GroupState>} groups
 * @param {import('nostr-tools').NostrEvent} event
 * @returns {{group: GroupState, changed: boolean} | null} null when the
 *   event carries no resolvable group id (or targets an unknown group,
 *   for any kind other than create).
 */
function applyModerationEvent(groups, event) {
  const groupId = tagValue(event.tags, 'h');
  if (!groupId) return null;

  if (event.kind === CREATE_GROUP_KIND) {
    const group = groups.get(groupId) ?? createGroupState(groupId);
    applyMetadataTags(group.metadata, event.tags);
    groups.set(groupId, group);
    return { group, changed: true };
  }

  const group = groups.get(groupId);
  if (!group) return null;

  switch (event.kind) {
    case EDIT_METADATA_KIND:
      applyMetadataTags(group.metadata, event.tags);
      return { group, changed: true };

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
      if (!group.metadata.isOpen) return { group, changed: false }; // closed: ignored
      group.members.add(event.pubkey);
      return { group, changed: true };
    }

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

/**
 * Start an in-process NIP-29-capable mock relay: in-memory NIP-01 base
 * (reusing mock-relay.js's matchesFilter/queryEvents), replaceable overwrite
 * for kinds 39000-39003, live subscription fan-out, and NIP-29 moderation
 * (9007/9002/9000/9001/9009/9021/9022) that regenerates + fans out the
 * relay-signed 39000/39001/39002 after every accepted moderation event.
 * No NIP-42 — the relay is intentionally open.
 * @param {number} port
 * @returns {Promise<{server: http.Server, wss: WebSocketServer, relayPubkey: string}>}
 */
export function startRelay(port) {
  /** @type {Map<string, GroupState>} */
  const groups = new Map();
  const relaySecretKey = generateSecretKey();
  const relayPubkey = getPublicKey(relaySecretKey);
  /** @type {import('nostr-tools').NostrEvent[]} */
  const storedEvents = [];
  /** @type {Array<{ws: import('ws').WebSocket, subId: string, filters: import('nostr-tools').Filter[]}>} */
  const subscriptions = [];

  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
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

          ws.send(JSON.stringify(['OK', event.id, true, '']));

          if (MODERATION_KINDS.has(event.kind)) {
            const result = applyModerationEvent(groups, event);
            if (result?.changed) {
              for (const rosterEvent of buildRosterEvents(result.group, relaySecretKey)) {
                storeEvent(storedEvents, rosterEvent);
                fanOut(subscriptions, rosterEvent);
              }
            }
            // Raw moderation commands aren't persisted/queryable — only the
            // roster state they produce (39000/39001/39002) is.
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
