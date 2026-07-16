// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
vi.mock('$lib/services/pomegranate.js', () => ({
  startRecovery: vi.fn(),
  recoverShard: vi.fn(),
  aggregateNsec: vi.fn(),
  PomegranatePubkeyMismatchError: class extends Error {}
}));
// A plain object mock — a Proxy-based mock crashes under this repo's Vitest 4.
vi.mock('$lib/paraglide/messages', () => ({
  settings_pomegranate_title: () => 'settings_pomegranate_title',
  settings_pomegranate_description: () => 'settings_pomegranate_description',
  settings_pomegranate_export_button: () => 'settings_pomegranate_export_button',
  settings_pomegranate_next_shard: (params) =>
    `settings_pomegranate_next_shard:${params?.current}/${params?.needed}`,
  settings_pomegranate_error_mismatch: () => 'settings_pomegranate_error_mismatch',
  settings_pomegranate_copy: () => 'settings_pomegranate_copy',
  settings_pomegranate_copied: () => 'settings_pomegranate_copied'
}));

import PomegranateExportCard from '../settings/PomegranateExportCard.svelte';

describe('PomegranateExportCard', () => {
  beforeEach(() => active$.next(null));

  it('hidden for non-pomegranate accounts', () => {
    active$.next({ pubkey: 'a'.repeat(64), type: 'nostr-connect', metadata: {} });
    const { queryByTestId } = render(PomegranateExportCard);
    expect(queryByTestId('pomegranate-export-card')).toBeNull();
  });

  it('visible for pomegranate accounts', async () => {
    active$.next({
      pubkey: 'a'.repeat(64),
      type: 'nostr-connect',
      metadata: { pomegranateCentral: 'https://auth.njump.me' }
    });
    const { findByTestId } = render(PomegranateExportCard);
    expect(await findByTestId('pomegranate-export-card')).toBeTruthy();
  });
});
