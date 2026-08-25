/**
 * Wire format for shared webxdc sessions in NIP-29 channels (spec
 * 2026-08-25-channel-webxdc-sessions-design.md). Armada-compatible: durable
 * state kind 9450, ephemeral realtime 24450, both scoped ["h", groupId] +
 * ["i", sessionId]; the session is minted into a kind-9 imeta attachment.
 */
import { getMessageAttachments } from '$lib/helpers/imeta.js';

export const WEBXDC_STATE_KIND = 9450;
export const WEBXDC_REALTIME_KIND = 24450;
export const WEBXDC_MIME = 'application/x-webxdc';

const now = () => Math.floor(Date.now() / 1000);

export function mintSessionId() {
  return crypto.randomUUID();
}

/**
 * @param {string} groupId
 * @param {{url: string, sha256: string, name?: string, iconUrl?: string}} app
 * @param {string} sessionId
 */
export function buildAppShareTemplate(groupId, app, sessionId) {
  const imeta = ['imeta', `url ${app.url}`, `m ${WEBXDC_MIME}`, `x ${app.sha256}`];
  if (app.iconUrl) imeta.push(`image ${app.iconUrl}`);
  if (app.name) imeta.push(`alt Webxdc app: ${app.name}`);
  imeta.push(`webxdc ${sessionId}`);
  return { kind: 9, content: app.url, created_at: now(), tags: [['h', groupId], imeta] };
}

/**
 * @param {string} groupId @param {string} sessionId @param {any} payload
 * @param {{info?:*, document?:*, summary?:*}} [meta]
 */
export function buildStateTemplate(groupId, sessionId, payload, meta) {
  const tags = [
    ['h', groupId],
    ['i', sessionId]
  ];
  const metaRecord = /** @type {Record<string, any>} */ (meta ?? {});
  for (const key of ['info', 'document', 'summary']) {
    if (metaRecord[key] !== undefined) tags.push([key, String(metaRecord[key])]);
  }
  return {
    kind: WEBXDC_STATE_KIND,
    content: JSON.stringify(payload ?? null),
    created_at: now(),
    tags
  };
}

/** @param {string} groupId @param {string} sessionId @param {Uint8Array} bytes */
export function buildRealtimeTemplate(groupId, sessionId, bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return {
    kind: WEBXDC_REALTIME_KIND,
    content: btoa(bin),
    created_at: now(),
    tags: [
      ['h', groupId],
      ['i', sessionId]
    ]
  };
}

/** @param {{kind?: number, content?: string, tags?: string[][]}} event */
export function parseStateEvent(event) {
  if (event?.kind !== WEBXDC_STATE_KIND) return null;
  let payload;
  try {
    payload = JSON.parse(event.content ?? '');
  } catch {
    return null;
  }
  const out = { payload };
  // Cast only for the dynamic-key writes below — `out`'s own declared shape
  // (payload + optional info/document/summary) stays intact for callers.
  const outIndexable = /** @type {Record<string, any>} */ (out);
  for (const key of ['info', 'document', 'summary']) {
    const tag = event.tags?.find((t) => t[0] === key);
    if (tag) outIndexable[key] = tag[1];
  }
  return out;
}

/** @param {{kind?: number, content?: string}} event @returns {Uint8Array | null} */
export function parseRealtimeEvent(event) {
  if (event?.kind !== WEBXDC_REALTIME_KIND) return null;
  try {
    const bin = atob(event.content ?? '');
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * First launchable webxdc attachment on a chat message: must carry the
 * x-webxdc mime AND a session uuid (imeta `webxdc` property) — an attachment
 * without a session can't sync, so it isn't a launch card.
 * @param {{tags?: string[][]} | null | undefined} message
 */
export function getWebxdcAttachment(message) {
  for (const att of getMessageAttachments(message)) {
    if (att.type === WEBXDC_MIME && att.webxdc && att.url && att.sha256) {
      return /** @type {any} */ (att);
    }
  }
  return null;
}

/**
 * Channel session list for the apps bar, newest share first, deduped by
 * session uuid (a re-share of the same message id cannot happen; the same
 * uuid appearing twice keeps the newest message).
 * @param {Array<{id: string, created_at: number, tags?: string[][]}>} messages
 */
export function deriveSessions(messages) {
  const byId = new Map();
  const sorted = [...messages].sort((a, b) => b.created_at - a.created_at);
  for (const msg of sorted) {
    const att = getWebxdcAttachment(msg);
    if (!att || byId.has(att.webxdc)) continue;
    byId.set(att.webxdc, {
      sessionId: att.webxdc,
      app: {
        url: att.url,
        sha256: att.sha256,
        name: att.alt?.replace(/^Webxdc app: /, '') || '',
        iconUrl: att.image || ''
      },
      messageId: msg.id,
      created_at: msg.created_at
    });
  }
  return [...byId.values()];
}
