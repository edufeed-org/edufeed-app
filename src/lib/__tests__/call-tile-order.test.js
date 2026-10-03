/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { withHand, handQueue, orderSeats } from '$lib/groups/call-tile-order.js';

describe('withHand / handQueue: raised hands in the order they went up', () => {
  it('queues hands by raise time, first raised first', () => {
    let times = new Map();
    times = withHand(times, 'bob', true, 200);
    times = withHand(times, 'alice', true, 100);
    times = withHand(times, 'carol', true, 300);
    expect(handQueue(times)).toEqual(['alice', 'bob', 'carol']);
  });

  it('lowering removes the hand; raising again goes to the back', () => {
    let times = new Map();
    times = withHand(times, 'a', true, 1);
    times = withHand(times, 'b', true, 2);
    times = withHand(times, 'a', false, 3);
    expect(handQueue(times)).toEqual(['b']);
    times = withHand(times, 'a', true, 4);
    expect(handQueue(times)).toEqual(['b', 'a']);
  });

  it('a repeated "up" keeps the original raise time', () => {
    let times = new Map();
    times = withHand(times, 'a', true, 1);
    times = withHand(times, 'b', true, 2);
    times = withHand(times, 'a', true, 9);
    expect(handQueue(times)).toEqual(['a', 'b']);
  });

  it('never mutates the map it was given', () => {
    const times = new Map([['a', 1]]);
    const next = withHand(times, 'b', true, 2);
    expect(times.size).toBe(1);
    expect(next).not.toBe(times);
  });

  it('breaks ties by identity so every viewer agrees', () => {
    let times = new Map();
    times = withHand(times, 'z', true, 5);
    times = withHand(times, 'm', true, 5);
    expect(handQueue(times)).toEqual(['m', 'z']);
  });
});

describe('orderSeats: base order + raised hands', () => {
  const base = ['me', 'a', 'b', 'c'];

  it('keeps the base order without hands', () => {
    expect(orderSeats(base, [])).toEqual(base);
  });

  it('moves raised hands to the front in queue order', () => {
    expect(orderSeats(base, ['c', 'a'])).toEqual(['c', 'a', 'me', 'b']);
  });

  it('a lowered hand goes back to its normal place', () => {
    expect(orderSeats(base, ['c'])).toEqual(['c', 'me', 'a', 'b']);
    expect(orderSeats(base, [])).toEqual(base);
  });

  it('ignores hands of seats that are not on the stage', () => {
    expect(orderSeats(base, ['gone', 'b'])).toEqual(['b', 'me', 'a', 'c']);
  });
});
