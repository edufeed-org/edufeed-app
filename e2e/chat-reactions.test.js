/**
 * E2E tests for reactions on community chat messages (kind 9 + NIP-25 kind 7).
 *
 * Verifies the chat-specific wiring of ReactionBar: the add-reaction button is
 * hidden until the message is hovered (addButtonOnHover), and an authenticated
 * user can react to a chat message and see the reaction appear.
 */
import { expect } from '@playwright/test';
import { test } from './fixtures.js';
import { TEST_COMMUNITY } from './test-data.js';
import { waitForCommunitySidebar } from './test-utils.js';

const COMMUNITY_URL = `/c/${TEST_COMMUNITY.npub}`;

/**
 * Navigate to community page and open the Chat tab.
 * @param {import('@playwright/test').Page} page
 */
async function navigateToChatTab(page) {
  await page.goto(COMMUNITY_URL);
  await waitForCommunitySidebar(page);
  await page.waitForTimeout(500);

  await page.locator('nav.menu button', { hasText: 'Chat' }).click();
  await expect(page.locator('.chat-bubble').first()).toBeVisible({ timeout: 30_000 });
}

/**
 * Send a chat message and return a locator scoped to its .chat element.
 * @param {import('@playwright/test').Page} page
 * @param {string} content
 */
async function sendMessage(page, content) {
  const input = page.locator('form input[type="text"]').first();
  await input.fill(content);
  await input.press('Enter');
  await expect(input).toHaveValue('', { timeout: 5000 });

  // The community layout double-mounts children for responsive variants, so the
  // message renders more than once — scope to the first visible instance.
  const chatMessage = page.locator('.chat').filter({ hasText: content }).first();
  await expect(chatMessage).toBeVisible({ timeout: 10_000 });
  return chatMessage;
}

test.describe('Chat Reactions - Authenticated', () => {
  test('add-reaction button is hidden until the message is hovered', async ({
    authenticatedPage: page
  }) => {
    await navigateToChatTab(page);
    const chatMessage = await sendMessage(page, `Hover reveal ${Date.now()}`);

    const addBtn = chatMessage.locator('[data-testid="add-reaction-btn"]');

    // Hidden (display:none) until the message group is hovered.
    await expect(addBtn).toBeHidden();

    await chatMessage.hover();
    await expect(addBtn).toBeVisible({ timeout: 5000 });
  });

  test('authenticated user can react to a chat message', async ({ authenticatedPage: page }) => {
    await navigateToChatTab(page);
    const chatMessage = await sendMessage(page, `React to me ${Date.now()}`);

    await chatMessage.hover();
    await chatMessage.locator('[data-testid="add-reaction-btn"]').click();

    await expect(page.locator('[data-testid="reaction-picker"]')).toBeVisible();
    await page.locator('[data-testid="emoji-option"][data-emoji="😀"]').first().click();

    await expect(async () => {
      await expect(
        chatMessage.locator('[data-testid="reaction-button"][data-emoji="😀"]')
      ).toBeVisible();
    }).toPass({ timeout: 10_000 });
  });
});
