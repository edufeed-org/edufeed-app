/** @vitest-environment node */
// Relay-URL helpers that convert between the flat groups host and the
// per-community virtual endpoint (wss://host/c/<rootId>). See
// src/lib/groups/community-endpoint.js — CREATE must go to the flat host, but
// channel pointers + kind-10009 entries are ADDRESSED via /c so clients like
// Armada show one dedicated space per community.
import { describe, it, expect } from 'vitest';
import { flatGroupsRelay, communityGroupsEndpoint } from '$lib/groups/community-endpoint.js';

const BASE = 'wss://groups.edufeed.org';
const ROOT = 'aa0aefb12f03db60';

describe('communityGroupsEndpoint', () => {
  it('builds wss://host/c/<rootId> with no trailing slash', () => {
    expect(communityGroupsEndpoint(BASE, ROOT)).toBe(`${BASE}/c/${ROOT}`);
  });

  it('tolerates a trailing slash on the base', () => {
    expect(communityGroupsEndpoint(`${BASE}/`, ROOT)).toBe(`${BASE}/c/${ROOT}`);
  });

  it('is idempotent on an already-/c base (re-scopes to the given root)', () => {
    // A base that is itself an endpoint for a DIFFERENT root is flattened
    // first, so the result addresses the requested root, not the old one.
    expect(communityGroupsEndpoint(`${BASE}/c/beef00cafe00face`, ROOT)).toBe(`${BASE}/c/${ROOT}`);
    // Feeding its own output back in is a no-op.
    const once = communityGroupsEndpoint(BASE, ROOT);
    expect(communityGroupsEndpoint(once, ROOT)).toBe(once);
  });

  it('round-trips a non-hex root id (real root ids are hex, but the strip must not depend on it)', () => {
    const ep = communityGroupsEndpoint(BASE, 'root-1');
    expect(ep).toBe(`${BASE}/c/root-1`);
    expect(flatGroupsRelay(ep)).toBe(`${BASE}/`);
  });
});

describe('flatGroupsRelay', () => {
  it('strips a trailing /c/<hex> back to the flat host', () => {
    expect(flatGroupsRelay(`${BASE}/c/${ROOT}`)).toBe(`${BASE}/`);
    expect(flatGroupsRelay(`${BASE}/c/${ROOT}/`)).toBe(`${BASE}/`);
  });

  it('is idempotent on a flat URL (bare host and trailing-slash host agree)', () => {
    expect(flatGroupsRelay(BASE)).toBe(`${BASE}/`);
    expect(flatGroupsRelay(BASE)).toBe(flatGroupsRelay(`${BASE}/`));
    expect(flatGroupsRelay(flatGroupsRelay(`${BASE}/c/${ROOT}`))).toBe(`${BASE}/`);
  });

  it('round-trips: flatGroupsRelay(endpoint(base, id)) === flatGroupsRelay(base)', () => {
    expect(flatGroupsRelay(communityGroupsEndpoint(BASE, ROOT))).toBe(flatGroupsRelay(BASE));
  });

  it('does NOT strip an unrelated (non-/c) path', () => {
    expect(flatGroupsRelay(`${BASE}/foo`)).toBe(`${BASE}/foo`);
    // A deeper path that merely contains /c/ mid-way is not a trailing endpoint.
    expect(flatGroupsRelay(`${BASE}/c/abc/extra`)).toBe(`${BASE}/c/abc/extra`);
  });

  it('passes non-string through untouched', () => {
    expect(flatGroupsRelay(/** @type {any} */ (undefined))).toBe(undefined);
  });
});
