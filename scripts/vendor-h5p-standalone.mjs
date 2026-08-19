// Copies the pinned h5p-standalone dist into static/ so the client-side
// wrapper can embed it into generated .xdc packages. Re-run after bumping
// the h5p-standalone dependency; output is committed.
//
// fonts/ and images/ are copied too — h5p.css references them (icon fonts,
// the loading throbber) and without them the player degrades functionally
// inside a generated .xdc, not just cosmetically. A manifest.json is written
// alongside the vendored files so h5p-wrap.js doesn't need a hardcoded file
// list; it just fetches the manifest and pulls whatever's listed.
import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules/h5p-standalone');
const out = join(root, 'static/h5p-standalone');

mkdirSync(join(out, 'styles'), { recursive: true });
cpSync(join(src, 'dist/main.bundle.js'), join(out, 'main.bundle.js'));
cpSync(join(src, 'dist/frame.bundle.js'), join(out, 'frame.bundle.js'));
cpSync(join(src, 'dist/styles/h5p.css'), join(out, 'styles/h5p.css'));
cpSync(join(src, 'LICENSE'), join(out, 'LICENSE'));

for (const dir of ['fonts', 'images']) {
  const dirSrc = join(src, 'dist', dir);
  if (existsSync(dirSrc)) {
    cpSync(dirSrc, join(out, dir), { recursive: true });
  } else {
    console.log(`skipping ${dir}/ — not present in this h5p-standalone version`);
  }
}

/** @param {string} dir @returns {string[]} absolute paths of every file under dir */
function listFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...listFiles(full));
    else files.push(full);
  }
  return files;
}

const manifest = listFiles(out)
  .map((f) => relative(out, f).split(sep).join('/'))
  .filter((p) => p !== 'LICENSE' && p !== 'manifest.json')
  .sort();

writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

console.log('h5p-standalone vendored to static/h5p-standalone');
