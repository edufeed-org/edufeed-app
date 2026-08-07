/** @vitest-environment node */
/**
 * Unread/mention state for a host's NIP-29 channels — the pure half.
 *
 * The rules are Concord's, deliberately: this file only checks the parts that
 * are NEW because a host is not a community — folding ONE flat kind-9 stream
 * into per-channel summaries off the `h` tag, the window that stream is asked
 * for, and the "we have not heard from this host yet" state that must never
 * read as "nothing unread".
 */
import { describe, it, expect } from 'vitest';
import {
  foldHostSummaries,
  unreadWindowSince,
  unreadFlags,
  hostRollup,
  markRead,
  markHostRead,
  UNREAD_LOOKBACK,
  UNREAD_MAX_LOOKBACK
} from '$lib/groups/channel-unread.js';

const ME = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const RELAY = 'wss://groups.example';
const KEY = (/** @type {string} */ id) => `${id}@wss://groups.example/`;

/** A kind-9 group message as a NIP-29 relay serves it. */
/** @param {{id: string, at: number, pubkey?: string, tags?: string[][]}} args */
function message({ id, at, pubkey = OTHER, tags = [] }) {
  return { kind: 9, pubkey, created_at: at, tags: [['h', id], ...tags], content: 'x' };
}

describe('foldHostSummaries', () => {
  it('splits one flat stream into a summary per channel, off the h tag', () => {
    const summaries = foldHostSummaries(
      [
        message({ id: 'allgemein', at: 100 }),
        message({ id: 'redesign', at: 200 }),
        message({ id: 'allgemein', at: 300 })
      ],
      ME,
      RELAY
    );

    expect(Object.keys(summaries).sort()).toEqual([KEY('allgemein'), KEY('redesign')]);
    expect(summaries[KEY('allgemein')].latestFromOthers).toBe(300);
    expect(summaries[KEY('redesign')].latestFromOthers).toBe(200);
  });

  it('keys on the normalised relay, so one host cannot become two', () => {
    const summaries = foldHostSummaries(
      [message({ id: 'allgemein', at: 100 })],
      ME,
      'wss://Groups.Example/'
    );
    expect(summaries[KEY('allgemein')]).toBeDefined();
  });

  it('drops a message with no h tag rather than inventing a channel for it', () => {
    const stray = { kind: 9, pubkey: OTHER, created_at: 100, tags: [], content: 'x' };
    expect(foldHostSummaries([stray], ME, RELAY)).toEqual({});
  });

  it('counts a p tag on someone else as a mention, and my own p tag as nothing', () => {
    const summaries = foldHostSummaries(
      [
        message({ id: 'c', at: 100, tags: [['p', ME]] }),
        message({ id: 'c', at: 200, pubkey: ME, tags: [['p', ME]] })
      ],
      ME,
      RELAY
    );
    expect(summaries[KEY('c')].latestMention).toBe(100);
    expect(summaries[KEY('c')].latestFromOthers).toBe(100);
    expect(summaries[KEY('c')].latest).toBe(200);
  });
});

describe('unreadWindowSince', () => {
  const NOW = 1_000_000_000;

  it('asks back to the default lookback when nothing has been read yet', () => {
    expect(unreadWindowSince({}, [KEY('c')], NOW)).toBe(NOW - UNREAD_LOOKBACK);
  });

  it('asks back to the OLDEST marker, so a long-unread channel keeps its unread', () => {
    const markers = { [KEY('a')]: NOW - 100, [KEY('b')]: NOW - 900_000 };
    expect(unreadWindowSince(markers, [KEY('a'), KEY('b')], NOW)).toBe(NOW - 900_000);
  });

  it('tightens below the default when every channel was read recently', () => {
    // The default must be a fallback, never a floor: seeding the window with it
    // makes a host whose channels were all read an hour ago ask for a week.
    const markers = { [KEY('a')]: NOW - 100, [KEY('b')]: NOW - 200 };
    expect(unreadWindowSince(markers, [KEY('a'), KEY('b')], NOW)).toBe(NOW - 200);
  });

  it('asks back to the default when the host lists no channels at all', () => {
    expect(unreadWindowSince({}, [], NOW)).toBe(NOW - UNREAD_LOOKBACK);
  });

  it('treats a channel with no marker as unread since the default lookback', () => {
    const markers = { [KEY('a')]: NOW - 100 };
    expect(unreadWindowSince(markers, [KEY('a'), KEY('b')], NOW)).toBe(NOW - UNREAD_LOOKBACK);
  });

  it('never asks further back than the hard cap', () => {
    const markers = { [KEY('a')]: 1 };
    expect(unreadWindowSince(markers, [KEY('a')], NOW)).toBe(NOW - UNREAD_MAX_LOOKBACK);
  });
});

