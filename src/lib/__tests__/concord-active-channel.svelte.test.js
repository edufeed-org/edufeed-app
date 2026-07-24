// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import {
  setActiveConcordChannel,
  clearActiveConcordChannel,
  getActiveConcordChannel
} from '$lib/concord/active-channel.svelte.js';

describe('active concord channel', () => {
  it('starts empty, tracks set/clear', () => {
    clearActiveConcordChannel();
    expect(getActiveConcordChannel()).toBeNull();
    setActiveConcordChannel('cid', 'chid');
    expect(getActiveConcordChannel()).toEqual({ communityId: 'cid', channelId: 'chid' });
    setActiveConcordChannel('cid', 'other');
    expect(getActiveConcordChannel()).toEqual({ communityId: 'cid', channelId: 'other' });
    clearActiveConcordChannel();
    expect(getActiveConcordChannel()).toBeNull();
  });
});
