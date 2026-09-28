/**
 * Country flag emojis on Windows. Windows ships no flag glyphs, so Chromium
 * browsers there render 🇩🇪 as the letters "DE" — in messages, reactions,
 * names, everywhere, not just the picker. country-flag-emoji-polyfill
 * detects that with a canvas and, only then, injects an @font-face for a
 * flags-only font (Twemoji artwork, CC BY 4.0 — credited on /imprint via
 * helpers/third-party-credits.js) restricted to the flag code points.
 *
 * The font is served from OUR origin (Vite asset, hashed) — never the
 * package's jsDelivr default: fonts are self-hosted (CLAUDE.md, Theming).
 * Every font stack in src/app.css starts with FLAG_FONT_FAMILY; a family
 * that was never injected is simply skipped by the browser.
 *
 * Loaded with a dynamic import from the root layout, so it adds nothing to
 * the root preload budget.
 */
import { polyfillCountryFlagEmojis } from 'country-flag-emoji-polyfill';
import flagFontUrl from 'country-flag-emoji-polyfill/dist/TwemojiCountryFlags.woff2?url';

export const FLAG_FONT_FAMILY = 'Twemoji Country Flags';

/** @returns {boolean} true when the flag font was injected */
export function installFlagEmojiPolyfill() {
  return polyfillCountryFlagEmojis(FLAG_FONT_FAMILY, flagFontUrl);
}
