/** @vitest-environment jsdom */
// The key-login dialog's signup button used to read a hardcoded English
// "Sign Up!" in the German UI (mobile UX round, Dirk).
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

const openModal = vi.hoisted(() => vi.fn());
vi.mock('$lib/stores/modal.svelte.js', () => ({ modalStore: { openModal } }));
vi.mock('$lib/paraglide/messages', () => ({ auth_signup_button: () => 'Konto erstellen' }));

const { default: SignupButton } = await import('../shared/SignupButton.svelte');

describe('SignupButton', () => {
  it('is localized and opens signup', async () => {
    const { getByRole, container } = render(SignupButton);
    const button = getByRole('button');
    expect(button.textContent?.trim()).toBe('Konto erstellen');
    expect(container.textContent).not.toContain('Sign Up');
    await fireEvent.click(button);
    expect(openModal).toHaveBeenCalledWith('signup');
  });
});
