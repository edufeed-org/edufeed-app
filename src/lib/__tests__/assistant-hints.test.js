/** @vitest-environment node */
// Pure state logic for the Termi assistant's account hints (backup file,
// NIP-65 relay list, kind 10050 DM relays) and the canned Q&A matcher.
import { describe, it, expect } from 'vitest';
import {
  deriveHintStatus,
  trackEverOpen,
  matchSuggestion,
  isProfileHintApplicable,
  deriveNip05Hint
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

describe('deriveNip05Hint', () => {
  const base = {
    membershipEnabled: true,
    profileSettled: true,
    grantState: /** @type {'none' | 'pending' | 'granted'} */ ('none'),
    activated: false,
    hasNip05: false,
    applyDismissed: false,
    readyDismissed: false
  };

  it('is the apply reminder when no application exists', () => {
    expect(deriveNip05Hint(base)).toEqual({
      variant: 'apply',
      applicable: true,
      confirmed: false
    });
  });

  it('switches to the passive pending note while the application awaits review', () => {
    expect(deriveNip05Hint({ ...base, grantState: 'pending' })).toEqual({
      variant: 'pending',
      applicable: true,
      confirmed: false
    });
  });

  it('celebrates a granted handle even when another nip05 is on the profile', () => {
    expect(deriveNip05Hint({ ...base, grantState: 'granted', hasNip05: true })).toEqual({
      variant: 'ready',
      applicable: true,
      confirmed: false
    });
  });

  it('confirms the ready hint once the granted address is on the profile', () => {
    expect(
      deriveNip05Hint({ ...base, grantState: 'granted', activated: true, hasNip05: true })
    ).toEqual({ variant: 'ready', applicable: false, confirmed: true });
  });

  it('keeps the apply/pending reminder away when any nip05 exists', () => {
    expect(deriveNip05Hint({ ...base, hasNip05: true }).applicable).toBe(false);
    expect(deriveNip05Hint({ ...base, hasNip05: true }).confirmed).toBe(true);
    expect(deriveNip05Hint({ ...base, grantState: 'pending', hasNip05: true }).applicable).toBe(
      false
    );
  });

  it('respects the separate dismissals for reminder and ready card', () => {
    expect(deriveNip05Hint({ ...base, applyDismissed: true }).applicable).toBe(false);
    // Dismissing the early reminder must NOT suppress the later grant notice.
    expect(
      deriveNip05Hint({ ...base, grantState: 'granted', applyDismissed: true }).applicable
    ).toBe(true);
    expect(
      deriveNip05Hint({ ...base, grantState: 'granted', readyDismissed: true }).applicable
    ).toBe(false);
  });

  it('is inapplicable before the profile check settles or without membership', () => {
    expect(deriveNip05Hint({ ...base, profileSettled: false }).applicable).toBe(false);
    expect(deriveNip05Hint({ ...base, membershipEnabled: false }).applicable).toBe(false);
    expect(
      deriveNip05Hint({ ...base, grantState: 'granted', profileSettled: false }).applicable
    ).toBe(false);
  });
});
