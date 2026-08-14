// Display labels for a community's content-section names. Section names in a
// kind 10222 are protocol data ('Calendar', 'Social Bookmarks', …) — English
// by convention — and were rendered raw in the confirm step, the
// Inhalte-&-Rechte pane and member chips while the rest of the UI is German
// (journey-test i18n finding). Canonical names get the same localized labels
// the wizard's checkboxes already use; custom section names a community
// defined itself pass through verbatim.
import * as m from '$lib/paraglide/messages';

/** @type {Record<string, () => string>} */
const LABELS = {
  calendar: () => m.create_community_modal_content_calendar(),
  chat: () => m.create_community_modal_content_chat(),
  articles: () => m.create_community_modal_content_articles(),
  forum: () => m.create_community_modal_content_posts(),
  posts: () => m.create_community_modal_content_posts(),
  wikis: () => m.create_community_modal_content_wikis(),
  learning: () => m.create_community_modal_content_learning(),
  polls: () => m.create_community_modal_content_polls(),
  'social bookmarks': () => m.create_community_modal_content_bookmarks(),
  meet: () => m.create_community_modal_content_meet()
};

/**
 * @param {string | undefined | null} name
 * @returns {string}
 */
export function contentSectionLabel(name) {
  if (!name) return '';
  return LABELS[name.toLowerCase()]?.() ?? name;
}
