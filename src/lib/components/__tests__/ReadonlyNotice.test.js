// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { BehaviorSubject } from 'rxjs';

const active$ = new BehaviorSubject(null);
// `active$` is read via a getter (not destructured eagerly) because vi.mock
// factories are hoisted above this const — an eager `{ active$ }` literal
// hits the TDZ before the BehaviorSubject is constructed.
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    get active$() {
      return active$;
    }
  }
}));
vi.mock('$lib/stores/accounts.svelte.js', () => ({
  manager: {
    get active$() {
      return active$;
    }
  }
}));
vi.mock('$lib/paraglide/messages', () => ({
  readonly_sign_prompt: () => 'read-only prompt'
}));

import ReadonlyNotice from '../shared/ReadonlyNotice.svelte';

describe('ReadonlyNotice', () => {
  it('renders nothing for signing accounts', () => {
    active$.next({ type: 'extension', pubkey: 'a'.repeat(64) });
    const { queryByTestId } = render(ReadonlyNotice);
    expect(queryByTestId('readonly-notice')).toBeNull();
  });

  it('renders the notice for a readonly account', async () => {
    active$.next({ type: 'readonly', pubkey: 'a'.repeat(64) });
    const { findByTestId } = render(ReadonlyNotice);
    expect(await findByTestId('readonly-notice')).toBeTruthy();
  });
});
