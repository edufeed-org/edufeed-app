// Signs a NIP-29 group + kind:9 chat messages carrying the markdown cases.
// Mints a FRESH identity every run (it does not re-sign under the committed
// key) and writes the new key to disk so anything published stays deletable.
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
const bytesToHex = (b) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
import { writeFileSync } from 'fs';

// Next to this file, not process.cwd() — every other piece of the harness is
// cwd-independent; running this from elsewhere must not scatter fixtures.
const out = (name) => new URL(`./${name}`, import.meta.url);

const sk = generateSecretKey();
const pk = getPublicKey(sk);
const GROUP = 'chatmd';
const now = Math.floor(Date.now() / 1000);

const IMG = 'https://example.com/photo.jpg';
const MESSAGES = [
  ['plain', 'just a plain line\nwith a second line'],
  ['bold', 'very **bold** and _italic_ and ~~struck~~'],
  ['inlinecode', 'run `pnpm check` before pushing'],
  ['fence', '```js\nconst a = 1;\nif (a) {\n  console.log("indented");\n}\n```'],
  ['fence-entity', '```\nnostr:npub1r30l8j4vmppvq8w23umcyvd3vct4zmfpfkn4c7h2h057rmlfcrmq9xt9ma\n```'],
  ['quote', '> a quoted line\n> and its continuation'],
  ['list', '- first item\n- second item\n\n1. one\n2. two'],
  ['mdlink', 'see [the docs](https://example.com/docs) for more'],
  ['badscheme', '[click me](javascript:alert(1))'],
  ['offorigin', '[looks internal](/\\evil.example)'],
  ['heading', '# not a heading'],
  ['table', '| a | b |\n| - | - |\n| 1 | 2 |'],
  ['mdimage', `![a helpful caption](${IMG})`],
  ['emoji', 'hi :sob: there'],
  ['gallery', `${IMG}\nhttps://example.com/p2.jpg\nhttps://example.com/p3.jpg`]
];

const events = [];
events.push(finalizeEvent({
  kind: 39000, created_at: now - 100,
  tags: [['d', GROUP], ['name', 'chat markdown probe'], ['public'], ['open']],
  content: ''
}, sk));

MESSAGES.forEach(([label, content], i) => {
  const tags = [['h', GROUP], ['probe', label]];
  if (label === 'emoji') tags.push(['emoji', 'sob', 'https://example.com/sob.png']);
  events.push(finalizeEvent({ kind: 9, created_at: now - 50 + i, tags, content }, sk));
});

writeFileSync(out('events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
writeFileSync(
  out('keys.json'),
  JSON.stringify({ seckeyHex: bytesToHex(sk), pubkey: pk, group: GROUP }, null, 2)
);
console.log('events:', events.length, 'author:', pk);
