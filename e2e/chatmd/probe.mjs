// Drives the REAL /groups/[pointer] chat route against the sandbox relay and
// asserts the markdown subset on relay-delivered events.
//
//   CHROMIUM_BIN=/etc/profiles/per-user/laoc/bin/google-chrome \
//   CHATMD_WORKTREE=/path/to/worktree node probe.mjs
//
// Runnable from ANYWHERE. ESM resolves bare specifiers relative to the
// importing FILE, not the cwd, so a copy of this script outside the tree
// cannot see node_modules by standing in the tree — it resolves playwright
// against the checkout it lives in (two levels up), overridable with
// CHATMD_WORKTREE for running against a different checkout.
//
// Exits non-zero on any failed check, so it is a gate, not a report.
import { createRequire } from 'module';
import { readFileSync, existsSync } from 'fs';

const HERE_DIR = new URL('.', import.meta.url).pathname;
const WORKTREE = process.env.CHATMD_WORKTREE ?? new URL('../..', import.meta.url).pathname;
if (!existsSync(`${WORKTREE}/package.json`)) {
  console.error(`no package.json at ${WORKTREE} — set CHATMD_WORKTREE`);
  process.exit(2);
}
const { chromium } = createRequire(`${WORKTREE}/package.json`)('@playwright/test');

const KEYS = process.env.CHATMD_KEYS ?? `${HERE_DIR}keys.json`;
const RELAY = process.env.CHATMD_RELAY ?? 'ws://127.0.0.1:17030';
const APP = process.env.CHATMD_APP ?? 'http://127.0.0.1:5187';

const keys = JSON.parse(readFileSync(KEYS, 'utf8'));
const url = `${APP}/groups/${encodeURIComponent(`${RELAY}'${keys.group}`)}`;

// A 1x1 transparent PNG, so intercepted images decode and STAY as <img>.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_BIN,
  args: ['--no-sandbox']
});
const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });

// Ledger over the WHOLE run, no settle window — a windowed count returns a
// zero indistinguishable from a real one (TestOER, 2026-08-07).
const sockets = [];
const httpHosts = new Set();
page.on('websocket', (ws) => sockets.push(ws.url()));
page.on('request', (r) => {
  try {
    const h = new URL(r.url()).host;
    if (!h.startsWith('127.0.0.1') && !h.startsWith('localhost')) httpHosts.add(h);
  } catch {
    /* non-http scheme */
  }
});

// Determinism, in BOTH directions — and it makes the run fully offline.
//
// Left to the network, every image row races: the fixture host is real, so
// `<img alt>` exists only until the load fails (measured: mdImageAlts 1 -> 0
// and gallery imgs 3 -> 0 within 500ms), while the emoji placeholder only
// appears AFTER its load fails. Two rows racing opposite ways is how 22/22
// passed twice on luck.
// ONE handler, not two: Playwright matches routes in REVERSE registration
// order, so a general image route registered after a specific abort silently
// overrides it — the emoji load then succeeds, no placeholder is ever
// rendered, and the wait below times out.
await page.route(/\.(png|jpe?g|gif|webp|avif)(\?.*)?$/i, (route) =>
  route.request().url().includes('sob.png')
    ? route.abort('connectionrefused')
    : route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
);

/**
 * A bare `TimeoutError` names a line number, not a cause. Every wait says what
 * it was waiting for and what it could see when it gave up.
 */
async function waitFor(label, fn, diag, timeout = 30000) {
  try {
    await page.waitForFunction(fn, { timeout });
  } catch {
    const saw = await page.evaluate(diag).catch(() => 'page unreachable');
    console.error(`TIMEOUT waiting for ${label} after ${timeout}ms; saw: ${JSON.stringify(saw)}`);
    await browser.close();
    process.exit(1);
  }
}

await page.goto(url, { waitUntil: 'domcontentloaded' });

await waitFor(
  'app hydration (body.app-ready)',
  () => document.body.classList.contains('app-ready'),
  () => ({ bodyClass: document.body.className, textLen: document.body.innerText.length })
);
await waitFor(
  '15 chat bubbles from the relay',
  () => document.querySelectorAll('.chat-bubble').length >= 15,
  () => ({ bubbles: document.querySelectorAll('.chat-bubble').length })
);
// Assert the END STATE of both racing families, not a moment in the middle.
await waitFor(
  'emoji fallback placeholder (aborted load)',
  () => document.querySelectorAll('[aria-label=":sob:"]').length >= 1,
  () => ({ placeholders: document.querySelectorAll('[aria-label=":sob:"]').length }),
  15000
);
await waitFor(
  'all fixture images decoded',
  () => {
    const imgs = [...document.querySelectorAll('[data-testid="media-image"] img')];
    const cells = [...document.querySelectorAll('[data-testid="media-gallery-item"] img')];
    return (
      imgs.length >= 1 &&
      cells.length >= 3 &&
      [...imgs, ...cells].every((i) => i.complete && i.naturalWidth > 0)
    );
  },
  () => ({
    mediaImgs: document.querySelectorAll('[data-testid="media-image"] img').length,
    galleryImgs: document.querySelectorAll('[data-testid="media-gallery-item"] img').length
  }),
  15000
);

