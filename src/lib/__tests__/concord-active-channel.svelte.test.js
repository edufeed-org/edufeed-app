// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import {
  setActiveConcordChannel,
  clearActiveConcordChannel,
  getActiveConcordChannel,
  selectConcordChannel,
  getSelectedConcordChannel,
  clearConcordSelections,
  requestChannelCreate,
  getChannelCreateRequested,
  clearChannelCreateRequest
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

  it('clearConcordSelections resets every per-community selection', () => {
    selectConcordChannel('cid', 'chid');
    expect(getSelectedConcordChannel('cid')).toBe('chid');
    clearConcordSelections();
    expect(getSelectedConcordChannel('cid')).toBe('');
  });

  // The sidebar's "+ Neuer Kanal" cannot open the view's own wizard directly
  // (2-3 responsive PrivateChannelsView mounts, none of them the sidebar's
  // child) — it raises this shared intent instead, and every mount shows or
  // hides the wizard in lockstep with it.
  it('channel-create intent: raised by the sidebar, cleared on wizard close', () => {
    clearChannelCreateRequest();
    expect(getChannelCreateRequested()).toBe(false);
    requestChannelCreate();
    expect(getChannelCreateRequested()).toBe(true);
    clearChannelCreateRequest();
    expect(getChannelCreateRequested()).toBe(false);
  });
});
