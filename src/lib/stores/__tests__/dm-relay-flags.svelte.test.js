// @ts-nocheck
/**
 * dm-relay-flags — per-pubkey dismiss flag for the DM-relay nudge (Termi hint).
 *
 * Mirrors backup-flags: localStorage-backed so a dismiss survives reloads,
 * plus a reactive version counter so isDmRelayBannerDismissed() re-runs in
 * $derived consumers the moment markDmRelayBannerDismissed() is called.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { isDmRelayBannerDismissed, markDmRelayBannerDismissed } from '../dm-relay-flags.svelte.js';

const PUBKEY = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

beforeEach(() => {
  localStorage.clear();
});

describe('dm-relay-flags', () => {
  it('reports not dismissed by default', () => {
    expect(isDmRelayBannerDismissed(PUBKEY)).toBe(false);
  });

  it('persists dismiss per-pubkey to localStorage', () => {
    markDmRelayBannerDismissed(PUBKEY);
    expect(isDmRelayBannerDismissed(PUBKEY)).toBe(true);
    expect(localStorage.getItem(`dm-relay-banner-dismissed:${PUBKEY}`)).toBe('1');
  });

  it('keeps dismiss state isolated between pubkeys', () => {
    markDmRelayBannerDismissed(PUBKEY);
    expect(isDmRelayBannerDismissed(PUBKEY)).toBe(true);
    expect(isDmRelayBannerDismissed(OTHER)).toBe(false);
  });
});
