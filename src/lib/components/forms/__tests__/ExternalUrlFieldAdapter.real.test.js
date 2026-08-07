/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import FieldsRenderer from '$lib/components/forms/FieldsRenderer.svelte';
import * as m from '$lib/paraglide/messages';

// NO vi.mock here: this renders the adapter through FieldsRenderer with the
// REAL ExternalUrlInput. It is the guard that would have caught the double-label
// bug — the stub-based composition test masked it because the stub couldn't
// reproduce the real component's old `label || m.external_url_label()` fallback.

describe('ExternalUrlFieldAdapter (real ExternalUrlInput)', () => {
  it('renders field.label once and does NOT render the inner i18n fallback label', () => {
    // Distinct from the i18n fallback so the two are independently detectable.
    const field = { id: 'refs', type: 'external-urls', label: 'My reference field', options: {} };
    render(FieldsRenderer, {
      fields: [field],
      values: { refs: [] },
      errors: {},
      onchange: vi.fn()
    });
    // FieldsRenderer renders the field label exactly once.
    expect(screen.getAllByText('My reference field')).toHaveLength(1);
    // The adapter passes label="" — with the old `label || m.external_url_label()`
    // fallback the inner component rendered this string as a SECOND label. Post-fix
    // (plain `{#if label}`) it must be absent.
    expect(screen.queryByText(m.external_url_label())).toBeNull();
  });
});
