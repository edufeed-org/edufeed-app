/** @vitest-environment jsdom */
// The /c dashboard sends a logged-out visitor home — but only once the stored
// accounts are restored. The boot emission of `active$` is no logout: redirecting
// on it dropped every deep link's query (`?termi=<id>`, `?view=my-stuff`) on a reload.
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { BehaviorSubject } from 'rxjs';

const goto = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ p) => p }));
const env = vi.hoisted(() => ({
  restore: /** @type {(v?: unknown) => void} */ (() => {}),
  active$: /** @type {any} */ (null),
  manager: /** @type {any} */ ({})
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: env.manager,
  accountsRestored: new Promise((r) => (env.restore = r))
}));

const { default: Layout } = await import('../../../routes/c/(dashboard)/+layout.svelte');
const children = createRawSnippet(() => ({ render: () => '<p data-testid="dash">Dash</p>' }));
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('/c dashboard guard', () => {
  it('waits for the account restore before sending a logged-out visitor home', async () => {
    env.active$ = new BehaviorSubject(undefined);
    env.manager.active$ = env.active$;
    Object.defineProperty(env.manager, 'active', {
      get: () => env.active$.value,
      configurable: true
    });
    const view = render(Layout, { props: { children } });
    await tick();
    expect(goto).not.toHaveBeenCalled();
    // the restore brings the stored account back: no redirect, the page renders
    env.active$.next({ id: 'a', pubkey: 'pk' });
    env.restore();
    await tick();
    expect(goto).not.toHaveBeenCalled();
    expect(view.getByTestId('dash')).toBeTruthy();
    // a real logout afterwards still goes home
    env.active$.next(undefined);
    await tick();
    expect(goto).toHaveBeenCalledWith('/');
  });
});
