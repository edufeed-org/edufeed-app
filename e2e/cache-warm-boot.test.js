import { test, expect } from '@playwright/test';

/**
 * Locks in the user-visible outcome of the persistent event cache:
 * after a first visit populates IDB, a reload with WebSockets blocked
 * still renders cached calendar content.
 *
 * We detect "rendered from cache" by serving the second page load with
 * WebSocket upgrades aborted: if calendar content still renders, it
 * came from IDB rather than the relays.
 */
test('calendar page renders from IDB on warm reload', async ({ page, context }) => {
  // First visit — populate cache. Wait for at least one calendar event
  // card to confirm relay traffic flowed and events landed in the
  // EventStore (which mirrors them into IDB via the cache write filter).
  await page.goto('/calendar');
  await expect(page.locator('[data-testid="calendar-event-card"]').first()).toBeVisible({
    timeout: 15_000
  });

  // Block all WebSocket upgrades, then reload. Any calendar content that
  // still appears must come from the persistent cache, since no relay
  // connection can succeed.
  await context.route('wss://**', (route) => route.abort());
  await context.route('ws://**', (route) => route.abort());
  await page.reload();

  await expect(page.locator('[data-testid="calendar-event-card"]').first()).toBeVisible({
    timeout: 5_000
  });
});
