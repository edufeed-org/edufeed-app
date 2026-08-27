/** @vitest-environment node */
/**
 * The publish gate — the single place that decides whether the rail's
 * arrangement may leave this device.
 *
 * It is its own pure module and its own test file because two separate
 * data-loss chains both terminate here, and each one is closed by this
 * function returning false:
 *
 *   decrypt fails → layout reads as [] → normalizeLayout([]) → default order
 *   → published over the user's good event → arrangement gone on every device
 *
 *   signer cannot NIP-44 → encryption "fails soft" → the same layout goes out
 *   in the clear → which private rooms the user holds is now public
 *
 * The second is the one the whole feature exists to prevent, so the gate is
 * written as a whitelist: a status has to be named to be allowed. A new status
 * added later is refused by default rather than admitted by default.
 */
import { describe, it, expect } from 'vitest';
import {
  RAIL_SYNC_STATUS,
  canPublishRailLayout,
  isRailLayoutLoaded
} from '$lib/rail/rail-layout-gate.js';

describe('canPublishRailLayout', () => {
  // Publishing is allowed only when we know what we would be replacing.
  it('allows a publish once the remote layout is known', () => {
    expect(canPublishRailLayout(RAIL_SYNC_STATUS.loaded)).toBe(true);
  });

  it('allows the very first publish when the relays confirm nothing is stored', () => {
    expect(canPublishRailLayout(RAIL_SYNC_STATUS.absent)).toBe(true);
  });

  it('refuses while the relay has not answered yet', () => {
    expect(canPublishRailLayout(RAIL_SYNC_STATUS.loading)).toBe(false);
  });

  // The trap from the brief, closed at its last link.
  it('refuses when an event exists but could not be decrypted', () => {
    expect(canPublishRailLayout(RAIL_SYNC_STATUS.locked)).toBe(false);
  });

  // "A signer that cannot NIP-44 means the rail does not sync" — not
  // "the rail syncs in the clear".
  it('refuses when the signer cannot encrypt', () => {
    expect(canPublishRailLayout(RAIL_SYNC_STATUS.unavailable)).toBe(false);
  });

  it('refuses before sync has started at all', () => {
    expect(canPublishRailLayout(RAIL_SYNC_STATUS.idle)).toBe(false);
  });

  // The whitelist property itself. Without this, adding a status later and
  // forgetting to classify it opens the write path silently.
  it('refuses anything it does not recognise', () => {
    expect(canPublishRailLayout(/** @type {any} */ ('something-new'))).toBe(false);
    expect(canPublishRailLayout(/** @type {any} */ (undefined))).toBe(false);
    expect(canPublishRailLayout(/** @type {any} */ (null))).toBe(false);
    expect(canPublishRailLayout(/** @type {any} */ (''))).toBe(false);
  });

  it('names every status it allows, so the allowed set is reviewable', () => {
    const allowed = Object.values(RAIL_SYNC_STATUS).filter(canPublishRailLayout);
    expect(allowed.sort()).toEqual(['absent', 'loaded']);
  });
});

describe('isRailLayoutLoaded', () => {
  // Distinct from canPublish on purpose: "we know the remote state" and "the
  // user has an arrangement stored" are different questions, and the UI asks
  // the first one while the write path asks the second.
  it('is true exactly when the remote state is settled', () => {
    expect(isRailLayoutLoaded(RAIL_SYNC_STATUS.loaded)).toBe(true);
    expect(isRailLayoutLoaded(RAIL_SYNC_STATUS.absent)).toBe(true);
  });

  it('is false for every unsettled or failed state', () => {
    expect(isRailLayoutLoaded(RAIL_SYNC_STATUS.idle)).toBe(false);
    expect(isRailLayoutLoaded(RAIL_SYNC_STATUS.loading)).toBe(false);
    expect(isRailLayoutLoaded(RAIL_SYNC_STATUS.locked)).toBe(false);
    expect(isRailLayoutLoaded(RAIL_SYNC_STATUS.unavailable)).toBe(false);
  });
});

describe('RAIL_SYNC_STATUS', () => {
  // A decrypt failure and an empty rail must not be the same value anywhere,
  // which is only meaningful if they are actually distinct constants.
  it('keeps every state distinct', () => {
    const values = Object.values(RAIL_SYNC_STATUS);
    expect(new Set(values).size).toBe(values.length);
  });

  it('has a state for each thing that can be true of the remote', () => {
    expect(Object.keys(RAIL_SYNC_STATUS).sort()).toEqual([
      'absent',
      'idle',
      'loaded',
      'loading',
      'locked',
      'unavailable'
    ]);
  });
});
