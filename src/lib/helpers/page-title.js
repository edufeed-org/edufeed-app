/**
 * Document titles: "<part> · <part> — <APP_NAME>".
 *
 * Every route needs one — an empty `document.title` makes SvelteKit's route
 * announcer read "untitled page" to screen readers on each client navigation
 * (QA 2026-10-02 K-new-5). Pure, so the copy decisions stay testable; the
 * localized pieces come from the caller.
 */

/**
 * @param {Array<string | null | undefined>} parts most specific first
 * @param {string | null | undefined} appName runtimeConfig.appName
 * @returns {string}
 */
export function pageTitle(parts, appName) {
  const head = parts
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(' · ');
  const app = (appName ?? '').trim();
  if (!head) return app;
  return app ? `${head} — ${app}` : head;
}

/**
 * The community route's title: the open channel (or the channel list) on the
 * channels view, the community name everywhere else.
 *
 * @param {{
 *   communityName: string,
 *   appName: string | null | undefined,
 *   view: string,
 *   channelName?: string | null,
 *   channelsLabel: string
 * }} args
 * @returns {string}
 */
export function communityPageTitle({ communityName, appName, view, channelName, channelsLabel }) {
  if (view !== 'channels') return pageTitle([communityName], appName);
  return pageTitle([channelName || channelsLabel, communityName], appName);
}
