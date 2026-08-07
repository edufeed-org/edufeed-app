/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import ConcordUnreadDot from '$lib/components/shared/ConcordUnreadDot.svelte';

describe('ConcordUnreadDot', () => {
  it('renders nothing when read', () => {
    const { container } = render(ConcordUnreadDot, { unread: false, mentioned: false });
    expect(container.querySelector('[data-testid="concord-unread-dot"]')).toBeNull();
    expect(container.querySelector('[data-testid="concord-mention-pill"]')).toBeNull();
  });

  it('renders the neutral dot for plain unread', () => {
    const { container } = render(ConcordUnreadDot, { unread: true, mentioned: false });
    expect(container.querySelector('[data-testid="concord-unread-dot"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="concord-mention-pill"]')).toBeNull();
  });

  it('renders the accent @ pill when mentioned (wins over the dot)', () => {
    const { container } = render(ConcordUnreadDot, { unread: true, mentioned: true });
    expect(container.querySelector('[data-testid="concord-mention-pill"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="concord-unread-dot"]')).toBeNull();
  });
});
