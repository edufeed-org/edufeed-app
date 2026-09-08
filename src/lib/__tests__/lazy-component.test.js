/**
 * lazyComponent() — a tiny holder that defers a component's `import()` until
 * the first time something actually reads `.Component`. Keeps the module out of
 * the root layout's static import graph (the landing page preloaded every modal
 * and sidebar chunk through it) while still rendering synchronously once loaded.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { lazyComponent } from '../helpers/lazy-component.svelte.js';

const Stub = () => {};

describe('lazyComponent', () => {
  it('does not call the loader until Component is first read', () => {
    const load = vi.fn(async () => ({ default: Stub }));
    lazyComponent(load);
    expect(load).not.toHaveBeenCalled();
  });

  it('returns null before the module resolves, then the default export', async () => {
    const load = vi.fn(async () => ({ default: Stub }));
    const lazy = lazyComponent(load);
    expect(lazy.Component).toBeNull();
    await vi.waitFor(() => expect(lazy.Component).toBe(Stub));
  });

  it('calls the loader only once across repeated reads', async () => {
    const load = vi.fn(async () => ({ default: Stub }));
    const lazy = lazyComponent(load);
    lazy.Component;
    lazy.Component;
    await vi.waitFor(() => expect(lazy.Component).toBe(Stub));
    lazy.Component;
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('retries the loader on a later read if the first import rejected', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ default: Stub });
    const lazy = lazyComponent(load);
    expect(lazy.Component).toBeNull();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(lazy.Component).toBeNull();
    await vi.waitFor(() => expect(lazy.Component).toBe(Stub));
    expect(load).toHaveBeenCalledTimes(2);
  });
});
