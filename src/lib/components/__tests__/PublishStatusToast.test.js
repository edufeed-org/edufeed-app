// @ts-nocheck
/** @vitest-environment jsdom */
/**
 * PublishStatusToast — a total failure reads differently depending on
 * whether the outbox will retry it (no relay answered) or not (every relay
 * said no). Issue fd042051.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';

/** @type {(status: any) => void} */
let emit = () => {};
vi.mock('$lib/services/publish-service.js', () => ({
  subscribeToPublishStatus: vi.fn((cb) => {
    emit = cb;
    return () => {};
  })
}));

import PublishStatusToast from '$lib/components/shared/PublishStatusToast.svelte';

const failed = (extra = {}) => ({
  eventId: 'e1',
  status: 'failed',
  successCount: 0,
  totalRelays: 2,
  error: 'Failed to publish to any relay',
  ...extra
});

describe('PublishStatusToast', () => {
  it('says the publish will be retried when no relay answered', async () => {
    const { getByText } = render(PublishStatusToast);
    emit(failed({ retryQueued: true }));
    await tick();
    expect(getByText(/will retry automatically/i)).toBeTruthy();
  });

  it('shows the plain failure when every relay rejected the event', async () => {
    const { getByText, queryByText } = render(PublishStatusToast);
    emit(failed({ retryQueued: false }));
    await tick();
    expect(getByText(/failed to publish/i)).toBeTruthy();
    expect(queryByText(/will retry automatically/i)).toBeNull();
  });
});
