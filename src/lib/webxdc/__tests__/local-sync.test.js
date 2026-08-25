/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createLocalSync } from '../local-sync.js';

describe('createLocalSync', () => {
  beforeEach(() => localStorage.clear());

  it('appends updates in order and notifies subscribers', () => {
    const sync = createLocalSync('webxdc:state:test');
    const changed = vi.fn();
    sync.subscribe(changed);
    sync.sendState({ n: 1 });
    sync.sendState({ n: 2 }, { info: 'two', summary: 'sum' });
    expect(sync.getUpdates().map((u) => u.payload.n)).toEqual([1, 2]);
    expect(sync.getUpdates()[1].info).toBe('two');
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('persists across instances with the same key', () => {
    createLocalSync('webxdc:state:test').sendState({ saved: true });
    expect(createLocalSync('webxdc:state:test').getUpdates()[0].payload.saved).toBe(true);
  });

  it('isolates keys', () => {
    createLocalSync('webxdc:state:a').sendState({ x: 1 });
    expect(createLocalSync('webxdc:state:b').getUpdates()).toEqual([]);
  });

  it('realtime is a no-op without peers but unsubscribes cleanly', () => {
    const sync = createLocalSync('webxdc:state:test');
    const cb = vi.fn();
    const off = sync.onRealtime(cb);
    sync.sendRealtime(new Uint8Array([1]));
    expect(cb).not.toHaveBeenCalled(); // spec: realtime goes to OTHER participants only
    off();
  });

  it('survives corrupted storage', () => {
    localStorage.setItem('webxdc:state:test', '{not json');
    expect(createLocalSync('webxdc:state:test').getUpdates()).toEqual([]);
  });

  it('getUpdates returns a shallow copy, not the live array', () => {
    const sync = createLocalSync('webxdc:state:test');
    sync.sendState({ n: 1 });
    const first = sync.getUpdates();
    first.push({ payload: { n: 99 } }); // mutate the returned array
    expect(sync.getUpdates().length).toBe(1); // internal array unaffected
    expect(sync.getUpdates()[0].payload.n).toBe(1);
  });

  it('subscriber that throws does not prevent other subscribers from notifying', () => {
    const sync = createLocalSync('webxdc:state:test');
    const throwing = vi.fn(() => {
      throw new Error('subscriber failed');
    });
    const working = vi.fn();
    sync.subscribe(throwing);
    sync.subscribe(working);
    expect(() => sync.sendState({ n: 1 })).not.toThrow();
    expect(throwing).toHaveBeenCalledTimes(1);
    expect(working).toHaveBeenCalledTimes(1);
  });

  it('stores falsy-but-valid meta values (empty string, zero, false)', () => {
    const sync = createLocalSync('webxdc:state:test');
    sync.sendState({ n: 1 }, { info: '' });
    expect(sync.getUpdates()[0].info).toBe('');
    sync.sendState({ n: 2 }, { info: undefined });
    expect(sync.getUpdates()[1]).not.toHaveProperty('info');
    sync.sendState({ n: 3 }, { summary: 0 });
    expect(sync.getUpdates()[2].summary).toBe(0);
  });
});
