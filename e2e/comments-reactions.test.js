import { test, expect, navigateToCalendarEvent } from './fixtures.js';
import { test as baseTest, expect as baseExpect } from '@playwright/test';
import { TEST_NADDRS, TEST_COUNTS } from './test-data.js';
import { waitForContent, waitForComments, setupErrorCapture } from './test-utils.js';

/**
 * Helper to navigate to calendar event for unauthenticated tests
 * @param {import('@playwright/test').Page} page
 * @param {string} naddr
 */
async function navigateToEvent(page, naddr) {
  await page.goto('/discover');
  await waitForContent(page);

  await page.evaluate((url) => {
    const link = document.createElement('a');
    link.href = url;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, `/calendar/event/${naddr}`);

  // Wait for comment section to load (indicates event page is ready)
  await waitForComments(page);
}

// ============================================================================
// COMMENTS - Unauthenticated Tests
// ============================================================================

baseTest.describe('Comments - Unauthenticated', () => {
  baseTest('comment section renders with count badge', async ({ page }) => {
    await navigateToEvent(page, TEST_NADDRS.calendarDate);

    // Scroll to comments section
    const commentSection = page.locator('[data-testid="comment-list"]');
    await baseExpect(commentSection).toBeVisible({ timeout: 15_000 });
    await commentSection.scrollIntoViewIfNeeded();

    // Wait for comment count badge to appear (indicates comments are being counted)
    await baseExpect(async () => {
      const badge = page.locator('[data-testid="comment-count"]');
      await baseExpect(badge).toBeVisible();
      // Verify count is > 0
      const text = await badge.textContent();
      baseExpect(parseInt(text || '0')).toBeGreaterThan(0);
    }).toPass({ timeout: 20_000 });
  });

  baseTest('displays individual comment elements', async ({ page }) => {
    await navigateToEvent(page, TEST_NADDRS.calendarDate);

    const commentSection = page.locator('[data-testid="comment-list"]');
    await baseExpect(commentSection).toBeVisible({ timeout: 15_000 });

    // Verify comments are displayed
    await baseExpect(async () => {
      const comments = page.locator('[data-testid="comment"]');
      const count = await comments.count();
      baseExpect(count).toBeGreaterThanOrEqual(TEST_COUNTS.commentsOnCalendarEvent);
    }).toPass({ timeout: 25_000 });

    // Verify comment content is visible (matches seeded test data)
    await baseExpect(page.getByText('This is test comment 1 on the calendar event.')).toBeVisible({
      timeout: 10_000
    });
  });

  baseTest('displays nested reply with indentation', async ({ page }) => {
    await navigateToEvent(page, TEST_NADDRS.calendarDate);

    // Wait for comments to load
    await baseExpect(page.locator('[data-testid="comment"]').first()).toBeVisible({
      timeout: 15_000
    });

    // Look for the reply text (matches seeded test data)
    await baseExpect(async () => {
      await baseExpect(page.getByText('This is a reply to the first comment.')).toBeVisible();
    }).toPass({ timeout: 15_000 });
  });

  baseTest('shows login prompt for unauthenticated users', async ({ page }) => {
    await navigateToEvent(page, TEST_NADDRS.calendarDate);

    await baseExpect(async () => {
      const loginPrompt = page.locator('[data-testid="comment-login-prompt"]');
      await baseExpect(loginPrompt).toBeVisible();

      // Input should not be visible for unauthenticated users
      const input = page.locator('[data-testid="comment-input"]');
      await baseExpect(input).not.toBeVisible();
    }).toPass({ timeout: 15_000 });
  });

  baseTest('shows empty state when event has no comments', async ({ page }) => {
    // Navigate to time-event-0 which has no seeded comments (only date-event-0 has comments)
    await navigateToEvent(page, TEST_NADDRS.calendarTime);

    const commentSection = page.locator('[data-testid="comment-list"]');
    await baseExpect(commentSection).toBeVisible({ timeout: 15_000 });

    // Should NOT show spinner forever - should transition to empty state within reasonable time
    await baseExpect(async () => {
      // Verify loading spinner is gone
      const spinner = commentSection.locator('.loading');
      await baseExpect(spinner).not.toBeVisible();

      // Verify the "No comments" empty state is shown (not a badge, not a spinner)
      const badge = commentSection.locator('[data-testid="comment-count"]');
      await baseExpect(badge).not.toBeVisible();
    }).toPass({ timeout: 10_000 });
  });
});

// ============================================================================
// COMMENTS - Authenticated Tests
// ============================================================================

test.describe('Comments - Authenticated', () => {
  test('comment input is visible for logged in users', async ({ authenticatedPage: page }) => {
    await navigateToCalendarEvent(page, TEST_NADDRS.calendarDate);

    // Wait for comment input to appear (indicates user is logged in)
    const input = page.locator('[data-testid="comment-input"]');
    await expect(input).toBeVisible({ timeout: 15_000 });

    // Verify submit button is present
    const submitBtn = page.locator('[data-testid="comment-submit-btn"]');
    await expect(submitBtn).toBeVisible();
  });

  test('authenticated user can post and see comment', async ({ authenticatedPage: page }) => {
    await navigateToCalendarEvent(page, TEST_NADDRS.calendarDate);

    const input = page.locator('[data-testid="comment-input"]');
    await expect(input).toBeVisible({ timeout: 15_000 });

    const testComment = `E2E test comment ${Date.now()}`;
    await input.fill(testComment);
    await page.locator('[data-testid="comment-submit-btn"]').click();

    // Verify comment appears (optimistic update)
    await expect(async () => {
      await expect(page.getByText(testComment)).toBeVisible();
    }).toPass({ timeout: 10_000 });
  });

  test('authenticated user can reply to a comment', async ({ authenticatedPage: page }) => {
    await navigateToCalendarEvent(page, TEST_NADDRS.calendarDate);

    await expect(page.locator('[data-testid="comment"]').first()).toBeVisible({ timeout: 15_000 });

    const firstComment = page.locator('[data-testid="comment"]').first();
    await firstComment.locator('[data-testid="comment-reply-btn"]').click();

    const replyText = `E2E reply ${Date.now()}`;
    const replyInput = firstComment.locator('[data-testid="comment-input"]');
    await expect(replyInput).toBeVisible();
    await replyInput.fill(replyText);

    await firstComment.locator('[data-testid="comment-submit-btn"]').click();

    await expect(async () => {
      await expect(page.getByText(replyText)).toBeVisible();
    }).toPass({ timeout: 10_000 });
  });

  test('authenticated user can delete own comment', async ({ authenticatedPage: page }) => {
    await navigateToCalendarEvent(page, TEST_NADDRS.calendarDate);

    const input = page.locator('[data-testid="comment-input"]');
    await expect(input).toBeVisible({ timeout: 15_000 });

    const testComment = `Delete me ${Date.now()}`;
    await input.fill(testComment);
    await page.locator('[data-testid="comment-submit-btn"]').click();

    await expect(page.getByText(testComment)).toBeVisible({ timeout: 10_000 });

    const myComment = page.locator('[data-testid="comment"]').filter({ hasText: testComment });

    await myComment.getByRole('button', { name: 'Event menu' }).click();
    await myComment.getByRole('button', { name: 'Delete' }).click();
    await page.locator('.modal-open .btn-error').click();

    await expect(page.getByText(testComment)).not.toBeVisible({ timeout: 10_000 });
  });
});

// ============================================================================
// REACTIONS - Unauthenticated Tests
// ============================================================================

baseTest.describe('Reactions - Unauthenticated', () => {
  baseTest('displays existing reactions on calendar event', async ({ page }) => {
    await navigateToEvent(page, TEST_NADDRS.calendarDate);

    // Target the first reaction bar (event-level, not comment reaction bars)
    const eventReactionBar = page.locator('[data-testid="reaction-bar"]').first();
    await baseExpect(async () => {
      await baseExpect(eventReactionBar).toBeVisible();
    }).toPass({ timeout: 15_000 });

    // Check for seeded reactions on the event (use first() for each as comments may also have reactions)
    await baseExpect(async () => {
      await baseExpect(
        eventReactionBar.locator('[data-testid="reaction-button"][data-emoji="❤️"]')
      ).toBeVisible();
      await baseExpect(
        eventReactionBar.locator('[data-testid="reaction-button"][data-emoji="👍"]')
      ).toBeVisible();
      await baseExpect(
        eventReactionBar.locator('[data-testid="reaction-button"][data-emoji="🎉"]')
      ).toBeVisible();
    }).toPass({ timeout: 15_000 });
  });

  baseTest('reaction buttons show counts', async ({ page }) => {
    await navigateToEvent(page, TEST_NADDRS.calendarDate);

    // Target the first reaction bar (event-level)
    const eventReactionBar = page.locator('[data-testid="reaction-bar"]').first();

    await baseExpect(async () => {
      const heartReaction = eventReactionBar.locator(
        '[data-testid="reaction-button"][data-emoji="❤️"]'
      );
      await baseExpect(heartReaction).toBeVisible();

      const count = await heartReaction.getAttribute('data-count');
      baseExpect(parseInt(count || '0')).toBeGreaterThanOrEqual(1);
    }).toPass({ timeout: 15_000 });
  });

  baseTest('unauthenticated user sees disabled add reaction button', async ({ page }) => {
    await navigateToEvent(page, TEST_NADDRS.calendarDate);

    // Target the first reaction bar (event-level)
    const eventReactionBar = page.locator('[data-testid="reaction-bar"]').first();

    await baseExpect(async () => {
      const addBtn = eventReactionBar.locator('[data-testid="add-reaction-btn"]');
      await baseExpect(addBtn).toBeVisible();
      await baseExpect(addBtn).toBeDisabled();
    }).toPass({ timeout: 15_000 });
  });
});

// ============================================================================
// REACTIONS - Authenticated Tests
// ============================================================================

test.describe('Reactions - Authenticated', () => {
  test('authenticated user can add a reaction', async ({ authenticatedPage: page }) => {
    await navigateToCalendarEvent(page, TEST_NADDRS.calendarDate);

    // Target the first reaction bar (event-level, not comment reaction bars)
    const eventReactionBar = page.locator('[data-testid="reaction-bar"]').first();

    // Wait for reaction bar
    await expect(eventReactionBar).toBeVisible({ timeout: 15_000 });

    // Click add reaction button
    await eventReactionBar.locator('[data-testid="add-reaction-btn"]').click();

    // Wait for picker
    await expect(page.locator('[data-testid="reaction-picker"]')).toBeVisible();

    // Select an emoji (use one that's visible in the Smileys category and not seeded)
    await page.locator('[data-testid="reaction-option"][data-emoji="😀"]').first().click();

    // Verify reaction appears on the event's reaction bar
    await expect(async () => {
      await expect(
        eventReactionBar.locator('[data-testid="reaction-button"][data-emoji="😀"]')
      ).toBeVisible();
    }).toPass({ timeout: 10_000 });
  });

  test('authenticated user can remove own reaction', async ({ authenticatedPage: page }) => {
    await navigateToCalendarEvent(page, TEST_NADDRS.calendarDate);

    // Target the first reaction bar (event-level)
    const eventReactionBar = page.locator('[data-testid="reaction-bar"]').first();

    // Add a reaction first using a visible emoji (not seeded)
    await expect(eventReactionBar.locator('[data-testid="add-reaction-btn"]')).toBeVisible({
      timeout: 15_000
    });
    await eventReactionBar.locator('[data-testid="add-reaction-btn"]').click();
    await page.locator('[data-testid="reaction-option"][data-emoji="😁"]').first().click();

    // Wait for it to appear on the event's reaction bar
    const myReaction = eventReactionBar.locator('[data-testid="reaction-button"][data-emoji="😁"]');
    await expect(myReaction).toBeVisible({ timeout: 10_000 });

    // Verify it shows user-reacted = true after adding
    await expect(async () => {
      const userReacted = await myReaction.getAttribute('data-user-reacted');
      expect(userReacted).toBe('true');
    }).toPass({ timeout: 10_000 });

    // Click to toggle off (remove)
    await myReaction.click();

    // Wait a bit for the unreact to process
    await page.waitForTimeout(2000);

    // Verify the reaction button is gone or user-reacted is false
    await expect(async () => {
      const isVisible = await myReaction.isVisible();
      if (!isVisible) return; // Reaction removed entirely - success
      const userReacted = await myReaction.getAttribute('data-user-reacted');
      expect(userReacted).toBe('false');
    }).toPass({ timeout: 10_000 });
  });

  test('reaction count updates after adding', async ({ authenticatedPage: page }) => {
    await navigateToCalendarEvent(page, TEST_NADDRS.calendarDate);

    // Target the first reaction bar (event-level)
    const eventReactionBar = page.locator('[data-testid="reaction-bar"]').first();
    await expect(eventReactionBar).toBeVisible({ timeout: 15_000 });

    // Get initial count of heart reactions on the event
    const heartBtn = eventReactionBar.locator('[data-testid="reaction-button"][data-emoji="❤️"]');
    await expect(heartBtn).toBeVisible();
    const initialCount = parseInt((await heartBtn.getAttribute('data-count')) || '0');

    // Click heart to add our reaction
    await heartBtn.click();

    // Verify count increased
    await expect(async () => {
      const newCount = parseInt((await heartBtn.getAttribute('data-count')) || '0');
      expect(newCount).toBe(initialCount + 1);
    }).toPass({ timeout: 10_000 });
  });
});

// ============================================================================
// SPOT CHECK - AMB Resources
// ============================================================================

baseTest.describe('Reactions on AMB Resources (Spot Check)', () => {
  baseTest('AMB resource page shows reaction bar', async ({ page }) => {
    // Navigate to AMB resource
    await page.goto('/discover');
    await waitForContent(page);

    await page.evaluate((naddr) => {
      const link = document.createElement('a');
      link.href = `/${naddr}`;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
    }, TEST_NADDRS.amb);

    // Verify reaction bar is present
    await baseExpect(page.locator('[data-testid="reaction-bar"]')).toBeVisible({ timeout: 15_000 });
  });
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

test.describe('No JavaScript Errors', () => {
  test('no critical errors during comment interactions', async ({ authenticatedPage: page }) => {
    const errorCapture = setupErrorCapture(page);

    await navigateToCalendarEvent(page, TEST_NADDRS.calendarDate);

    // Interact with comments
    const input = page.locator('[data-testid="comment-input"]');
    await expect(input).toBeVisible({ timeout: 15_000 });
    await input.fill('Error check comment');
    await page.locator('[data-testid="comment-submit-btn"]').click();

    // Wait for comment to appear
    await expect(page.getByText('Error check comment')).toBeVisible({ timeout: 10_000 });

    errorCapture.assertNoCriticalErrors();
  });

  test('no critical errors during reaction interactions', async ({ authenticatedPage: page }) => {
    const errorCapture = setupErrorCapture(page);

    await navigateToCalendarEvent(page, TEST_NADDRS.calendarDate);

    // Target the first reaction bar (event-level)
    const eventReactionBar = page.locator('[data-testid="reaction-bar"]').first();

    // Add a reaction
    await expect(eventReactionBar.locator('[data-testid="add-reaction-btn"]')).toBeVisible({
      timeout: 15_000
    });
    await eventReactionBar.locator('[data-testid="add-reaction-btn"]').click();
    await page.locator('[data-testid="reaction-option"][data-emoji="⭐"]').first().click();

    // Wait for reaction to appear
    await expect(
      eventReactionBar.locator('[data-testid="reaction-button"][data-emoji="⭐"]')
    ).toBeVisible({ timeout: 10_000 });

    errorCapture.assertNoCriticalErrors();
  });
});
