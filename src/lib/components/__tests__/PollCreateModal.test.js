/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';
import PollCreateModal from '$lib/components/polls/PollCreateModal.svelte';

vi.mock('$lib/stores/modal.svelte.js', () => ({
  modalStore: { closeModal: vi.fn() }
}));

vi.mock('$lib/stores/joined-communities-list.svelte.js', () => ({
  useJoinedCommunitiesList: () => () => []
}));

vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));

describe('PollCreateModal — form & validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts with two empty option rows', () => {
    render(PollCreateModal, { props: {} });
    const optionInputs = screen.getAllByPlaceholderText(/option/i);
    expect(optionInputs.length).toBe(2);
  });

  it('"Add option" appends a row', async () => {
    render(PollCreateModal, { props: {} });
    await fireEvent.click(screen.getByRole('button', { name: /add option/i }));
    const optionInputs = screen.getAllByPlaceholderText(/option/i);
    expect(optionInputs.length).toBe(3);
  });

  it('disables submit until question + ≥2 distinct non-empty options', async () => {
    render(PollCreateModal, { props: {} });
    const submit = /** @type {HTMLButtonElement} */ (
      screen.getByRole('button', { name: /publish poll/i })
    );
    expect(submit.disabled).toBe(true);

    const question = screen.getByPlaceholderText(/question/i);
    await fireEvent.input(question, { target: { value: 'Pizza topping?' } });
    expect(submit.disabled).toBe(true);

    const options = screen.getAllByPlaceholderText(/option/i);
    await fireEvent.input(options[0], { target: { value: 'Pineapple' } });
    await fireEvent.input(options[1], { target: { value: 'Pineapple' } });
    expect(submit.disabled).toBe(true);

    await fireEvent.input(options[1], { target: { value: 'Mushroom' } });
    expect(submit.disabled).toBe(false);
  });

  it('endsAt presets are 24h / 7d / 30d / no end / custom', () => {
    render(PollCreateModal, { props: {} });
    expect(screen.getByRole('button', { name: '24h' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '7 days' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '30 days' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /no end/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /custom/i })).toBeTruthy();
  });

  it('default endsAt preset is "7 days"', () => {
    render(PollCreateModal, { props: {} });
    const sevenDays = screen.getByRole('button', { name: '7 days' });
    expect(sevenDays.getAttribute('aria-pressed')).toBe('true');
  });

  it('community pre-fill: communityPubkey prop sets the dropdown value', () => {
    render(PollCreateModal, { props: { communityPubkey: 'abc123' } });
    const select = screen.getByLabelText(/community/i);
    expect(/** @type {HTMLSelectElement} */ (select).value).toBe('abc123');
  });
});