const got = await page.evaluate(() => {
  const bubbles = [...document.querySelectorAll('.chat-bubble')];
  const by = (frag) => bubbles.find((b) => b.textContent.includes(frag));
  const bold = by('very');
  return {
    bubbleCount: bubbles.length,
    strong: bold?.querySelector('strong')?.textContent ?? null,
    em: bold?.querySelector('em')?.textContent ?? null,
    del: bold?.querySelector('del')?.textContent ?? null,
    inlineCode: by('before pushing')?.querySelector('code')?.textContent ?? null,
    fence: by('const a = 1')?.querySelector('pre')?.textContent ?? null,
    fenceEntity: by('npub1r30l8')?.querySelector('pre')?.textContent ?? null,
    blockquote: !!by('a quoted line')?.querySelector('blockquote'),
    ul: by('first item')?.querySelectorAll('ul li').length ?? 0,
    ol: by('first item')?.querySelectorAll('ol li').length ?? 0,
    linkHref: by('the docs')?.querySelector('a')?.getAttribute('href') ?? null,
    linkClass: by('the docs')?.querySelector('a')?.className ?? null,
    // Anchor on the link TEXT, never the href: the href fragment vanishes from
    // textContent exactly when the regression links it, so a row keyed on it
    // cannot go red (TestOER, 2026-08-07 — this row survived its mutation).
    badSchemeAnchor: !!by('click me')?.querySelector('a'),
    badSchemeLiteral: !!by('javascript:alert'),
    offOriginAnchor: !!by('looks internal')?.querySelector('a[href*="evil"]'),
    headingEl: !!by('# not a heading')?.querySelector('h1'),
    headingLiteral: !!by('# not a heading'),
    // Document-level, so a message dropped to an empty bubble cannot answer it.
    tableEl: document.querySelectorAll('.chat-bubble table').length,
    tableLiteral: !!by('| a | b |'),
    // The emoji load is aborted, so ImageWithFallback renders its placeholder,
    // which carries aria-label and NOT an <img alt>.
    emojiFallback: document.querySelectorAll('[aria-label=":sob:"]').length,
    mdImageAlts: [...document.querySelectorAll('[data-testid="media-image"] img')]
      .map((i) => i.getAttribute('alt'))
      .filter(Boolean),
    galleries: document.querySelectorAll('[data-testid="media-gallery"]').length,
    galleryItems: document.querySelectorAll('[data-testid="media-gallery-item"]').length,
    whiteSpace: (() => {
      const c = bubbles[0]?.querySelector('.break-words');
      return c ? getComputedStyle(c).whiteSpace : null;
    })()
  };
});

const EXPECT = {
  bubbleCount: 15,
  strong: 'bold',
  em: 'italic',
  del: 'struck',
  inlineCode: 'pnpm check',
  fence: 'const a = 1;\nif (a) {\n  console.log("indented");\n}',
  fenceEntity: 'nostr:npub1r30l8j4vmppvq8w23umcyvd3vct4zmfpfkn4c7h2h057rmlfcrmq9xt9ma',
  blockquote: true,
  ul: 2,
  ol: 2,
  linkHref: 'https://example.com/docs',
  linkClass: 'link link-primary',
  badSchemeAnchor: false,
  badSchemeLiteral: true,
  offOriginAnchor: false,
  headingEl: false,
  headingLiteral: true,
  tableEl: 0,
  tableLiteral: true,
  emojiFallback: 1,
  mdImageAlts: ['a helpful caption'],
  galleries: 1,
  galleryItems: 3,
  whiteSpace: 'normal'
};

let failed = 0;
for (const [k, want] of Object.entries(EXPECT)) {
  const ok = JSON.stringify(got[k]) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${k}: ${JSON.stringify(got[k])}${ok ? '' : ` != ${JSON.stringify(want)}`}`
  );
}

const prodSockets = [...new Set(sockets)].filter((u) => !u.includes('127.0.0.1'));
console.log(`\nproduction websockets: ${prodSockets.length ? JSON.stringify(prodSockets) : 'none'}`);
// HTTP is its own leak class: a config value can carry a production host and
// stay invisible to a WebSocket-only ledger (e.g. APP_LOGO -> blossom).
console.log(`off-host HTTP: ${httpHosts.size ? JSON.stringify([...httpHosts]) : 'none'}`);
console.log(failed === 0 ? `\nPASS ${Object.keys(EXPECT).length}/${Object.keys(EXPECT).length}` : `\nFAIL ${failed}`);

await browser.close();
process.exit(failed === 0 ? 0 : 1);
