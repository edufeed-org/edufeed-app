/**
 * CalendarEventPreview: embedded event card shows InlineRsvp for logged-in
 * users (block variant only) and hides it when logged out or inline.
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';

const RAW_EVENT = {
  id: 'raw1',
  pubkey: 'c'.repeat(64),
  kind: 31923,
  content: 'desc',
  created_at: 1718452800,
  tags: [
    ['d', 'd1'],
    ['title', 'Test Event'],
    ['start', '1718452800']
  ]
};

// Login state toggled per test
let mockUser = /** @type {any} */ (null);

vi.mock('$lib/helpers/nostrUtils.js', async (importOriginal) => {
  const original = /** @type {any} */ (await importOriginal());
  return { ...original, fetchEventById: vi.fn(async () => RAW_EVENT) };
});
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => mockUser
}));
vi.mock(
  '$lib/components/calendar/InlineRsvp.svelte',
  () => import('./fixtures/InlineRsvpStub.svelte')
);

import CalendarEventPreview from '../NostrPreviews/CalendarEventPreview.svelte';

const PROPS = { identifier: 'naddr1test', decoded: { success: true }, inline: false };

describe('CalendarEventPreview RSVP', () => {
  beforeEach(() => {
    mockUser = null;
  });

  it('shows InlineRsvp with the raw event when logged in', async () => {
    mockUser = { pubkey: 'u'.repeat(64) };
    const { findByTestId } = render(CalendarEventPreview, PROPS);
    const stub = await findByTestId('inline-rsvp-stub');
    expect(stub.getAttribute('data-event-id')).toBe('raw1');
  });

  it('hides InlineRsvp when logged out', async () => {
    const { findByText, queryByTestId } = render(CalendarEventPreview, PROPS);
    await findByText('Test Event');
    expect(queryByTestId('inline-rsvp-stub')).toBeNull();
  });

  it('shows InlineRsvp in inline variant too (nostr: mentions arrive with inline=true)', async () => {
    mockUser = { pubkey: 'u'.repeat(64) };
    const { findByTestId } = render(CalendarEventPreview, {
      ...PROPS,
      inline: true
    });
    const stub = await findByTestId('inline-rsvp-stub');
    expect(stub.getAttribute('data-event-id')).toBe('raw1');
  });
});
