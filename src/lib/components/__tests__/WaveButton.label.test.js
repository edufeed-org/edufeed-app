// @ts-nocheck
/** @vitest-environment jsdom */
// The profile header's desktop row renders the wave as a labelled pill;
// everywhere else it stays the icon circle.
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';

vi.mock('$lib/paraglide/messages.js', () => ({
  wave_button_tooltip: () => 'Winken',
  wave_cooldown_tooltip: () => 'Schon gewinkt',
  wave_error: () => 'Fehler'
}));
vi.mock('$lib/helpers/toast', () => ({ showToast: vi.fn() }));
vi.mock('$lib/loaders/reactions.js', () => ({
  reactionsLoader: () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    reactions: () => ({
      subscribe: (cb) => {
        (cb.next ?? cb)([]);
        return { unsubscribe: () => {} };
      }
    }),
    model: () => ({
      subscribe: (cb) => {
        (cb.next ?? cb)([]);
        return { unsubscribe: () => {} };
      }
    }),
    timeline: () => ({
      subscribe: (cb) => {
        (cb.next ?? cb)([]);
        return { unsubscribe: () => {} };
      }
    })
  }
}));
vi.mock('$lib/helpers/waves.js', () => ({
  publishWave: vi.fn(),
  canWave: () => ({ canWave: true }),
  isWave: () => false
}));

const { default: WaveButton } = await import('../waves/WaveButton.svelte');
const props = {
  profileEvent: { id: 'e'.repeat(64), kind: 0, pubkey: 'a'.repeat(64) },
  pubkey: 'b'.repeat(64)
};

describe('WaveButton', () => {
  it('is an icon circle by default', () => {
    const { container } = render(WaveButton, props);
    const btn = container.querySelector('button');
    expect(btn.classList.contains('btn-circle')).toBe(true);
    expect(btn.textContent).not.toContain('Winken');
  });

  it('renders a labelled pill when given a label', () => {
    const { container } = render(WaveButton, { ...props, label: 'Winken' });
    const btn = container.querySelector('button');
    expect(btn.classList.contains('btn-circle')).toBe(false);
    expect(btn.textContent).toContain('Winken');
  });
});
