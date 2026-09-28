/**
 * Third-party material the app ships whose license asks for a visible credit
 * (CC BY 4.0 attribution, Unicode License V3 / MIT notices). Rendered by
 * ThirdPartyCredits on /imprint OUTSIDE the operator's IMPRINT_ENABLED block,
 * so every deployment shows it whatever its imprint config. The full license
 * texts live in static/third-party-notices.txt (NOTICES_PATH).
 *
 * Adding shipped third-party material with an attribution requirement = add
 * an entry here and its license text to the notices file.
 *
 * Messages are referenced as functions, never looked up by key (see
 * CLAUDE.md, Paraglide budget).
 */
import * as m from '$lib/paraglide/messages';

export const NOTICES_PATH = '/third-party-notices.txt';

/**
 * @typedef {{ label: string, href: string }} CreditLink
 * @typedef {{ id: string, title: () => string, text: () => string, links: CreditLink[] }} Credit
 */

/** @type {Credit[]} */
export const THIRD_PARTY_CREDITS = [
  {
    id: 'emoji-data',
    title: () => m.credits_emoji_data_title(),
    text: () => m.credits_emoji_data_text(),
    links: [
      { label: 'Unicode CLDR', href: 'https://cldr.unicode.org/' },
      { label: 'Unicode License V3', href: 'https://www.unicode.org/license.txt' },
      { label: 'emojibase', href: 'https://emojibase.dev/' }
    ]
  }
];
