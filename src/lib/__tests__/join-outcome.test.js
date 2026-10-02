/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { joinOutcome } from '$lib/groups/join-outcome.js';

// Task 15 review (C1): after a 9021 the toast says "joined" or "request
// sent" by what the refreshed roster shows; the NIP-29 `closed` marker only
// decides when the roster cannot tell.
describe('joinOutcome', () => {
  it.each([
    [{ onRoster: true, rosterReadable: true, closed: true }, 'joined'],
    [{ onRoster: true, rosterReadable: true, closed: false }, 'joined'],
    [{ onRoster: false, rosterReadable: true, closed: false }, 'sent'],
    [{ onRoster: false, rosterReadable: true, closed: true }, 'sent'],
    [{ onRoster: false, rosterReadable: false, closed: true }, 'sent'],
    [{ onRoster: false, rosterReadable: false, closed: false }, 'joined']
  ])('%o → %s', (input, expected) => {
    expect(joinOutcome(input)).toBe(expected);
  });
});
