/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paraglideNamedReexports } from './vite-plugin-paraglide-named-reexports.mjs';

describe('paraglideNamedReexports', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'pg-')), 'paraglide', 'messages');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'hello.js'),
    'const en_hello = () => `Hi`;\nexport const hello = () => en_hello();\n'
  );
  writeFileSync(
    join(dir, 'camel1.js'),
    'const camel1 = () => `x`;\nexport { camel1 as "form_camelCase" }\n'
  );
  writeFileSync(join(dir, 'odd.js'), 'export default 1;\n');
  const index =
    "/* eslint-disable */\nexport * from './hello.js'\nexport * from './camel1.js'\nexport * from './odd.js'\n";
  const { transform } = paraglideNamedReexports();

  it('names every export of a message file instead of export *', () => {
    expect(transform(index, join(dir, '_index.js'))).toBe(
      "/* eslint-disable */\nexport { hello } from './hello.js'\nexport { \"form_camelCase\" } from './camel1.js'\nexport * from './odd.js'\n"
    );
  });

  it('leaves every other module alone', () => {
    expect(transform(index, join(dir, 'hello.js'))).toBeNull();
    expect(transform(index, '/app/src/lib/other/_index.js')).toBeNull();
  });
});