describe('unreadFlags', () => {
  const summaries = { [KEY('c')]: { latest: 300, latestFromOthers: 300, latestMention: 200 } };

  it('reports nothing AND says so, while the host has not answered yet', () => {
    expect(unreadFlags({}, {}, KEY('c'), false)).toEqual({
      unread: false,
      mentioned: false,
      known: false
    });
  });

  it('says nothing is KNOWN about a channel that has no addressable key', () => {
    // channelKey returns null for a pointer with no id or no valid relay. That
    // channel is not read, and it is not quiet — it is one we cannot ask about,
    // and it must not borrow the look of a channel with nothing new.
    expect(unreadFlags(summaries, { [KEY('c')]: 0 }, null, true)).toEqual({
      unread: false,
      mentioned: false,
      known: false
    });
  });

  it('separates a channel with no new messages from one still loading', () => {
    expect(unreadFlags({}, {}, KEY('c'), true)).toEqual({
      unread: false,
      mentioned: false,
      known: true
    });
  });

  it('is unread and mentioned against a marker older than both', () => {
    expect(unreadFlags(summaries, { [KEY('c')]: 100 }, KEY('c'), true)).toEqual({
      unread: true,
      mentioned: true,
      known: true
    });
  });

  it('is unread but not mentioned once the marker passes the mention', () => {
    expect(unreadFlags(summaries, { [KEY('c')]: 250 }, KEY('c'), true)).toEqual({
      unread: true,
      mentioned: false,
      known: true
    });
  });
});

describe('hostRollup', () => {
  const summaries = {
    [KEY('a')]: { latest: 100, latestFromOthers: 100, latestMention: 0 },
    [KEY('b')]: { latest: 200, latestFromOthers: 200, latestMention: 200 }
  };

  it('is quiet while the host has not answered', () => {
    expect(hostRollup(summaries, {}, [KEY('a'), KEY('b')], false)).toEqual({
      unread: false,
      mentioned: false,
      known: false
    });
  });

  it('ORs over the channels the host actually has', () => {
    expect(hostRollup(summaries, {}, [KEY('a'), KEY('b')], true)).toEqual({
      unread: true,
      mentioned: true,
      known: true
    });
  });

  it('ignores a summary for a channel this host no longer lists', () => {
    expect(hostRollup(summaries, {}, [KEY('a')], true)).toEqual({
      unread: true,
      mentioned: false,
      known: true
    });
  });
});

describe('markRead', () => {
  const summaries = { [KEY('c')]: { latest: 300, latestFromOthers: 200, latestMention: 0 } };

  it('stamps the channel at its newest message, including my own', () => {
    expect(markRead({}, summaries, KEY('c'))).toEqual({ [KEY('c')]: 300 });
  });

  it('never moves a marker backwards', () => {
    const markers = { [KEY('c')]: 500 };
    expect(markRead(markers, summaries, KEY('c'))).toBe(markers);
  });

  it('leaves the markers untouched for a channel with no messages', () => {
    /** @type {Record<string, number>} */
    const markers = {};
    expect(markRead(markers, summaries, KEY('other'))).toBe(markers);
  });
});

describe('markHostRead', () => {
  const summaries = {
    [KEY('a')]: { latest: 100, latestFromOthers: 100, latestMention: 0 },
    [KEY('b')]: { latest: 200, latestFromOthers: 200, latestMention: 0 }
  };

  it('stamps every channel the host lists', () => {
    expect(markHostRead({}, summaries, [KEY('a'), KEY('b')])).toEqual({
      [KEY('a')]: 100,
      [KEY('b')]: 200
    });
  });

  it('returns the same object when there was nothing to mark', () => {
    const markers = { [KEY('a')]: 100, [KEY('b')]: 200 };
    expect(markHostRead(markers, summaries, [KEY('a'), KEY('b')])).toBe(markers);
  });
});
