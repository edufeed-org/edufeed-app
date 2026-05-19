/**
 * EnrichmentStatusBanner — visible signal that the LLM enrichment pass is
 * pending / done / failed. Driven by a single `status` prop.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import EnrichmentStatusBanner from '../EnrichmentStatusBanner.svelte';

describe('EnrichmentStatusBanner', () => {
  it('renders nothing when status is "idle"', () => {
    const { container } = render(EnrichmentStatusBanner, { props: { status: 'idle' } });
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('.alert')).toBeNull();
  });

  it('renders an info alert with a spinner while pending', () => {
    const { container } = render(EnrichmentStatusBanner, { props: { status: 'pending' } });
    const alert = container.querySelector('[role="status"]');
    expect(alert).not.toBeNull();
    expect(alert?.className).toContain('alert-info');
    expect(container.querySelector('.loading')).not.toBeNull();
    expect(alert?.textContent).toMatch(/KI/i); // contains the user-facing copy
  });

  it('renders a success alert when status is "success"', () => {
    const { container } = render(EnrichmentStatusBanner, { props: { status: 'success' } });
    const alert = container.querySelector('[role="status"]');
    expect(alert?.className).toContain('alert-success');
    // No spinner on success
    expect(container.querySelector('.loading')).toBeNull();
  });

  it('renders a warning alert when status is "error"', () => {
    const { container } = render(EnrichmentStatusBanner, { props: { status: 'error' } });
    const alert = container.querySelector('[role="status"]');
    expect(alert?.className).toContain('alert-warning');
  });

  it('shows the overloaded-specific copy when errorCode is "overloaded"', () => {
    const { container } = render(EnrichmentStatusBanner, {
      props: { status: 'error', errorCode: 'overloaded' }
    });
    const alert = container.querySelector('[role="status"]');
    expect(alert?.textContent).toMatch(/überlastet/i);
  });

  it('shows the generic error copy when errorCode is unset', () => {
    const { container } = render(EnrichmentStatusBanner, { props: { status: 'error' } });
    const alert = container.querySelector('[role="status"]');
    expect(alert?.textContent).toMatch(/manuell ausfüllen/i);
    expect(alert?.textContent).not.toMatch(/überlastet/i);
  });

  it('renders an info chip when status is "skipped-amb"', () => {
    const { container } = render(EnrichmentStatusBanner, { props: { status: 'skipped-amb' } });
    const alert = container.querySelector('[role="status"]');
    expect(alert).not.toBeNull();
    // AMB short-circuit message — distinguishable from pending
    expect(alert?.textContent).toMatch(/AMB/);
    expect(container.querySelector('.loading')).toBeNull();
  });

  it('shows a dismiss button on success / error / skipped-amb and calls ondismiss when clicked', async () => {
    const ondismiss = vi.fn();
    const { container } = render(EnrichmentStatusBanner, {
      props: { status: 'success', ondismiss }
    });
    const btn = /** @type {HTMLButtonElement} */ (container.querySelector('button'));
    expect(btn).not.toBeNull();
    await fireEvent.click(btn);
    expect(ondismiss).toHaveBeenCalledTimes(1);
  });

  it('does not show a dismiss button while pending (user cannot opt out mid-call)', () => {
    const { container } = render(EnrichmentStatusBanner, {
      props: { status: 'pending', ondismiss: vi.fn() }
    });
    expect(container.querySelector('button')).toBeNull();
  });
});
