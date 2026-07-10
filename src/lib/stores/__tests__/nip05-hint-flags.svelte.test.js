// @ts-nocheck
/**
 * nip05-hint-flags — per-pubkey dismiss flag for the Termi nip05 hint.
 *
 * Mirrors relay-list-flags: localStorage-backed so a dismiss survives
 * reloads, plus a reactive version counter so isNip05HintDismissed() re-runs
 * in $derived consumers the moment markNip05HintDismissed() is called.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { isNip05HintDismissed, markNip05HintDismissed } from '../nip05-hint-flags.svelte.js';

const PUBKEY = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

beforeEach(() => {
  localStorage.clear();
});

describe('nip05-hint-flags', () => {
  it('reports not dismissed by default', () => {
    expect(isNip05HintDismissed(PUBKEY)).toBe(false);
  });

  it('persists dismiss per-pubkey to localStorage', () => {
    markNip05HintDismissed(PUBKEY);
    expect(isNip05HintDismissed(PUBKEY)).toBe(true);
    expect(localStorage.getItem(`nip05-hint-dismissed:${PUBKEY}`)).toBe('1');
  });

  it('keeps dismiss state isolated between pubkeys', () => {
    markNip05HintDismissed(PUBKEY);
    expect(isNip05HintDismissed(PUBKEY)).toBe(true);
    expect(isNip05HintDismissed(OTHER)).toBe(false);
  });
});
