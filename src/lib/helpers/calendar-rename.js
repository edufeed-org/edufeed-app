/**
 * Build the updated event template for renaming a NIP-52 calendar
 * (kind 31924, "a 31924 list" per NIP-52).
 *
 * Starts from the calendar's own event and only replaces the `title` tag
 * (keeping `d`) and the content, so everything else the calendar already
 * carries survives the rename: relay hints on `a` tags
 * (`['a', coord, 'wss://hint']`) and any foreign tag another client added
 * (`image`, `t`, `summary`, ...).
 *
 * @see https://github.com/edufeed-org/edufeed-app/issues — "Calendar rename
 *      drops relay hints and foreign tags of the 31924 list"
 */

import { setTitle } from 'applesauce-common/operations/calendar';

/**
 * @param {ReturnType<typeof import('./event-factory.js').createAppEventFactory>} eventFactory
 * @param {import('nostr-tools').Event} originalEvent - the calendar's current kind-31924 event
 * @param {string} title - new title
 * @param {string} description - new description (becomes the event content)
 * @returns {Promise<any>} unsigned event template
 */
export async function buildCalendarRenameTemplate(eventFactory, originalEvent, title, description) {
  return await eventFactory.modify(originalEvent, setTitle(title), (draft) => ({
    ...draft,
    content: description
  }));
}
