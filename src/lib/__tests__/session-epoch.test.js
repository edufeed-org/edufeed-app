/** @vitest-environment node */
// The session epoch remounts the route tree (via {#key} in +layout.svelte)
// when the account-switch flush empties the EventStore — the page the user
// is standing on would otherwise show an empty state until navigation,
// because its loaders already ran and are not keyed on the active account.
import { describe, it, expect } from 'vitest';
import { sessionEpoch, bumpSessionEpoch } from '$lib/stores/session-epoch.svelte.js';

describe('sessionEpoch', () => {
  it('bumpSessionEpoch increments the epoch', () => {
    const before = sessionEpoch.value;
    bumpSessionEpoch();
    expect(sessionEpoch.value).toBe(before + 1);
  });
});
