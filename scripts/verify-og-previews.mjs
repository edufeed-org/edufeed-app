// scripts/verify-og-previews.mjs
// Verifies OG tag injection against a running dev server.
// Usage: node scripts/verify-og-previews.mjs [baseUrl] [-- extra paths...]
// Exits non-zero if any page lacks og:title or og:image.
const base = process.argv[2] || 'http://localhost:5173';

// One representative URL per page family. Replace the placeholders below with
// REAL identifiers from your relays before running (see comments).
const paths = [
  '/',
  '/discover',
  '/calendar',
  '/communities',
  // '/p/<real npub>',
  // '/c/<real community npub>',
  // '/calendar/author/<real npub>',
  // '/wiki/<real topic d-tag>',
  // '/<real naddr of a 30142 resource>',
  // '/calendar/event/<real naddr of a 31923>',
  // '/calendar/<real naddr of a 31924 collection>',
  // '/forms/<real naddr of a 30168>',
  ...process.argv.slice(3).filter((arg) => arg !== '--')
];

let failed = 0;
for (const path of paths) {
  const res = await fetch(base + path, { headers: { accept: 'text/html' } });
  const html = await res.text();
  const get = (prop) =>
    html.match(new RegExp(`<meta property="${prop}" content="([^"]*)"`))?.[1];
  const title = get('og:title');
  const image = get('og:image');
  const ok = Boolean(title && image);
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${path}\n     title: ${title}\n     image: ${image}`);
}
process.exit(failed ? 1 : 0);
