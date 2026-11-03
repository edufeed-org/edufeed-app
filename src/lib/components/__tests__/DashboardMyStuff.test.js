/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { SHELF_ORDER } from '$lib/helpers/myContentTypes.js';

vi.mock('$app/stores', async () => {
  const { readable } = await import('svelte/store');
  return { page: readable({ url: new URL('http://localhost/c?tab=lists') }) };
});
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('../dashboard/DashboardYourContent.svelte', () => ({ default: () => ({}) }));
vi.mock('../dashboard/DashboardLists.svelte', () => ({ default: () => ({}) }));

const { default: DashboardMyStuff } = await import('../dashboard/DashboardMyStuff.svelte');

describe('DashboardMyStuff', () => {
  // The "Neu erstellen" menu lists every shelf type; a type added to
  // myContentTypes without a CREATE_UI entry threw and took the dashboard down.
  it('offers a create entry for every shelf type', () => {
    const r = render(DashboardMyStuff, { props: { pubkey: 'a'.repeat(64) } });
    const items = r.container.querySelectorAll('.dropdown-content button');
    expect(items).toHaveLength(SHELF_ORDER.length);
    for (const item of items) expect(item.textContent?.trim()).not.toBe('');
  });
});
