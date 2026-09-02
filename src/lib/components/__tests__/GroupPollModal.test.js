/**
 * GroupPollModal — the NIP-29 room poll composer. The wire format itself is
 * buildPollTemplate's (groups-helpers.test.js) and the publish path is
 * GroupChat's (GroupChat.test.js "room polls"); this covers the modal's own
 * contract: validation gating, the option/duration/polltype controls, and
 * what it hands to onCreate.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

vi.mock('$lib/paraglide/messages', () => ({
  groups_poll_title: () => 'New poll',
  groups_poll_question_placeholder: () => 'Ask a question…',
  groups_poll_option_placeholder: (/** @type {{ number: number }} */ { number }) =>
    `Option ${number}`,
  groups_poll_add_option: () => 'Add option',
  groups_poll_multiple: () => 'Allow multiple answers',
  groups_poll_duration: () => 'Poll duration',
  groups_poll_duration_none: () => 'No end',
  groups_poll_duration_days: (/** @type {{ count: number }} */ { count }) => `${count} days`,
  groups_poll_create: () => 'Create poll',
  common_cancel: () => 'Cancel'
}));

const { default: GroupPollModal } = await import('$lib/components/groups/GroupPollModal.svelte');

/** @returns {{onCreate: import('vitest').Mock, onClose: import('vitest').Mock}} */
function mount(overrides = {}) {
  const props = {
    onCreate: vi.fn().mockResolvedValue(true),
    onClose: vi.fn(),
    ...overrides
  };
  render(GroupPollModal, { props });
  return props;
}

describe('GroupPollModal', () => {
  it('disables create until a question and two options are filled', async () => {
    mount();
    const create = screen.getByTestId('group-poll-create');
    expect(create.hasAttribute('disabled')).toBe(true);

    await fireEvent.input(screen.getByTestId('group-poll-question'), {
      target: { value: 'Pizza?' }
    });
    await fireEvent.input(screen.getByTestId('group-poll-option-0'), {
      target: { value: 'Yes' }
    });
    expect(create.hasAttribute('disabled')).toBe(true);

    await fireEvent.input(screen.getByTestId('group-poll-option-1'), { target: { value: 'No' } });
    expect(create.hasAttribute('disabled')).toBe(false);
  });

  it('adds further option inputs and drops blank ones from the created poll', async () => {
    const { onCreate } = mount();
    await fireEvent.input(screen.getByTestId('group-poll-question'), {
      target: { value: 'Day?' }
    });
    await fireEvent.input(screen.getByTestId('group-poll-option-0'), {
      target: { value: 'Monday' }
    });
    await fireEvent.input(screen.getByTestId('group-poll-option-1'), {
      target: { value: 'Friday' }
    });
    await fireEvent.click(screen.getByTestId('group-poll-add-option'));
    // The third input exists but stays blank — it must not become an option.
    expect(screen.getByTestId('group-poll-option-2')).toBeTruthy();

    await fireEvent.click(screen.getByTestId('group-poll-create'));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    const details = onCreate.mock.calls[0][0];
    expect(details.options.map((/** @type {{label: string}} */ o) => o.label)).toEqual([
      'Monday',
      'Friday'
    ]);
    expect(details.pollType).toBe('singlechoice');
    // Default duration: 7 days, as unix-seconds endsAt.
    const now = Math.floor(Date.now() / 1000);
    expect(details.endsAt).toBeGreaterThan(now + 6 * 86_400);
    expect(details.endsAt).toBeLessThanOrEqual(now + 7 * 86_400);
  });

  it('passes multiplechoice and omits endsAt for a no-end poll', async () => {
    const { onCreate } = mount();
    await fireEvent.input(screen.getByTestId('group-poll-question'), {
      target: { value: 'Toppings?' }
    });
    await fireEvent.input(screen.getByTestId('group-poll-option-0'), {
      target: { value: 'Cheese' }
    });
    await fireEvent.input(screen.getByTestId('group-poll-option-1'), {
      target: { value: 'Salami' }
    });
    await fireEvent.click(screen.getByLabelText('Allow multiple answers'));
    const select = screen.getByRole('combobox');
    await fireEvent.change(select, {
      target: {
        value: [...select.querySelectorAll('option')].find((o) => o.text === 'No end')?.value
      }
    });

    await fireEvent.click(screen.getByTestId('group-poll-create'));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    const details = onCreate.mock.calls[0][0];
    expect(details.pollType).toBe('multiplechoice');
    expect(details.endsAt).toBeUndefined();
  });

  it('stays open (draft intact) when onCreate reports failure', async () => {
    const { onCreate, onClose } = mount({ onCreate: vi.fn().mockResolvedValue(false) });
    await fireEvent.input(screen.getByTestId('group-poll-question'), {
      target: { value: 'Q?' }
    });
    await fireEvent.input(screen.getByTestId('group-poll-option-0'), { target: { value: 'A' } });
    await fireEvent.input(screen.getByTestId('group-poll-option-1'), { target: { value: 'B' } });
    await fireEvent.click(screen.getByTestId('group-poll-create'));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
    expect(/** @type {HTMLInputElement} */ (screen.getByTestId('group-poll-question')).value).toBe(
      'Q?'
    );
  });
});
