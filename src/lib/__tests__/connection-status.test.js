/** @vitest-environment node */
/**
 * "I often don't know if the app hangs or the internet is bad" (laoc,
 * 2026-10-03): one status, derived from the browser's online flag, the
 * health of the app's OWN relays and a signer that keeps us waiting.
 */
import { describe, it, expect } from 'vitest';
import { coreHostsOf, deriveConnectionStatus, relayHost } from '$lib/helpers/connection-status.js';

const CORE = coreHostsOf({
  groups: ['wss://groups.edufeed.org'],
  educational: ['wss://amb-relay.edufeed.org/'],
  longform: ['wss://amb-relay.edufeed.org']
});
/** @param {string} url @param {boolean} failing */
const relay = (url, failing) => ({ url, failing });

describe('relayHost', () => {
  it('reduces a relay URL (with a community endpoint path) to its host', () => {
    expect(relayHost('wss://Groups.edufeed.org/c/abc/')).toBe('groups.edufeed.org');
    expect(relayHost('not a url')).toBe('');
  });
});

describe('coreHostsOf', () => {
  it('maps each host to the sorted categories it serves', () => {
    expect(CORE.get('amb-relay.edufeed.org')).toEqual(['educational', 'longform']);
    expect(CORE.get('groups.edufeed.org')).toEqual(['groups']);
  });
});

describe('deriveConnectionStatus', () => {
  it('is ok when online and every core relay in use is fine', () => {
    const s = deriveConnectionStatus({
      online: true,
      relays: [relay('wss://groups.edufeed.org', false)],
      coreHosts: CORE,
      waitingForSigner: false
    });
    expect(s).toEqual({ level: 'ok', reasons: [] });
  });

  it('says offline when the browser has no network, whatever the relays say', () => {
    const s = deriveConnectionStatus({
      online: false,
      relays: [relay('wss://groups.edufeed.org', true)],
      coreHosts: CORE,
      waitingForSigner: false
    });
    expect(s.level).toBe('offline');
    expect(s.reasons).toEqual([{ kind: 'offline' }]);
  });

  it('ignores public relays outside the app — a dead stranger relay is not our problem', () => {
    const s = deriveConnectionStatus({
      online: true,
      relays: [relay('wss://some.public.relay', true), relay('wss://groups.edufeed.org', false)],
      coreHosts: CORE,
      waitingForSigner: false
    });
    expect(s.level).toBe('ok');
  });

  it('is degraded when some core relays fail', () => {
    const s = deriveConnectionStatus({
      online: true,
      relays: [
        relay('wss://groups.edufeed.org/c/root', true),
        relay('wss://amb-relay.edufeed.org', false)
      ],
      coreHosts: CORE,
      waitingForSigner: false
    });
    expect(s.level).toBe('degraded');
    expect(s.reasons).toEqual([
      {
        kind: 'relays',
        down: 1,
        total: 2,
        servers: [{ host: 'groups.edufeed.org', categories: ['groups'] }]
      }
    ]);
  });

  it('counts a host once even when several endpoints of it are open', () => {
    const s = deriveConnectionStatus({
      online: true,
      relays: [
        relay('wss://groups.edufeed.org', true),
        relay('wss://groups.edufeed.org/c/root', true),
        relay('wss://amb-relay.edufeed.org', false)
      ],
      coreHosts: CORE,
      waitingForSigner: false
    });
    expect(s.reasons).toEqual([
      {
        kind: 'relays',
        down: 1,
        total: 2,
        servers: [{ host: 'groups.edufeed.org', categories: ['groups'] }]
      }
    ]);
  });

  it('is unreachable when every core relay in use fails while the browser is online', () => {
    const s = deriveConnectionStatus({
      online: true,
      relays: [relay('wss://groups.edufeed.org', true), relay('wss://amb-relay.edufeed.org', true)],
      coreHosts: CORE,
      waitingForSigner: false
    });
    expect(s.level).toBe('unreachable');
    expect(s.reasons[0]).toMatchObject({
      servers: [
        { host: 'amb-relay.edufeed.org', categories: ['educational', 'longform'] },
        { host: 'groups.edufeed.org', categories: ['groups'] }
      ]
    });
  });

  it('is degraded while a signer keeps us waiting, and lists it after network reasons', () => {
    const s = deriveConnectionStatus({
      online: true,
      relays: [
        relay('wss://groups.edufeed.org', true),
        relay('wss://amb-relay.edufeed.org', false)
      ],
      coreHosts: CORE,
      waitingForSigner: true
    });
    expect(s.level).toBe('degraded');
    expect(s.reasons.map((r) => r.kind)).toEqual(['relays', 'signer']);
  });

  it('never reports a problem for relays it has not used yet', () => {
    const s = deriveConnectionStatus({
      online: true,
      relays: [],
      coreHosts: CORE,
      waitingForSigner: false
    });
    expect(s.level).toBe('ok');
  });
});
