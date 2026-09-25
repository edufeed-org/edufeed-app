/**
 * Root layout static-import budget.
 *
 * Everything `src/routes/+layout.svelte` imports statically is preloaded on
 * every first visit (SvelteKit emits modulepreload hints for the route's whole
 * static graph). Heavy chrome that only some surfaces need must therefore be
 * loaded via `lazyComponent(() => import(...))` instead — see the issue
 * "Landing page statically pulls 290 chunks / 2.7MB of JS through the root
 * layout".
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import layoutSource from '../../routes/+layout.svelte?raw';
import navbarSource from '../components/Navbar.svelte?raw';
import groupChatSource from '../components/groups/GroupChat.svelte?raw';

/**
 * @param {string} source
 * @returns {string[]}
 */
function staticImportsOf(source) {
  return source
    .split('\n')
    .filter((line) => /^\s*import\s/.test(line))
    .flatMap((line) => {
      const spec =
        line.match(/from\s+['"]([^'"]+)['"]/)?.[1] ?? line.match(/['"]([^'"]+)['"]/)?.[1];
      return spec ? [spec] : [];
    });
}

const staticImports = staticImportsOf(layoutSource);

describe('root layout static imports', () => {
  it.each([
    'assistant/TermiAssistant.svelte',
    'community/layout/CommunitySidebar.svelte',
    'community/layout/ContentNavSidebar.svelte'
  ])('does not statically import %s', (needle) => {
    expect(staticImports.filter((s) => s.endsWith(needle))).toEqual([]);
  });

  // Navbar is itself a static import of the layout; its dropdown bodies
  // (inbox, account menu, mobile menu) only matter once opened.
  it.each([
    'inbox/InboxDropdown.svelte',
    'shared/AccountMenuSection.svelte',
    'shared/MobileNavMenu.svelte'
  ])('Navbar does not statically import %s', (needle) => {
    expect(staticImportsOf(navbarSource).filter((s) => s.endsWith(needle))).toEqual([]);
  });

  // GroupChat sits in the /groups and /c route graphs; the in-call stage
  // (and with it livekit-client, ~300KB) must only load once a channel
  // actually starts a call — lazyComponent, never a static import.
  it.each(['groups/call/GroupCallStage.svelte', 'services/livekit-connection.svelte.js'])(
    'GroupChat does not statically import %s',
    (needle) => {
      expect(staticImportsOf(groupChatSource).filter((s) => s.endsWith(needle))).toEqual([]);
    }
  );

  // The one-off kind 30382 -> kind 30000 community migration bridge was removed;
  // nothing in the root layout should wake it (statically or via import()).
  it('does not reference the retired community migration check', () => {
    expect(layoutSource).not.toMatch(/migration-check-service|checkCommunityMigration/);
  });
});
