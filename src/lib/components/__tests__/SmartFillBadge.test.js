/**
 * SmartFillBadge component tests.
 *
 * Renders a small inline badge ("Smart fill ✨" or "AMB") for a wizard
 * field that was prefilled from /api/enrich or AMB JSON-LD. Optionally
 * surfaces an evidence quote on hover and a ✗ button to clear the field.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import SmartFillBadge from '../educational/SmartFillBadge.svelte';

describe('SmartFillBadge', () => {
  it('renders the Smart-fill label for llm-enriched provenance', () => {
    const { getByText } = render(SmartFillBadge, {
      props: { provenance: { source: 'llm-enriched' } }
    });
    // Sparkle plus a label so screen-readers and visual users both get it.
    expect(getByText(/Smart fill/i)).toBeTruthy();
  });

  it('renders the AMB label for amb-jsonld provenance', () => {
    const { getByText } = render(SmartFillBadge, {
      props: { provenance: { source: 'amb-jsonld' } }
    });
    expect(getByText(/AMB/)).toBeTruthy();
  });

  it('exposes the evidence quote as a title attribute when provided', () => {
    const { container } = render(SmartFillBadge, {
      props: {
        provenance: { source: 'llm-enriched', evidence: 'A worksheet for grade 5 math.' }
      }
    });
    const root = /** @type {HTMLElement} */ (container.firstElementChild);
    expect(root?.getAttribute('title')).toContain('A worksheet for grade 5 math.');
  });

  it('omits a ✗ button when no onclear handler is supplied', () => {
    const { queryByRole } = render(SmartFillBadge, {
      props: { provenance: { source: 'llm-enriched' } }
    });
    expect(queryByRole('button')).toBeNull();
  });

  it('fires onclear when the ✗ button is clicked', async () => {
    const onclear = vi.fn();
    const { getByRole } = render(SmartFillBadge, {
      props: { provenance: { source: 'llm-enriched' }, onclear }
    });
    await fireEvent.click(getByRole('button'));
    expect(onclear).toHaveBeenCalledOnce();
  });

  it('renders nothing when provenance is null/undefined', () => {
    const { container } = render(SmartFillBadge, {
      props: { provenance: null }
    });
    expect(container.firstElementChild).toBeNull();
  });
});
