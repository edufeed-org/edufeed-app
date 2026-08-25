/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  WEBXDC_STATE_KIND,
  WEBXDC_REALTIME_KIND,
  mintSessionId,
  buildAppShareTemplate,
  buildStateTemplate,
  buildRealtimeTemplate,
  parseStateEvent,
  parseRealtimeEvent,
  getWebxdcAttachment,
  deriveSessions
} from '../session-events.js';

const app = {
  url: 'https://blossom.example/abc.xdc',
  sha256: 'a'.repeat(64),
  name: 'Pad',
  iconUrl: 'https://blossom.example/icon.png'
};
const GROUP = 'deadbeef00000000';
const SID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

describe('buildAppShareTemplate', () => {
  it('builds a kind-9 with h + imeta carrying the session uuid', () => {
    const t = buildAppShareTemplate(GROUP, app, SID);
    expect(t.kind).toBe(9);
    expect(t.tags[0]).toEqual(['h', GROUP]);
    const imeta = t.tags.find((tag) => tag[0] === 'imeta');
    expect(imeta).toContain(`url ${app.url}`);
    expect(imeta).toContain('m application/x-webxdc');
    expect(imeta).toContain(`x ${app.sha256}`);
    expect(imeta).toContain(`image ${app.iconUrl}`);
    expect(imeta).toContain(`alt Webxdc app: ${app.name}`);
    expect(imeta).toContain(`webxdc ${SID}`);
    expect(t.content).toContain(app.url); // clients without imeta support see the link
  });
  it('round-trips through getWebxdcAttachment', () => {
    const att = getWebxdcAttachment(buildAppShareTemplate(GROUP, app, SID));
    expect(att).toMatchObject({ url: app.url, sha256: app.sha256, webxdc: SID });
  });
  it('getWebxdcAttachment ignores non-xdc and session-less imeta', () => {
    expect(getWebxdcAttachment({ tags: [['imeta', 'url https://x/y.png', 'm image/png']] })).toBe(
      null
    );
    expect(
      getWebxdcAttachment({ tags: [['imeta', `url ${app.url}`, 'm application/x-webxdc']] })
    ).toBe(null);
  });
});

describe('state events', () => {
  it('builds and parses a 9450 with meta tags', () => {
    const t = buildStateTemplate(
      GROUP,
      SID,
      { move: 'e2e4' },
      { info: 'White moved', summary: '1 move' }
    );
    expect(t.kind).toBe(WEBXDC_STATE_KIND);
    expect(t.tags).toContainEqual(['h', GROUP]);
    expect(t.tags).toContainEqual(['i', SID]);
    const parsed = parseStateEvent(t);
    expect(parsed).toEqual({ payload: { move: 'e2e4' }, info: 'White moved', summary: '1 move' });
  });
  it('omits absent meta tags and survives bad JSON', () => {
    const t = buildStateTemplate(GROUP, SID, 42);
    expect(t.tags.find((tag) => tag[0] === 'info')).toBeUndefined();
    expect(parseStateEvent({ ...t, content: '{not json' })).toBe(null);
  });
});

describe('realtime events', () => {
  it('round-trips bytes through base64', () => {
    const bytes = Uint8Array.from([0, 1, 2, 250, 255]);
    const t = buildRealtimeTemplate(GROUP, SID, bytes);
    expect(t.kind).toBe(WEBXDC_REALTIME_KIND);
    expect(parseRealtimeEvent(t)).toEqual(bytes);
  });
});

describe('deriveSessions', () => {
  it('lists newest-first, one entry per session uuid', () => {
    const m1 = { ...buildAppShareTemplate(GROUP, app, SID), id: 'm1', created_at: 100 };
    const m2 = { ...buildAppShareTemplate(GROUP, app, mintSessionId()), id: 'm2', created_at: 200 };
    const plain = { id: 'm3', created_at: 300, tags: [['h', GROUP]] };
    const sessions = deriveSessions([plain, m1, m2]);
    expect(sessions.map((s) => s.messageId)).toEqual(['m2', 'm1']);
    expect(sessions[1]).toMatchObject({ sessionId: SID, app: { name: app.name } });
  });
});
