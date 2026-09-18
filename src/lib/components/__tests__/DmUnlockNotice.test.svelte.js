/** @vitest-environment jsdom */
/**
 * DmUnlockNotice — the messages a gift-wrap unlock could not decrypt used to
 * vanish with nothing but a console warning (laoc, 2026-09-18). The thread
 * simply looked shorter. This surfaces the count and offers a retry.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

vi.mock('$lib/paraglide/messages', () => ({
  dm_unlock_failed_one: () => '1 message could not be decrypted',
  dm_unlock_failed_many: (/** @type {{count: number}} */ { count }) =>
    `${count} messages could not be decrypted`,
  dm_unlock_retry: () => 'Try again',
  dm_unlock_retrying: () => 'Trying…'
}));

import DmUnlockNotice from '$lib/components/dm/DmUnlockNotice.svelte';

describe('DmUnlockNotice', () => {
  it('renders nothing when no message is hidden', () => {
    const { queryByTestId } = render(DmUnlockNotice, { props: { count: 0, onRetry: () => {} } });
    expect(queryByTestId('dm-unlock-notice')).toBeNull();
  });

  it('names how many messages are hidden, singular and plural', () => {
    const one = render(DmUnlockNotice, { props: { count: 1, onRetry: () => {} } });
    expect(one.getByTestId('dm-unlock-notice').textContent).toContain(
      '1 message could not be decrypted'
    );
    one.unmount();
    const many = render(DmUnlockNotice, { props: { count: 3, onRetry: () => {} } });
    expect(many.getByTestId('dm-unlock-notice').textContent).toContain(
      '3 messages could not be decrypted'
    );
  });

  it('calls onRetry when the button is pressed', async () => {
    const onRetry = vi.fn();
    const { getByRole } = render(DmUnlockNotice, { props: { count: 2, onRetry } });
    await fireEvent.click(getByRole('button'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('disables the button and says so while a retry runs', () => {
    const { getByRole } = render(DmUnlockNotice, {
      props: { count: 2, onRetry: () => {}, retrying: true }
    });
    const button = /** @type {HTMLButtonElement} */ (getByRole('button'));
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Trying…');
  });
});
