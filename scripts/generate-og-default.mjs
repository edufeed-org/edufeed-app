// One-off generator for the default OG link-preview image (1200x630).
// Run: node scripts/generate-og-default.mjs
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

/** @param {string} s */
function escapeXml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const APP_NAME = escapeXml(process.env.APP_NAME || 'edufeed');
const TAGLINE = escapeXml(
  process.env.APP_OG_DESCRIPTION || 'Open educational resources, events & communities'
);

// Palette sampled from the edufeed editorial theme (warm beige page, paper
// cards, ink text, teal primary, red secondary, amber accent). Sampled via
// ImageMagick pixel-picking from in-progress theme screenshots since the
// custom DaisyUI "light" theme values aren't yet present in this branch's
// src/app.css (see task-5-report.md for details + exact sample coordinates).
const BEIGE = '#ebe4d8'; // page background
const INK = '#201b13'; // body text
const TEAL = '#437b7a'; // primary
const RED = '#e64a45'; // secondary
const AMBER = '#f28f29'; // accent

const svg = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="${BEIGE}"/>
  <rect x="0" y="0" width="1200" height="14" fill="${TEAL}"/>
  <rect x="0" y="616" width="1200" height="14" fill="${AMBER}"/>
  <text x="80" y="330" font-family="Outfit, DejaVu Sans, sans-serif" font-size="120"
        font-weight="700" fill="${INK}">${APP_NAME}</text>
  <text x="84" y="400" font-family="Outfit, DejaVu Sans, sans-serif" font-size="34"
        fill="${INK}" opacity="0.75">${TAGLINE}</text>
  <circle cx="1030" cy="140" r="46" fill="${TEAL}" opacity="0.92"/>
  <circle cx="1110" cy="200" r="30" fill="${RED}" opacity="0.92"/>
  <circle cx="1055" cy="245" r="20" fill="${AMBER}" opacity="0.92"/>
</svg>`;

const png = await sharp(Buffer.from(svg)).png().toBuffer();
writeFileSync(new URL('../static/og-default.png', import.meta.url), png);
console.log('wrote static/og-default.png', (await sharp(png).metadata()).width, 'x', (await sharp(png).metadata()).height);
