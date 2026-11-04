/** @vitest-environment node */
// Issue "mobile: bottom nav bar hides content": <main>'s bottom padding while
// the phone dock shows must cover the dock's real height — 4px top padding +
// 56px items + 1px border + the device's safe-area inset (34px on phones with
// a home indicator) + the 24px raised Erstellen circle — not a fixed 80px.
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/routes/+layout.svelte'), 'utf-8');

describe('root layout: dock padding on <main>', () => {
  test('the dock padding includes the safe-area inset and clears the raised circle', () => {
    const main = source.match(/<main\s[\s\S]*?>/)?.[0] ?? '';
    expect(main).toContain('env(safe-area-inset-bottom)');
    expect(main).toMatch(/pb-\[calc\(5\.75rem\+env\(safe-area-inset-bottom\)\)\]/);
    expect(main).not.toMatch(/class:pb-20=/);
  });

  test('desktop keeps no dock padding', () => {
    const main = source.match(/<main\s[\s\S]*?>/)?.[0] ?? '';
    expect(main).toMatch(/lg:pb-0/);
  });
});
