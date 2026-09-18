/** @vitest-environment node */
/**
 * Gift-wrap unlock retry policy (laoc, 2026-09-18: "some messages are
 * missing, still missing after a reload").
 *
 * A wrap that failed to decrypt once was written to localStorage and skipped
 * forever, so one transient signer hiccup (bunker asleep, extension locked)
 * hid that message permanently. The guard only needs to stop a relay
 * redelivery loop WITHIN a session; nothing may survive a reload.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyUnlockFailure,
  shouldAttemptUnlock,
  recordUnlockFailure,
  countUnlockFailures,
  UNLOCK_ATTEMPT_LIMIT,
  LEGACY_FAILED_UNLOCK_KEY_PREFIX
} from '$lib/helpers/dm.js';

describe('classifyUnlockFailure', () => {
  it('treats signer availability problems as transient', () => {
    for (const message of [
      'Request timed out',
      'bunker did not respond',
      'WebSocket connection closed',
      'NIP-46 connection lost',
      'user rejected the request',
      'Signer is locked',
      'network error',
      'aborted'
    ]) {
      expect(classifyUnlockFailure(new Error(message)), message).toBe('transient');
    }
  });

  it('treats structural decryption problems as permanent', () => {
    for (const message of [
      'invalid MAC',
      'invalid padding',
      'unsupported version 3',
      'malformed payload'
    ]) {
      expect(classifyUnlockFailure(new Error(message)), message).toBe('permanent');
    }
  });

  it('defaults to transient for anything unrecognised — never hide a message on a guess', () => {
    expect(classifyUnlockFailure(new Error('something odd happened'))).toBe('transient');
    expect(classifyUnlockFailure(undefined)).toBe('transient');
    expect(classifyUnlockFailure('a string')).toBe('transient');
  });
});

describe('shouldAttemptUnlock / recordUnlockFailure', () => {
  it('attempts an unseen wrap', () => {
    expect(shouldAttemptUnlock(new Map(), 'a')).toBe(true);
  });

  it('retries a transient failure up to the attempt limit, then stops for this session', () => {
    const failures = new Map();
    for (let i = 1; i < UNLOCK_ATTEMPT_LIMIT; i++) {
      recordUnlockFailure(failures, 'a', new Error('timeout'));
      expect(shouldAttemptUnlock(failures, 'a'), `attempt ${i}`).toBe(true);
    }
    recordUnlockFailure(failures, 'a', new Error('timeout'));
    expect(shouldAttemptUnlock(failures, 'a')).toBe(false);
  });

  it('stops after a single permanent failure', () => {
    const failures = new Map();
    recordUnlockFailure(failures, 'a', new Error('invalid MAC'));
    expect(shouldAttemptUnlock(failures, 'a')).toBe(false);
  });

  it('counts every wrap that is still hidden, whatever the reason', () => {
    const failures = new Map();
    recordUnlockFailure(failures, 'a', new Error('invalid MAC'));
    recordUnlockFailure(failures, 'b', new Error('timeout'));
    expect(countUnlockFailures(failures)).toBe(2);
  });

  it('a retry clears the map, so every wrap is attempted again', () => {
    const failures = new Map();
    recordUnlockFailure(failures, 'a', new Error('invalid MAC'));
    failures.clear();
    expect(shouldAttemptUnlock(failures, 'a')).toBe(true);
    expect(countUnlockFailures(failures)).toBe(0);
  });

  it('exports the legacy storage key prefix so the service can delete the old blacklist', () => {
    expect(LEGACY_FAILED_UNLOCK_KEY_PREFIX).toBe('comcal:dm:failed-gift-wraps:');
  });
});
