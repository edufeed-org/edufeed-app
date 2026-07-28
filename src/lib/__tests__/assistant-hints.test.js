/** @vitest-environment node */
// Pure state logic for the Termi assistant's account hints (backup file,
// NIP-65 relay list, kind 10050 DM relays) and the canned Q&A matcher.
import { describe, it, expect } from 'vitest';
import {
  deriveHintStatus,
  trackEverOpen,
  matchSuggestion,
  isProfileHintApplicable
} from '$lib/helpers/assistant-hints.js';

describe('deriveHintStatus', () => {
  it('is open while applicable and not confirmed', () => {
    expect(
      deriveHintStatus({ applicable: true, confirmed: false, running: false, everOpen: false })
    ).toBe('open');
  });

  it('is hidden when neither applicable nor confirmed', () => {
    expect(
      deriveHintStatus({ applicable: false, confirmed: false, running: false, everOpen: false })
    ).toBe(null);
  });

  it('is doing while the action runs and confirmation is pending', () => {
    expect(
      deriveHintStatus({ applicable: true, confirmed: false, running: true, everOpen: true })
    ).toBe('doing');
  });

  it('flips to done when confirmation lands after being open this session', () => {
    expect(
      deriveHintStatus({ applicable: false, confirmed: true, running: false, everOpen: true })
    ).toBe('done');
    // even if the running flag has not been cleared yet
    expect(
      deriveHintStatus({ applicable: false, confirmed: true, running: true, everOpen: true })
    ).toBe('done');
  });

  it('stays hidden when confirmed but never shown this session', () => {
    // e.g. user already has a relay list at login — no retroactive "done" chatter
    expect(
      deriveHintStatus({ applicable: false, confirmed: true, running: false, everOpen: false })
    ).toBe(null);
  });

  it('locks the invites hint mapping: open while pending invites exist, hidden at zero', () => {
    // Mirrors the `invites` branch in assistant-hints.svelte.js's statuses map:
    // applicable = getPendingInviteCount() > 0, confirmed is always false (no
    // "done" state — the hint just disappears once the count hits zero).
    const pendingCount = 2;
    expect(
      deriveHintStatus({
        applicable: pendingCount > 0,
        confirmed: false,
        running: false,
        everOpen: false
      })
    ).toBe('open');

    const zeroCount = 0;
    expect(
      deriveHintStatus({
        applicable: zeroCount > 0,
        confirmed: false,
        running: false,
        everOpen: false
      })
    ).toBe(null);
  });
});

describe('trackEverOpen', () => {
  it('records ids currently open or doing', () => {
    const next = trackEverOpen(new Set(), { backup: 'open', relays: 'doing', dm: null });
    expect(next).toEqual(new Set(['backup', 'relays']));
  });

  it('never forgets ids and returns the same reference when unchanged', () => {
    const prev = new Set(['backup']);
    expect(trackEverOpen(prev, { backup: null, relays: null, dm: null })).toBe(prev);
    const grown = trackEverOpen(prev, { backup: 'done', dm: 'open' });
    expect(grown).toEqual(new Set(['backup', 'dm']));
  });
});

describe('matchSuggestion', () => {
  const suggestions = [
    { q: 'Was kannst du?', a: 'answer-1' },
    { q: 'Finde Material zu Demokratie', a: 'answer-2' }
  ];

  it('matches a suggestion case-insensitively, ignoring surrounding whitespace', () => {
    expect(matchSuggestion('  was kannst DU?  ', suggestions)?.a).toBe('answer-1');
  });

  it('returns null for anything else', () => {
    expect(matchSuggestion('Wie ist das Wetter?', suggestions)).toBe(null);
    expect(matchSuggestion('', suggestions)).toBe(null);
    expect(matchSuggestion('   ', suggestions)).toBe(null);
  });
});

describe('isProfileHintApplicable', () => {
  const base = {
    user: { type: 'nsec', pubkey: 'a'.repeat(64) },
    settled: true,
    hasProfile: false,
    dismissed: false,
    signupOpen: false
  };

  it('is applicable for a signing account with a settled-missing profile', () => {
    expect(isProfileHintApplicable(base)).toBe(true);
  });

  it('excludes readonly accounts (not their key, cannot publish)', () => {
    expect(isProfileHintApplicable({ ...base, user: { type: 'readonly' } })).toBe(false);
  });

  it('excludes missing user', () => {
    expect(isProfileHintApplicable({ ...base, user: null })).toBe(false);
  });

  it('waits for the profile check to settle', () => {
    expect(isProfileHintApplicable({ ...base, settled: false })).toBe(false);
  });

  it('excludes users who already have a profile', () => {
    expect(isProfileHintApplicable({ ...base, hasProfile: true })).toBe(false);
  });

  it('respects the per-pubkey dismissal', () => {
    expect(isProfileHintApplicable({ ...base, dismissed: true })).toBe(false);
  });

  it('is suppressed while the signup wizard is open', () => {
    expect(isProfileHintApplicable({ ...base, signupOpen: true })).toBe(false);
  });

  it('applies to bunker (nostr-connect) accounts too', () => {
    expect(isProfileHintApplicable({ ...base, user: { type: 'nostr-connect' } })).toBe(true);
  });
});
