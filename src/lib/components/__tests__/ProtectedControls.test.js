/** @vitest-environment jsdom */
/**
 * NIP-70 protected events: the composer toggle and the lock badge
 * (issue 10fc9681).
 */
import { describe, it, expect } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';
import ProtectedToggle from '$lib/components/shared/ProtectedToggle.svelte';
import ProtectedBadge from '$lib/components/shared/ProtectedBadge.svelte';
import * as m from '$lib/paraglide/messages';

describe('ProtectedToggle', () => {
  it('is off by default and explains itself, including the relay-support caveat', async () => {
    render(ProtectedToggle, { props: {} });
    const toggle = /** @type {HTMLInputElement} */ (screen.getByTestId('protected-toggle'));
    expect(toggle.checked).toBe(false);

    // The explanation is the toggle's accessible description …
    const hint = screen.getByTestId('protected-hint');
    expect(toggle.getAttribute('aria-describedby')).toBe(hint.id);
    expect(hint.textContent?.trim()).toBe(m.protected_toggle_hint());
    // … hidden visually until the info button is tapped (touch has no hover).
    expect(hint.className).toContain('sr-only');
    await fireEvent.click(screen.getByTestId('protected-info'));
    expect(hint.className).not.toContain('sr-only');
  });

  it('the hint mentions that not every relay supports it (en + de)', () => {
    // Guard against the caveat being edited away in one language.
    expect(m.protected_toggle_hint({}, { locale: 'en' })).toMatch(/not all relays/i);
    expect(m.protected_toggle_hint({}, { locale: 'de' })).toMatch(/nicht alle relays/i);
  });
});

describe('ProtectedBadge', () => {
  it('shows a lock for a protected event', () => {
    render(ProtectedBadge, { props: { event: { tags: [['-']] } } });
    const badge = screen.getByTestId('protected-badge');
    expect(badge.textContent).toContain(m.protected_badge_label());
  });

  it('renders nothing for an ordinary event', () => {
    render(ProtectedBadge, { props: { event: { tags: [['t', 'x']] } } });
    expect(screen.queryByTestId('protected-badge')).toBeNull();
  });

  it('tolerates a missing event', () => {
    render(ProtectedBadge, { props: { event: null } });
    expect(screen.queryByTestId('protected-badge')).toBeNull();
  });
});
