/**
 * Call layout helpers: the auto-fit grid (largest 16:9 tile that fits all
 * seats into the stage) and the spotlight bookkeeping (a new screen share
 * takes the spotlight; a vanished pin is dropped).
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { fitGrid, nextSpotlight } from '$lib/groups/call-layout.js';

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

describe('nextSpotlight', () => {
  it('a new screen share takes the spotlight', () => {
    const seen = new Set();
    expect(nextSpotlight(null, ['seat:a'], ['screen:b'], seen)).toBe('screen:b');
    expect(seen.has('screen:b')).toBe(true);
  });

  it('an already seen share does not steal the spotlight back', () => {
    const seen = new Set(['screen:b']);
    expect(nextSpotlight('seat:a', ['seat:a'], ['screen:b'], seen)).toBe('seat:a');
  });

  it('a pin whose item vanished is dropped, and the share is forgotten', () => {
    const seen = new Set(['screen:b']);
    expect(nextSpotlight('screen:b', ['seat:a'], [], seen)).toBeNull();
    expect(seen.has('screen:b')).toBe(false);
  });

  it('a share that stops and starts again is new again', () => {
    const seen = new Set();
    nextSpotlight(null, [], ['screen:b'], seen);
    nextSpotlight(null, [], [], seen);
    expect(nextSpotlight(null, [], ['screen:b'], seen)).toBe('screen:b');
  });
});
