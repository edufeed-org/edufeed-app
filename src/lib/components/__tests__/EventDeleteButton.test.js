/**
 * EventDeleteButton Component Tests
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import EventDeleteButton from '../shared/EventDeleteButton.svelte';

const mockDeleteEvent = vi.fn();
const mockShowToast = vi.fn();

vi.mock('$lib/helpers/eventDeletion.js', () => ({
  deleteEvent: (/** @type {any[]} */ ...args) => mockDeleteEvent(...args)
}));

vi.mock('$lib/helpers/toast.js', () => ({
  showToast: (/** @type {any[]} */ ...args) => mockShowToast(...args)
}));

vi.mock('$lib/paraglide/messages', () => ({
  delete_confirm_text: () => 'Are you sure you want to delete',
  delete_confirm_cannot_undo: () => 'This action cannot be undone.',
  event_delete_success: () => 'Deleted successfully',
  event_delete_error: () => 'Failed to delete'
}));

const ownerPubkey = 'aabbccdd11223344aabbccdd11223344aabbccdd11223344aabbccdd11223344';
const otherPubkey = '11223344aabbccdd11223344aabbccdd11223344aabbccdd11223344aabbccdd';

const mockEvent = {
  id: 'event-1',
  kind: 9802,
  pubkey: ownerPubkey,
  tags: [],
  created_at: 1700000000,
  content: 'highlighted text'
};

const mockActiveUser = {
  pubkey: ownerPubkey,
  signer: {}
};

describe('EventDeleteButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteEvent.mockResolvedValue({ success: true });
  });

  it('renders nothing when no activeUser', () => {
    const { container } = render(EventDeleteButton, {
      props: { event: mockEvent }
    });
    expect(container.querySelector('button')).toBeNull();
  });

  it('renders nothing when user does not own the event', () => {
    const { container } = render(EventDeleteButton, {
      props: {
        event: mockEvent,
        activeUser: { pubkey: otherPubkey, signer: {} }
      }
    });
    expect(container.querySelector('button')).toBeNull();
  });

  it('renders trash icon button when user owns the event', () => {
    render(EventDeleteButton, {
      props: { event: mockEvent, activeUser: mockActiveUser }
    });
    const btn = /** @type {HTMLButtonElement} */ (screen.getByTestId('event-delete-btn'));
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(false);
  });

  it('calls deleteEvent on confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(EventDeleteButton, {
      props: { event: mockEvent, activeUser: mockActiveUser }
    });

    const btn = screen.getByTestId('event-delete-btn');
    btn.click();

    await waitFor(() => {
      expect(mockDeleteEvent).toHaveBeenCalledWith(mockEvent, mockActiveUser);
      expect(mockShowToast).toHaveBeenCalledWith('Deleted successfully', 'success');
    });
  });

  it('does not call deleteEvent when confirm is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(EventDeleteButton, {
      props: { event: mockEvent, activeUser: mockActiveUser }
    });

    const btn = screen.getByTestId('event-delete-btn');
    btn.click();

    expect(mockDeleteEvent).not.toHaveBeenCalled();
  });

  it('shows error toast on failure', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockDeleteEvent.mockResolvedValue({ success: false, error: 'Network error' });

    render(EventDeleteButton, {
      props: { event: mockEvent, activeUser: mockActiveUser }
    });

    const btn = screen.getByTestId('event-delete-btn');
    btn.click();

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('Failed to delete', 'error');
    });
  });
});
