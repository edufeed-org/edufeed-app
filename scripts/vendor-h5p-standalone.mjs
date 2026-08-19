// Copies the pinned h5p-standalone dist into static/ so the client-side
// wrapper can embed it into generated .xdc packages. Re-run after bumping
// the h5p-standalone dependency; output is committed.
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules/h5p-standalone');
const out = join(root, 'static/h5p-standalone');

mkdirSync(join(out, 'styles'), { recursive: true });
cpSync(join(src, 'dist/main.bundle.js'), join(out, 'main.bundle.js'));
cpSync(join(src, 'dist/frame.bundle.js'), join(out, 'frame.bundle.js'));
cpSync(join(src, 'dist/styles/h5p.css'), join(out, 'styles/h5p.css'));
cpSync(join(src, 'LICENSE'), join(out, 'LICENSE'));
console.log('h5p-standalone vendored to static/h5p-standalone');
