/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { pageTitle, communityPageTitle } from '../helpers/page-title.js';

// QA 2026-10-02 K-new-5: channel and call pages left document.title empty,
// so SvelteKit's route announcer read "untitled page" on every navigation.
describe('pageTitle', () => {
  it('joins the parts with a middle dot and appends the app name', () => {
    expect(pageTitle(['Sprechstunde', 'relilab'], 'Edufeed')).toBe(
      'Sprechstunde · relilab — Edufeed'
    );
  });

  it('skips empty parts and falls back to the app name alone', () => {
    expect(pageTitle(['', '  ', null, 'relilab'], 'Edufeed')).toBe('relilab — Edufeed');
    expect(pageTitle([], 'Edufeed')).toBe('Edufeed');
  });

  it('never leaves a dangling separator without an app name', () => {
    expect(pageTitle(['relilab'], '')).toBe('relilab');
    expect(pageTitle(['relilab'], undefined)).toBe('relilab');
  });
});

describe('communityPageTitle', () => {
  const base = { communityName: 'relilab', appName: 'Edufeed', channelsLabel: 'Kanäle' };

  it('names the open channel before the community', () => {
    expect(communityPageTitle({ ...base, view: 'channels', channelName: 'Allgemein' })).toBe(
      'Allgemein · relilab — Edufeed'
    );
  });

  it('says "Kanäle" on the channel list', () => {
    expect(communityPageTitle({ ...base, view: 'channels', channelName: '' })).toBe(
      'Kanäle · relilab — Edufeed'
    );
  });

  it('is the community name on every other view', () => {
    expect(communityPageTitle({ ...base, view: 'home', channelName: 'Allgemein' })).toBe(
      'relilab — Edufeed'
    );
    expect(communityPageTitle({ ...base, view: 'calendar' })).toBe('relilab — Edufeed');
  });
});
