/**
 * Label and icon of a community section id ('home', 'chat', 'calendar', …)
 * — shared by the phone section button/sheet (CommunitySectionNav) and the
 * phone Communities list, whose rows name the section of their newest item.
 */
import {
  HomeIcon,
  ChatIcon,
  CalendarIcon,
  SettingsIcon,
  WikipediaIcon,
  GraduationCapIcon,
  KanbanIcon,
  ScrollTextIcon,
  ForumIcon,
  BookmarkShareIcon,
  PollIcon,
  ChannelsIcon
} from '$lib/components/icons';
import * as m from '$lib/paraglide/messages';

/** @type {Record<string, any>} */
const iconMap = {
  home: HomeIcon,
  chat: ChatIcon,
  calendar: CalendarIcon,
  learning: GraduationCapIcon,
  boards: KanbanIcon,
  articles: ScrollTextIcon,
  forum: ForumIcon,
  wikis: WikipediaIcon,
  'social-bookmarks': BookmarkShareIcon,
  polls: PollIcon,
  settings: SettingsIcon,
  channels: ChannelsIcon
};

/** @type {Record<string, () => string>} */
const labelMap = {
  home: () => m.community_layout_bottom_tab_bar_home(),
  chat: () => m.community_layout_bottom_tab_bar_chat(),
  calendar: () => m.community_layout_bottom_tab_bar_calendar(),
  learning: () => m.community_layout_bottom_tab_bar_learning(),
  boards: () => m.community_layout_bottom_tab_bar_boards(),
  articles: () => m.community_layout_bottom_tab_bar_articles(),
  forum: () => m.community_layout_bottom_tab_bar_forum(),
  wikis: () => m.community_wikis_title(),
  'social-bookmarks': () => m.community_layout_bottom_tab_bar_social_bookmarks(),
  polls: () => m.community_layout_bottom_tab_bar_polls(),
  settings: () => m.community_layout_bottom_tab_bar_settings(),
  channels: () => m.concord_tab_label()
};

/**
 * @param {string} id
 * @returns {string}
 */
export function sectionLabel(id) {
  return labelMap[id]?.() ?? id;
}

/**
 * @param {string} id
 * @returns {any} Svelte icon component
 */
export function sectionIcon(id) {
  return iconMap[id] ?? ChatIcon;
}
