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
});
