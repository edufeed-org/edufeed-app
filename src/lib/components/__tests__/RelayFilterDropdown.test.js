/**
 * RelayFilterDropdown Component Tests
 *
 * Tests the redesigned relay filter dropdown with label-above layout,
 * regular sizing, URL shortening, and settings link.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import RelayFilterDropdown from '../feed/RelayFilterDropdown.svelte';

// Mock paraglide messages
vi.mock('$lib/paraglide/messages', () => ({
  discover_relay_label: () => 'Source:',
  discover_relay_all: () => 'All',
  discover_relay_edit: () => 'Edit',
  discover_relay_edit_title: () => 'Edit source configuration in settings'
}));

const relays = ['wss://relay.example.com/', 'wss://nostr.land/', 'wss://edu.relay.io/'];

describe('RelayFilterDropdown', () => {
  it('renders with a label element above the select', () => {
    const { container } = render(RelayFilterDropdown, {
      props: {
        relays,
        value: null,
        onchange: vi.fn(),
        settingsCategory: 'educational'
      }
    });

    const label = container.querySelector('label');
    expect(label).toBeTruthy();

    // Should use form-control wrapper (label above, not inline)
    const wrapper = container.querySelector('.form-control');
    expect(wrapper).toBeTruthy();
  });

  it('renders a regular-sized select (not select-sm)', () => {
    const { container } = render(RelayFilterDropdown, {
      props: {
        relays,
        value: null,
        onchange: vi.fn(),
        settingsCategory: 'educational'
      }
    });

    const select = /** @type {HTMLSelectElement} */ (container.querySelector('select'));
    expect(select).toBeTruthy();
    expect(select.classList.contains('select-bordered')).toBe(true);
    // Should NOT have select-sm class
    expect(select.classList.contains('select-sm')).toBe(false);
  });

  it('renders "All" as default option', () => {
    const { container } = render(RelayFilterDropdown, {
      props: {
        relays,
        value: null,
        onchange: vi.fn(),
        settingsCategory: 'educational'
      }
    });

    const options = container.querySelectorAll('option');
    expect(options[0].textContent).toContain('All');
    expect(options[0].value).toBe('');
  });

  it('renders relay options with shortened URLs (no wss:// prefix)', () => {
    const { container } = render(RelayFilterDropdown, {
      props: {
        relays,
        value: null,
        onchange: vi.fn(),
        settingsCategory: 'educational'
      }
    });

    const options = Array.from(container.querySelectorAll('option'));
    // Skip the first "All" option
    const relayOptions = options.slice(1);
    expect(relayOptions.length).toBe(3);
    expect(relayOptions[0].textContent.trim()).toBe('relay.example.com');
    expect(relayOptions[1].textContent.trim()).toBe('nostr.land');
    expect(relayOptions[2].textContent.trim()).toBe('edu.relay.io');
  });

  it('calls onchange with null when "All" is selected', async () => {
    const onchange = vi.fn();
    const { container } = render(RelayFilterDropdown, {
      props: {
        relays,
        value: 'wss://relay.example.com/',
        onchange,
        settingsCategory: 'educational'
      }
    });

    const select = /** @type {HTMLSelectElement} */ (container.querySelector('select'));
    await fireEvent.change(select, { target: { value: '' } });
    expect(onchange).toHaveBeenCalledWith(null);
  });

  it('calls onchange with relay URL when specific relay selected', async () => {
    const onchange = vi.fn();
    const { container } = render(RelayFilterDropdown, {
      props: {
        relays,
        value: null,
        onchange,
        settingsCategory: 'educational'
      }
    });

    const select = /** @type {HTMLSelectElement} */ (container.querySelector('select'));
    await fireEvent.change(select, { target: { value: 'wss://nostr.land/' } });
    expect(onchange).toHaveBeenCalledWith('wss://nostr.land/');
  });

  it('shows a link to settings for editing relays', () => {
    const { container } = render(RelayFilterDropdown, {
      props: {
        relays,
        value: null,
        onchange: vi.fn(),
        settingsCategory: 'educational'
      }
    });

    const link = container.querySelector('a[href="/settings"]');
    expect(link).toBeTruthy();
  });
});
