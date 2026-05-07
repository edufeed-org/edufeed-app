/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';
import { tick } from 'svelte';

// jsdom does not implement window.matchMedia; app-settings.svelte.js calls it
// at import-time. Stub it before any module load triggers that path.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && !window.matchMedia) {
    // @ts-ignore
    window.matchMedia = () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {}
    });
  }
});

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

vi.mock('applesauce-core/helpers', () => ({
  getDisplayName: (/** @type {any} */ profile) => profile?.name ?? null
}));

// Hoisted mocks for submit test. Use vi.hoisted to share spies between
// the mock factory and the assertions inside the test.
/** @type {{ publishSpy: any; signSpy: any; gotoSpy: any }} */
const submitSpies = vi.hoisted(() => ({
  publishSpy: null,
  signSpy: null,
  gotoSpy: null
}));

vi.mock('$lib/services/publish-service.js', () => ({
  publishEvent: (/** @type {any[]} */ ...args) => submitSpies.publishSpy(...args)
}));

vi.mock('$lib/stores/accounts.svelte.js', () => ({
  manager: {
    active: {
      pubkey: 'me',
      signEvent: (/** @type {any} */ tmpl) => submitSpies.signSpy(tmpl)
    }
  }
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    add: vi.fn(),
    getReplaceable: vi.fn().mockReturnValue(null)
  }
}));

vi.mock('$app/navigation', () => ({
  goto: (/** @type {any[]} */ ...args) => submitSpies.gotoSpy?.(...args)
}));

vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ p) => p }));

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

  it('disables submit when "Custom…" is selected but no datetime entered', async () => {
    render(PollCreateModal, { props: {} });
    // Fill in valid question + options
    await fireEvent.input(screen.getByPlaceholderText(/question/i), {
      target: { value: 'Pizza topping?' }
    });
    const options = screen.getAllByPlaceholderText(/option/i);
    await fireEvent.input(options[0], { target: { value: 'A' } });
    await fireEvent.input(options[1], { target: { value: 'B' } });

    const submit = /** @type {HTMLButtonElement} */ (
      screen.getByRole('button', { name: /publish poll/i })
    );
    expect(submit.disabled).toBe(false); // 7d default, valid

    // Switch to Custom; submit should disable
    await fireEvent.click(screen.getByRole('button', { name: /custom/i }));
    expect(submit.disabled).toBe(true);
  });
});

describe('PollCreateModal — submit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    submitSpies.publishSpy = vi
      .fn()
      .mockResolvedValue({ success: true, successCount: 1, relays: [], results: [] });
    submitSpies.signSpy = vi.fn().mockImplementation((/** @type {any} */ tmpl) => ({
      ...tmpl,
      // 64-char hex id required for nip19.neventEncode
      id: 'a'.repeat(64),
      pubkey: 'b'.repeat(64),
      sig: 'c'.repeat(128)
    }));
    submitSpies.gotoSpy = vi.fn();
  });

  it('builds a kind 1068 with options + polltype + endsAt and publishes it', async () => {
    render(PollCreateModal, { props: {} });

    await fireEvent.input(screen.getByPlaceholderText(/question/i), {
      target: { value: 'Q?' }
    });
    const opts = screen.getAllByPlaceholderText(/option/i);
    await fireEvent.input(opts[0], { target: { value: 'A' } });
    await fireEvent.input(opts[1], { target: { value: 'B' } });

    await fireEvent.click(screen.getByRole('button', { name: /publish poll/i }));
    await tick();
    // Allow microtasks for async signEvent + publish to resolve
    await new Promise((r) => setTimeout(r, 50));

    expect(submitSpies.signSpy).toHaveBeenCalled();
    const tmpl = submitSpies.signSpy.mock.calls[0][0];
    expect(tmpl.kind).toBe(1068);
    expect(tmpl.tags).toEqual(expect.arrayContaining([['polltype', 'singlechoice']]));
    expect(tmpl.tags.some((/** @type {string[]} */ t) => t[0] === 'option')).toBe(true);
    expect(tmpl.tags.some((/** @type {string[]} */ t) => t[0] === 'endsAt')).toBe(true);

    expect(submitSpies.publishSpy).toHaveBeenCalled();
  });
});
