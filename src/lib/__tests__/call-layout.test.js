// @ts-nocheck
/**
 * Call layout helpers: the auto-fit grid (largest 16:9 tile that fits all
 * seats into the stage), the layouts' spotlight slots (grid / focus / side
 * by side / speaker), pin bookkeeping (a new remote screen share takes a
 * slot; a vanished pin is dropped) and the grid's pagination.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  fitGrid,
  nextPins,
  pickStage,
  paginate,
  togglePinKey,
  maxPins,
  CALL_LAYOUTS
} from '$lib/groups/call-layout.js';

describe('fitGrid', () => {
  it('one seat fills the width when the stage is wide enough', () => {
    const g = fitGrid(1, 1600, 900, 8);
    expect(g.cols).toBe(1);
    expect(g.tileWidth).toBeCloseTo(1600);
  });

  it('two seats on a wide stage sit side by side', () => {
    expect(fitGrid(2, 1600, 500, 8).cols).toBe(2);
  });

  it('two seats on a tall stage stack', () => {
    expect(fitGrid(2, 400, 900, 8).cols).toBe(1);
  });

  it('picks the column count that maximises tile size', () => {
    // 6 seats in 1400x700: 3 cols x 2 rows beats 2x3 and 6x1.
    const g = fitGrid(6, 1400, 700, 8);
    expect(g.cols).toBe(3);
    expect(g.rows).toBe(2);
    expect(g.tileHeight).toBeCloseTo(g.tileWidth * (9 / 16));
    expect(g.rows * g.tileHeight + (g.rows - 1) * 8).toBeLessThanOrEqual(700 + 0.001);
  });

  it('falls back to a square-ish grid when the stage is not measured yet', () => {
    expect(fitGrid(5, 0, 0, 8)).toEqual({ cols: 3, rows: 2, tileWidth: 0, tileHeight: 0 });
    expect(fitGrid(0, 800, 600, 8)).toEqual({ cols: 1, rows: 0, tileWidth: 0, tileHeight: 0 });
  });
});

describe('pins', () => {
  it('side by side takes two pins, every other layout one', () => {
    expect(CALL_LAYOUTS).toEqual(['grid', 'focus', 'side', 'speaker']);
    expect(maxPins('side')).toBe(2);
    for (const layout of ['grid', 'focus', 'speaker']) expect(maxPins(layout)).toBe(1);
  });

  it('togglePinKey pins, unpins, and lets the newest pin replace the oldest past the limit', () => {
    expect(togglePinKey([], 'a', 1)).toEqual(['a']);
    expect(togglePinKey(['a'], 'a', 1)).toEqual([]);
    expect(togglePinKey(['a'], 'b', 1)).toEqual(['b']);
    expect(togglePinKey(['a'], 'b', 2)).toEqual(['a', 'b']);
    expect(togglePinKey(['a', 'b'], 'c', 2)).toEqual(['b', 'c']);
    expect(togglePinKey(['a', 'b'], 'a', 2)).toEqual(['b']);
  });

  it('a new remote screen share is pinned', () => {
    const seen = new Set();
    expect(nextPins([], ['seat:a', 'screen:b'], ['screen:b'], seen, 1)).toEqual(['screen:b']);
    expect(seen.has('screen:b')).toBe(true);
  });

  it('an already seen share does not steal the pin back', () => {
    const seen = new Set(['screen:b']);
    const pins = ['seat:a'];
    expect(nextPins(pins, ['seat:a', 'screen:b'], ['screen:b'], seen, 1)).toBe(pins);
  });

  it('a pin whose item vanished is dropped, and the share is forgotten', () => {
    const seen = new Set(['screen:b']);
    expect(nextPins(['screen:b'], ['seat:a'], [], seen, 1)).toEqual([]);
    expect(seen.has('screen:b')).toBe(false);
  });

  it('a share that stops and starts again is new again', () => {
    const seen = new Set();
    nextPins([], ['screen:b'], ['screen:b'], seen, 1);
    nextPins([], [], [], seen, 1);
    expect(nextPins([], ['screen:b'], ['screen:b'], seen, 1)).toEqual(['screen:b']);
  });

  it('two new shares both stay pinned where two pins fit, the newest wins where one fits', () => {
    const seen = new Set();
    const items = ['seat:a', 'screen:b', 'screen:c'];
    expect(nextPins([], items, ['screen:b', 'screen:c'], seen, 2)).toEqual([
      'screen:b',
      'screen:c'
    ]);
    expect(nextPins([], items, ['screen:b', 'screen:c'], new Set(), 1)).toEqual(['screen:c']);
  });

  it('a pinned seat gives way to a new share, oldest pin first', () => {
    const seen = new Set();
    const items = ['seat:a', 'seat:d', 'screen:b'];
    expect(nextPins(['seat:a', 'seat:d'], items, ['screen:b'], seen, 2)).toEqual([
      'seat:d',
      'screen:b'
    ]);
  });
});

describe('pickStage', () => {
  const me = 'seat:me';
  const base = {
    pins: [],
    itemKeys: [me, 'seat:a', 'seat:b'],
    remoteShareKeys: [],
    speakerKey: null,
    localKeys: [me]
  };

  it('grid: no slots unless something is pinned, then the pin is the spotlight', () => {
    expect(pickStage({ ...base, layout: 'grid' })).toEqual({ slots: [], strip: [] });
    expect(pickStage({ ...base, layout: 'grid', pins: ['seat:b'] })).toEqual({
      slots: ['seat:b'],
      strip: [me, 'seat:a']
    });
  });

  it('focus: always one spotlight — pin, else newest remote share, else speaker, else first remote', () => {
    expect(pickStage({ ...base, layout: 'focus' }).slots).toEqual(['seat:a']);
    expect(pickStage({ ...base, layout: 'focus', speakerKey: 'seat:b' }).slots).toEqual(['seat:b']);
    const shares = {
      ...base,
      itemKeys: ['screen:a', 'screen:b', me, 'seat:a', 'seat:b'],
      remoteShareKeys: ['screen:a', 'screen:b']
    };
    expect(pickStage({ ...shares, layout: 'focus', speakerKey: 'seat:b' }).slots).toEqual([
      'screen:b'
    ]);
    expect(pickStage({ ...shares, layout: 'focus', pins: ['seat:a'] }).slots).toEqual(['seat:a']);
  });

  it('focus: alone in the call, the own seat is the spotlight', () => {
    expect(pickStage({ ...base, layout: 'focus', itemKeys: [me] })).toEqual({
      slots: [me],
      strip: []
    });
  });

  it('side by side: two slots — two shares, or a share and the speaker, or two pins', () => {
    const shares = {
      ...base,
      itemKeys: ['screen:a', 'screen:b', me, 'seat:a', 'seat:b'],
      remoteShareKeys: ['screen:a', 'screen:b']
    };
    expect(pickStage({ ...shares, layout: 'side' })).toEqual({
      slots: ['screen:b', 'screen:a'],
      strip: [me, 'seat:a', 'seat:b']
    });
    const oneShare = {
      ...shares,
      itemKeys: ['screen:a', me, 'seat:a', 'seat:b'],
      remoteShareKeys: ['screen:a']
    };
    expect(pickStage({ ...oneShare, layout: 'side', speakerKey: 'seat:b' }).slots).toEqual([
      'screen:a',
      'seat:b'
    ]);
    expect(pickStage({ ...base, layout: 'side', pins: ['seat:b', me] }).slots).toEqual([
      'seat:b',
      me
    ]);
    // No shares, nobody speaking: the first two remote seats.
    expect(pickStage({ ...base, layout: 'side' }).slots).toEqual(['seat:a', 'seat:b']);
  });

  it('speaker: the active speaker beats an older share, a pin beats both', () => {
    const shares = {
      ...base,
      itemKeys: ['screen:a', me, 'seat:a', 'seat:b'],
      remoteShareKeys: ['screen:a']
    };
    expect(pickStage({ ...shares, layout: 'speaker', speakerKey: 'seat:b' }).slots).toEqual([
      'seat:b'
    ]);
    expect(pickStage({ ...shares, layout: 'speaker' }).slots).toEqual(['screen:a']);
    expect(
      pickStage({ ...shares, layout: 'speaker', speakerKey: 'seat:b', pins: ['seat:a'] }).slots
    ).toEqual(['seat:a']);
  });

  it('ignores pins and speakers that are not on the stage any more', () => {
    expect(
      pickStage({ ...base, layout: 'focus', pins: ['seat:gone'], speakerKey: 'seat:left' }).slots
    ).toEqual(['seat:a']);
  });

  it('a pin in a one-slot layout: the second pin is simply not shown', () => {
    const picked = pickStage({ ...base, layout: 'focus', pins: ['seat:a', 'seat:b'] });
    expect(picked.slots).toEqual(['seat:a']);
    expect(picked.strip).toEqual([me, 'seat:b']);
  });
});

describe('paginate', () => {
  it('splits the tiles into pages of the cap and clamps the page', () => {
    expect(paginate(20, 0, 9)).toEqual({ page: 0, pageCount: 3, start: 0, end: 9 });
    expect(paginate(20, 2, 9)).toEqual({ page: 2, pageCount: 3, start: 18, end: 20 });
    expect(paginate(20, 7, 9)).toEqual({ page: 2, pageCount: 3, start: 18, end: 20 });
    expect(paginate(20, -1, 9)).toEqual({ page: 0, pageCount: 3, start: 0, end: 9 });
  });

  it('one page when everyone fits, even for an empty stage', () => {
    expect(paginate(5, 0, 16)).toEqual({ page: 0, pageCount: 1, start: 0, end: 5 });
    expect(paginate(0, 3, 16)).toEqual({ page: 0, pageCount: 1, start: 0, end: 0 });
  });

  it('a page that emptied falls back to the last one', () => {
    // 19 people on page 3 of 9s, then 9 leave: page 2 (zero-based 1) is the last.
    expect(paginate(10, 2, 9)).toEqual({ page: 1, pageCount: 2, start: 9, end: 10 });
  });
});
