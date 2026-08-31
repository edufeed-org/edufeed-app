// @ts-nocheck
/* eslint-disable no-undef -- $effect is a Svelte rune, available in .svelte.js/.svelte.test.js context */
/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { flushSync } from 'svelte';
import { useObservable } from '$lib/concord/bridge.svelte.js';

describe('useObservable', () => {
  it('tracks the observable and cleans up on teardown', () => {
    const subject = new BehaviorSubject(1);
    let getValue;
    const cleanup = $effect.root(() => {
      getValue = useObservable(() => subject, 0);
    });
    flushSync();
    expect(getValue()).toBe(1);
    subject.next(2);
    flushSync();
    expect(getValue()).toBe(2);
    cleanup();
    expect(subject.observers.length).toBe(0);
  });

  it('returns initial when getter yields undefined', () => {
    let getValue;
    const cleanup = $effect.root(() => {
      getValue = useObservable(() => undefined, 'fallback');
    });
    flushSync();
    expect(getValue()).toBe('fallback');
    cleanup();
  });
});
