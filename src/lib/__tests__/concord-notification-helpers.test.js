/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  markerKey,
  foldChannelSummary,
  mergeMarker,
  summaryFlags,
  rollupArea,
  resolveLevel,
  shouldToast,
  pruneMarkers
} from '$lib/concord/notification-helpers.js';

const ME = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

/** Minimal kind-9 rumor. */
/** @param {{pubkey?: string, created_at?: number, tags?: string[][]}} args */
function rumor({ pubkey = OTHER, created_at, tags = [] }) {
  return { id: `${pubkey}-${created_at}`, kind: 9, pubkey, created_at, tags, content: 'x' };
}

describe('markerKey', () => {
  it('joins community and channel id with a slash', () => {
    expect(markerKey('cid', 'chid')).toBe('cid/chid');
  });
});

describe('foldChannelSummary', () => {
  it('returns zeros for an empty timeline', () => {
    expect(foldChannelSummary([], ME)).toEqual({
      latest: 0,
      latestFromOthers: 0,
      latestMention: 0
    });
  });

  it('tracks latest overall including own messages, but excludes own from latestFromOthers', () => {
    const rumors = [
      rumor({ pubkey: ME, created_at: 300 }),
      rumor({ pubkey: OTHER, created_at: 200 }),
      rumor({ pubkey: OTHER, created_at: 100 })
    ];
    expect(foldChannelSummary(rumors, ME)).toEqual({
      latest: 300,
      latestFromOthers: 200,
      latestMention: 0
    });
  });

  it('detects a mention only via an exact p-tag match from someone else', () => {
    const rumors = [
      // own message p-tagging self must NOT count as a mention
      rumor({ pubkey: ME, created_at: 400, tags: [['p', ME]] }),
      rumor({ pubkey: OTHER, created_at: 300, tags: [['p', ME]] }),
      rumor({ pubkey: OTHER, created_at: 200, tags: [['p', OTHER]] })
    ];
    expect(foldChannelSummary(rumors, ME).latestMention).toBe(300);
  });

  it('ignores rumors without created_at instead of producing NaN', () => {
    const summary = foldChannelSummary([{ pubkey: OTHER, tags: [] }], ME);
    expect(summary.latest).toBe(0);
  });
});

describe('mergeMarker', () => {
  it('raises a marker and returns a NEW object', () => {
    const markers = { 'c/x': 100 };
    const next = mergeMarker(markers, 'c/x', 200);
    expect(next['c/x']).toBe(200);
    expect(next).not.toBe(markers);
    expect(markers['c/x']).toBe(100); // input untouched
  });

  it('never rewinds (monotonic) and returns the SAME object when unchanged', () => {
    const markers = { 'c/x': 200 };
    expect(mergeMarker(markers, 'c/x', 100)).toBe(markers);
    expect(mergeMarker(markers, 'c/x', 200)).toBe(markers);
  });

  it('creates a missing key', () => {
    expect(mergeMarker({}, 'c/x', 50)).toEqual({ 'c/x': 50 });
  });
});

describe('summaryFlags', () => {
  it('is all-read for a missing summary', () => {
    expect(summaryFlags(undefined, 0)).toEqual({ unread: false, mentioned: false });
  });

  it('flags unread and mentioned against the marker', () => {
    const summary = { latest: 300, latestFromOthers: 300, latestMention: 250 };
    expect(summaryFlags(summary, 100)).toEqual({ unread: true, mentioned: true });
    expect(summaryFlags(summary, 250)).toEqual({ unread: true, mentioned: false });
    expect(summaryFlags(summary, 300)).toEqual({ unread: false, mentioned: false });
  });

  it('own messages alone never light unread', () => {
    const summary = { latest: 500, latestFromOthers: 0, latestMention: 0 };
    expect(summaryFlags(summary, 0)).toEqual({ unread: false, mentioned: false });
  });
});

describe('rollupArea', () => {
  const summaries = {
    ch1: { latest: 300, latestFromOthers: 300, latestMention: 0 },
    ch2: { latest: 200, latestFromOthers: 200, latestMention: 200 }
  };

  it('ORs unread across channels', () => {
    const markers = { 'cid/ch1': 300, 'cid/ch2': 100 };
    expect(rollupArea(summaries, markers, 'cid', 0)).toEqual({ unread: true, mentioned: true });
  });

  it('mention rollup is additionally gated by the community mention-read stamp', () => {
    const markers = { 'cid/ch1': 300, 'cid/ch2': 100 };
    // mentionReadTs at/after the mention suppresses the accent tier, unread stays
    expect(rollupArea(summaries, markers, 'cid', 200)).toEqual({ unread: true, mentioned: false });
  });

  it('is all-clear when every channel is read', () => {
    const markers = { 'cid/ch1': 300, 'cid/ch2': 200 };
    expect(rollupArea(summaries, markers, 'cid', 0)).toEqual({ unread: false, mentioned: false });
  });
});

describe('resolveLevel', () => {
  it('defaults to all and reads the stored level', () => {
    expect(resolveLevel({}, 'c', 'x')).toBe('all');
    expect(resolveLevel({ 'c/x': 'mentions' }, 'c', 'x')).toBe('mentions');
    expect(resolveLevel({ 'c/x': 'nothing' }, 'c', 'x')).toBe('nothing');
  });
});

describe('shouldToast', () => {
  /** @type {Parameters<typeof shouldToast>[0]} */
  const base = {
    createdAt: 1000,
    isMention: false,
    level: 'all',
    enabled: true,
    permissionGranted: true,
    tabVisible: false,
    isActiveChannel: false,
    marker: 0,
    startTime: 500,
    lastToastAt: 0,
    now: 100_000
  };

  it('fires for a fresh message with everything open', () => {
    expect(shouldToast(base)).toBe(true);
  });

  it('never fires when disabled or without permission', () => {
    expect(shouldToast({ ...base, enabled: false })).toBe(false);
    expect(shouldToast({ ...base, permissionGranted: false })).toBe(false);
  });

  it('respects the per-channel level', () => {
    expect(shouldToast({ ...base, level: 'nothing' })).toBe(false);
    expect(shouldToast({ ...base, level: 'mentions' })).toBe(false);
    expect(shouldToast({ ...base, level: 'mentions', isMention: true })).toBe(true);
  });

  it('suppresses the on-screen active channel but fires when the tab is hidden', () => {
    expect(shouldToast({ ...base, tabVisible: true, isActiveChannel: true })).toBe(false);
    expect(shouldToast({ ...base, tabVisible: false, isActiveChannel: true })).toBe(true);
    expect(shouldToast({ ...base, tabVisible: true, isActiveChannel: false })).toBe(true);
  });

  it('drops already-read and pre-start (cache replay) messages', () => {
    expect(shouldToast({ ...base, marker: 1000 })).toBe(false);
    expect(shouldToast({ ...base, createdAt: 400 })).toBe(false); // before startTime 500
  });

  it('throttles to one toast per channel per 30s', () => {
    expect(shouldToast({ ...base, lastToastAt: 100_000 - 10_000 })).toBe(false);
    expect(shouldToast({ ...base, lastToastAt: 100_000 - 31_000 })).toBe(true);
  });
});

describe('pruneMarkers', () => {
  it('drops markers for channels no longer live, keeps the rest', () => {
    const markers = { 'c/live': 1, 'c/gone': 2 };
    expect(pruneMarkers(markers, new Set(['c/live']))).toEqual({ 'c/live': 1 });
  });

  it('returns the same object when nothing is pruned', () => {
    const markers = { 'c/live': 1 };
    expect(pruneMarkers(markers, new Set(['c/live']))).toBe(markers);
  });
});
