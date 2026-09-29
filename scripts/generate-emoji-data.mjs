#!/usr/bin/env node
/**
 * Generate the per-locale unicode emoji datasets under src/lib/data/emoji/
 * from emojibase-data (Unicode/CLDR annotations, one file per app locale).
 *
 *   pnpm run generate:emoji
 *
 * Each file is an ordered array of slim entries the picker and the `:`
 * autocomplete search over (see src/lib/helpers/emoji-data.js):
 *
 *   { u: '🔥', g: 5, l: 'Feuer', t: ['brennen', 'flamme', 'heiß'], s: ['fire'], k?: ['👍🏻', …] }
 *
 *   u  the emoji as sent on the wire (fully-qualified: text-default emojis
 *      such as ❤️ carry U+FE0F, emoji-default ones such as 👍 do not — the
 *      form every other Nostr client reacts with)
 *   g  emojibase group number (0 smileys … 9 flags; group 2 "component" and
 *      the regional indicators are skipped)
 *   l  localized label (CLDR short name)
 *   t  localized keywords (CLDR annotations)
 *   s  English emojibase shortcodes — the `:fire:` vocabulary, locale-neutral
 *   k  the five skin-tone variants (light … dark), only when the emoji has a
 *      uniform tone variant for every tone
 *
 * The output is committed: emojibase-data is a devDependency, the runtime
 * never touches it. Re-run after bumping emojibase-data.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Locales the app ships (project.inlang/settings.json). */
export const EMOJI_LOCALES = ['en', 'de'];

/** @param {string} hexcode e.g. "1F44D-1F3FB" */
export function hexcodeToString(hexcode) {
  return String.fromCodePoint(...hexcode.split('-').map((h) => parseInt(h, 16)));
}

/**
 * @typedef {{ hexcode: string, label: string, group?: number, type: 0 | 1, tags?: string[],
 *   order?: number, skins?: Array<{ hexcode: string, tone: number | number[] }> }} EmojibaseEmoji
 * @typedef {{ u: string, g: number, l: string, t: string[], s: string[], k?: string[] }} EmojiEntry
 */

/**
 * Build one locale's slim dataset.
 * @param {EmojibaseEmoji[]} data emojibase-data/<locale>/data.json
 * @param {Record<string, string | string[]>} shortcodes emojibase-data/en/shortcodes/emojibase.json
 * @returns {EmojiEntry[]}
 */
export function buildLocaleData(data, shortcodes) {
  /** @param {EmojibaseEmoji} e */
  const wireForm = (e) => hexcodeToString(e.hexcode) + (e.type === 0 ? '️' : '');
  return data
    .filter((e) => typeof e.group === 'number' && e.group !== 2)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((e) => {
      const sc = shortcodes[e.hexcode];
      /** @type {EmojiEntry} */
      const entry = {
        u: wireForm(e),
        g: /** @type {number} */ (e.group),
        l: e.label,
        t: (e.tags ?? []).filter((t) => t !== e.label),
        s: sc === undefined ? [] : Array.isArray(sc) ? sc : [sc]
      };
      if (e.skins) {
        const tones = [1, 2, 3, 4, 5].map((tone) => e.skins?.find((s) => s.tone === tone));
        if (tones.every(Boolean)) {
          entry.k = tones.map((s) => hexcodeToString(/** @type {{hexcode: string}} */ (s).hexcode));
        }
      }
      return entry;
    });
}

function main() {
  const require = createRequire(import.meta.url);
  const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'data', 'emoji');
  mkdirSync(outDir, { recursive: true });
  const shortcodes = require('emojibase-data/en/shortcodes/emojibase.json');
  for (const locale of EMOJI_LOCALES) {
    const entries = buildLocaleData(require(`emojibase-data/${locale}/data.json`), shortcodes);
    const file = join(outDir, `${locale}.json`);
    writeFileSync(file, JSON.stringify(entries) + '\n');
    console.log(`${file}: ${entries.length} emojis`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
