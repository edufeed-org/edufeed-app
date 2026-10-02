/** @vitest-environment node */
/**
 * Community channel navigation, design 1a (laoc, 2026-10-02): the shared
 * "back to the channel list" request, the Kanäle icon export, and the copy.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  selectGroupChannel,
  getSelectedGroupChannel,
  requestChannelList,
  getChannelListRequests
} from '$lib/groups/group-channel-selection.svelte.js';
import * as icons from '$lib/components/icons';

const de = JSON.parse(readFileSync('messages/de.json', 'utf8'));
const en = JSON.parse(readFileSync('messages/en.json', 'utf8'));

describe('requestChannelList', () => {
  it('clears that community’s channel selection and bumps its request counter', () => {
    selectGroupChannel('a', "wss://r/'x");
    selectGroupChannel('b', "wss://r/'y");
    const before = getChannelListRequests('a');
    requestChannelList('a');
    expect(getSelectedGroupChannel('a')).toBe('');
    expect(getSelectedGroupChannel('b')).toBe("wss://r/'y");
    expect(getChannelListRequests('a')).toBe(before + 1);
    expect(getChannelListRequests('b')).toBe(0);
  });

  it('ignores a missing community pubkey', () => {
    expect(() => requestChannelList(undefined)).not.toThrow();
    expect(getChannelListRequests(undefined)).toBe(0);
  });
});

describe('ChannelsIcon', () => {
  it('is exported from the icon barrel', () => {
    expect(icons.ChannelsIcon).toBeTypeOf('function');
  });
});

describe('copy', () => {
  it('names the hide action as hiding, not removing', () => {
    expect(de.groups_list_remove).toBe('Aus meiner Liste ausblenden');
    expect(en.groups_list_remove).toBe('Hide from my list');
  });

  it('has the leave-confirm and breadcrumb strings in both locales', () => {
    for (const key of [
      'groups_leave_channel',
      'groups_leave_confirm_title',
      'groups_leave_confirm_body_open',
      'groups_leave_confirm_body_closed',
      'groups_breadcrumb_channels',
      'groups_breadcrumb_channels_aria'
    ]) {
      expect(de[key], key).toBeTruthy();
      expect(en[key], key).toBeTruthy();
    }
    expect(de.groups_leave_channel).toBe('Kanal verlassen');
    expect(de.groups_leave_confirm_title).toBe('Diesen Kanal wirklich verlassen?');
    expect(de.groups_breadcrumb_channels).toBe('Kanäle');
  });
});
