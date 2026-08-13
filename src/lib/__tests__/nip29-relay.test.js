/** @vitest-environment node */
// In-process NIP-29 mock relay — moderated-lifecycle coverage over a real
// WebSocket client. Mirrors the wire shapes group-management.js/
// roster-fanout.js build (applesauce-common/helpers/groups kind constants),
// so this exercises the same tag layout the app publishes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { startRelay, stopRelay } from '../../../e2e/nip29-relay.js';

const PORT = 18999;
const URL = `ws://localhost:${PORT}`;

const CREATE_GROUP_KIND = 9007;
const EDIT_METADATA_KIND = 9002;
const PUT_USER_KIND = 9000;
const REMOVE_USER_KIND = 9001;
const CREATE_INVITE_KIND = 9009;
const JOIN_REQUEST_KIND = 9021;
const GROUP_METADATA_KIND = 39000;
const GROUP_ADMINS_KIND = 39001;
const GROUP_MEMBERS_KIND = 39002;

/** @param {number} kind @param {string[][]} tags @param {Uint8Array} sk @param {string} [content] */
function build(kind, tags, sk, content = '') {
  return finalizeEvent({ kind, tags, content, created_at: Math.floor(Date.now() / 1000) }, sk);
}

/** Open a ws connection and wait for it to be ready. @returns {Promise<WebSocket>} */
function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

/**
 * Send an EVENT and resolve with the relay's OK response.
 * @param {WebSocket} ws @param {import('nostr-tools').NostrEvent} event
 * @returns {Promise<[string, string, boolean, string]>}
 */
function publish(ws, event) {
  return new Promise((resolve) => {
    /** @param {any} raw */
    const onMessage = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg[0] === 'OK' && msg[1] === event.id) {
        ws.off('message', onMessage);
        resolve(msg);
      }
    };
    ws.on('message', onMessage);
    ws.send(JSON.stringify(['EVENT', event]));
  });
}

/**
 * REQ a filter and collect events until EOSE (subscription is left open for
 * live fan-out — caller is responsible for closing it if desired).
 * @param {WebSocket} ws @param {string} subId @param {import('nostr-tools').Filter} filter
 * @returns {Promise<import('nostr-tools').NostrEvent[]>}
 */
function reqOnce(ws, subId, filter) {
  return new Promise((resolve) => {
    /** @type {import('nostr-tools').NostrEvent[]} */
    const events = [];
    /** @param {any} raw */
    const onMessage = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg[0] === 'EVENT' && msg[1] === subId) {
        events.push(msg[2]);
      } else if (msg[0] === 'EOSE' && msg[1] === subId) {
        ws.off('message', onMessage);
        resolve(events);
      }
    };
    ws.on('message', onMessage);
    ws.send(JSON.stringify(['REQ', subId, filter]));
  });
}

/**
 * Wait for the next EVENT on an already-open subscription.
 * @param {WebSocket} ws @param {string} subId
 * @returns {Promise<import('nostr-tools').NostrEvent>}
 */
function waitForNextEvent(ws, subId) {
  return new Promise((resolve) => {
    /** @param {any} raw */
    const onMessage = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg[0] === 'EVENT' && msg[1] === subId) {
        ws.off('message', onMessage);
        resolve(msg[2]);
      }
    };
    ws.on('message', onMessage);
  });
}

