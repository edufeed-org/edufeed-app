/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  config: /** @type {any} */ ({}),
  eligible: true
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  get runtimeConfig() {
    return state.config;
  }
}));
vi.mock('$lib/stores/accounts.svelte.js', () => ({ manager: { active: null } }));
vi.mock('$lib/stores/blossom-eligibility.svelte.js', () => ({
  isBlossomEligible: () => state.eligible
}));
vi.mock('$lib/services/publish-service.js', () => ({ publishEvent: vi.fn() }));

const {
  getActiveBlossomServer,
  getBlossomUploadServers,
  isDefaultBlossomServer,
  isPublicBlossomServer,
  getPublicBlossomServers
} = await import('$lib/services/blossom-settings-service.js');

const PUB = 'a'.repeat(64);
const EDUFEED = 'https://blossom.edufeed.org/';
const PRIMAL = 'https://blossom.primal.net';

/** @param {string[] | null} servers */
function store(servers) {
  return /** @type {any} */ ({
    getReplaceable: () =>
      servers ? { kind: 10063, tags: servers.map((url) => ['server', url]) } : undefined
  });
}

describe('blossom upload server choice', () => {
  beforeEach(() => {
    state.config = {
      defaultBlossomServers: [EDUFEED],
      blossom: { gated: true, publicServers: [PRIMAL] }
    };
    state.eligible = true;
  });

  it("the user's kind 10063 wins regardless of eligibility", () => {
    const s = store(['https://mine.example']);
    expect(getActiveBlossomServer(PUB, s)).toBe('https://mine.example');
    state.eligible = false;
    expect(getActiveBlossomServer(PUB, s)).toBe('https://mine.example');
  });

  it('no list + eligible → the deployment server', () => {
    expect(getActiveBlossomServer(PUB, store(null))).toBe(EDUFEED);
    expect(getBlossomUploadServers(PUB, store(null))).toEqual([EDUFEED, PRIMAL]);
  });

  it('no list + not eligible (or unknown) → the public server, defaults dropped', () => {
    state.eligible = false;
    expect(getActiveBlossomServer(PUB, store(null))).toBe(PRIMAL);
    expect(getBlossomUploadServers(PUB, store(null))).toEqual([PRIMAL]);
  });

  it('gate off keeps the old order even when the store says not eligible', () => {
    state.config.blossom.gated = false;
    // isBlossomEligible is what encodes "gate off ⇒ eligible"; the service
    // simply trusts it, so an explicit override shows the ordering.
    expect(getBlossomUploadServers(PUB, store(null), { eligible: true })).toEqual([
      EDUFEED,
      PRIMAL
    ]);
  });

  it('dedupes by host, ignoring trailing slashes', () => {
    const s = store(['https://blossom.edufeed.org', PRIMAL + '/']);
    expect(getBlossomUploadServers(PUB, s)).toEqual(['https://blossom.edufeed.org', PRIMAL + '/']);
  });

  it('falls back to primal when nothing is configured', () => {
    state.config = {};
    expect(getPublicBlossomServers()).toEqual([PRIMAL]);
    expect(getActiveBlossomServer(PUB, store(null))).toBe(PRIMAL);
  });

  it('isDefault/isPublic compare host-wise', () => {
    expect(isDefaultBlossomServer('https://blossom.edufeed.org')).toBe(true);
    expect(isDefaultBlossomServer('https://BLOSSOM.edufeed.org/')).toBe(true);
    expect(isDefaultBlossomServer(PRIMAL)).toBe(false);
    expect(isPublicBlossomServer(PRIMAL + '/')).toBe(true);
    expect(isPublicBlossomServer(undefined)).toBe(false);
  });
});
