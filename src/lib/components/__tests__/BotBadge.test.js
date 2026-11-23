/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';

vi.mock('$lib/paraglide/messages', () => ({
  profile_bot_badge: () => 'Bot',
  profile_bot_badge_title: () => 'Automatisierter Account'
}));

import BotBadge from '$lib/components/shared/BotBadge.svelte';

describe('BotBadge (NIP-24 bot: true)', () => {
  it('shows for a profile that declares bot: true', () => {
    const { getByTestId } = render(BotBadge, {
      props: { profile: { name: 'Antiope', bot: true } }
    });
    expect(getByTestId('bot-badge').textContent).toBe('Bot');
    expect(getByTestId('bot-badge').title).toBe('Automatisierter Account');
  });

  it('stays away for people, a missing profile and a non-boolean value', () => {
    for (const profile of [{ name: 'A' }, { bot: false }, { bot: 'true' }, null, undefined]) {
      const { queryByTestId, unmount } = render(BotBadge, { props: { profile } });
      expect(queryByTestId('bot-badge')).toBeNull();
      unmount();
    }
  });
});