describe('nip29-relay', () => {
  /** @type {{server: import('http').Server, wss: import('ws').WebSocketServer}} */
  let relay;
  /** @type {WebSocket} */
  let ws;
  const owner = generateSecretKey();
  const joiner = generateSecretKey();
  const joinerPk = getPublicKey(joiner);

  beforeAll(async () => {
    relay = await startRelay(PORT);
    ws = await connect();
  });

  afterAll(async () => {
    ws.close();
    await stopRelay(relay);
  });

  it('creates a closed group and confirms empty 39000/39001/39002', async () => {
    const groupId = 'closed-group';
    const create = build(
      CREATE_GROUP_KIND,
      [['h', groupId], ['name', 'Closed Group'], ['public'], ['closed'], ['restricted']],
      owner
    );
    const ok = await publish(ws, create);
    expect(ok[2]).toBe(true);

    const [metadata] = await reqOnce(ws, 'sub-meta', {
      kinds: [GROUP_METADATA_KIND],
      '#d': [groupId]
    });
    expect(metadata.tags).toContainEqual(['name', 'Closed Group']);
    expect(metadata.tags).toContainEqual(['closed']);

    const [members] = await reqOnce(ws, 'sub-members', {
      kinds: [GROUP_MEMBERS_KIND],
      '#d': [groupId]
    });
    expect(members.tags.filter((t) => t[0] === 'p')).toHaveLength(0);
  });

  it('ignores a bare join request on a closed group (OK:true, roster unchanged)', async () => {
    const groupId = 'closed-group';
    const join = build(JOIN_REQUEST_KIND, [['h', groupId]], joiner);
    const ok = await publish(ws, join);
    expect(ok[2]).toBe(true);

    const [members] = await reqOnce(ws, 'sub-members-2', {
      kinds: [GROUP_MEMBERS_KIND],
      '#d': [groupId]
    });
    expect(members.tags.filter((t) => t[0] === 'p')).toHaveLength(0);
  });

  it('registers an invite code and admits a coded join request', async () => {
    const groupId = 'closed-group';
    const code = 'SECRET-CODE';
    const invite = build(
      CREATE_INVITE_KIND,
      [
        ['h', groupId],
        ['code', code]
      ],
      owner
    );
    expect((await publish(ws, invite))[2]).toBe(true);

    // Open a live subscription on 39002 BEFORE the coded join fires, so we
    // can assert the fan-out below.
    const sub = await connect();
    const liveSubId = 'live-members';
    const initial = await reqOnce(sub, liveSubId, { kinds: [GROUP_MEMBERS_KIND], '#d': [groupId] });
    expect(initial[0].tags.filter((t) => t[0] === 'p')).toHaveLength(0);
    const nextEvent = waitForNextEvent(sub, liveSubId);

    const coded = build(
      JOIN_REQUEST_KIND,
      [
        ['h', groupId],
        ['code', code]
      ],
      joiner
    );
    expect((await publish(ws, coded))[2]).toBe(true);

    const fanned = await nextEvent;
    expect(fanned.tags).toContainEqual(['p', joinerPk]);
    sub.close();
  });

  it('put-user with a role lands the pubkey in 39001 and always in 39002', async () => {
    const groupId = 'open-group';
    await publish(ws, build(CREATE_GROUP_KIND, [['h', groupId], ['public'], ['open']], owner));

    const admin = generateSecretKey();
    const adminPk = getPublicKey(admin);
    const putUser = build(
      PUT_USER_KIND,
      [
        ['h', groupId],
        ['p', adminPk, 'admin']
      ],
      owner
    );
    expect((await publish(ws, putUser))[2]).toBe(true);

    const [admins] = await reqOnce(ws, 'sub-admins', {
      kinds: [GROUP_ADMINS_KIND],
      '#d': [groupId]
    });
    expect(admins.tags).toContainEqual(['p', adminPk, 'admin']);

    const [members] = await reqOnce(ws, 'sub-members-3', {
      kinds: [GROUP_MEMBERS_KIND],
      '#d': [groupId]
    });
    expect(members.tags).toContainEqual(['p', adminPk]);
  });

  it('a bare join request auto-joins an open group', async () => {
    const groupId = 'open-group';
    const autoJoiner = generateSecretKey();
    const autoJoinerPk = getPublicKey(autoJoiner);
    const join = build(JOIN_REQUEST_KIND, [['h', groupId]], autoJoiner);
    expect((await publish(ws, join))[2]).toBe(true);

    const [members] = await reqOnce(ws, 'sub-members-4', {
      kinds: [GROUP_MEMBERS_KIND],
      '#d': [groupId]
    });
    expect(members.tags).toContainEqual(['p', autoJoinerPk]);
  });

  it('remove-user removes the pubkey from 39002', async () => {
    const groupId = 'open-group';
    const target = generateSecretKey();
    const targetPk = getPublicKey(target);
    await publish(ws, build(JOIN_REQUEST_KIND, [['h', groupId]], target));

    const [beforeRemoval] = await reqOnce(ws, 'sub-members-5', {
      kinds: [GROUP_MEMBERS_KIND],
      '#d': [groupId]
    });
    expect(beforeRemoval.tags).toContainEqual(['p', targetPk]);

    const remove = build(
      REMOVE_USER_KIND,
      [
        ['h', groupId],
        ['p', targetPk]
      ],
      owner
    );
    expect((await publish(ws, remove))[2]).toBe(true);

    const [afterRemoval] = await reqOnce(ws, 'sub-members-6', {
      kinds: [GROUP_MEMBERS_KIND],
      '#d': [groupId]
    });
    expect(afterRemoval.tags).not.toContainEqual(['p', targetPk]);
  });

  it('replaceable overwrite: two edit-metadata events leave a single 39000, latest wins', async () => {
    const groupId = 'replace-group';
    await publish(ws, build(CREATE_GROUP_KIND, [['h', groupId], ['public'], ['open']], owner));
    await publish(
      ws,
      build(EDIT_METADATA_KIND, [['h', groupId], ['name', 'First'], ['public'], ['open']], owner)
    );
    await publish(
      ws,
      build(EDIT_METADATA_KIND, [['h', groupId], ['name', 'Second'], ['public'], ['open']], owner)
    );

    const metadataEvents = await reqOnce(ws, 'sub-replace', {
      kinds: [GROUP_METADATA_KIND],
      '#d': [groupId]
    });
    expect(metadataEvents).toHaveLength(1);
    expect(metadataEvents[0].tags).toContainEqual(['name', 'Second']);
  });

  it('live fan-out: a REQ opened before a publish receives the new event', async () => {
    const groupId = 'fanout-group';
    await publish(ws, build(CREATE_GROUP_KIND, [['h', groupId], ['public'], ['open']], owner));

    const sub = await connect();
    const subId = 'live-fanout';
    await reqOnce(sub, subId, { kinds: [GROUP_METADATA_KIND], '#d': [groupId] });
    const nextEvent = waitForNextEvent(sub, subId);

    await publish(
      ws,
      build(
        EDIT_METADATA_KIND,
        [['h', groupId], ['name', 'Fanned Out'], ['public'], ['open']],
        owner
      )
    );

    const fanned = await nextEvent;
    expect(fanned.tags).toContainEqual(['name', 'Fanned Out']);
    sub.close();
  });
});
