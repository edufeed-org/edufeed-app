/** @vitest-environment node */
/**
 * static/third-party-notices.txt — the full license texts the /imprint
 * credits (helpers/third-party-credits.js) point to. Guards against an entry
 * whose required notice text never made it into the served file.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NOTICES_PATH } from '$lib/helpers/third-party-credits.js';

const notices = readFileSync(resolve(process.cwd(), `static${NOTICES_PATH}`), 'utf8');

describe('static/third-party-notices.txt', () => {
  it('carries the Unicode License V3 and the emojibase MIT notice for the emoji data', () => {
    expect(notices).toContain('UNICODE LICENSE V3');
    expect(notices).toContain('Copyright © 1991-2026 Unicode, Inc.');
    expect(notices).toContain('Copyright (c) 2017-2019 Miles Johnson');
    expect(notices).toContain('Permission is hereby granted, free of charge');
  });

  it('carries the Twemoji CC BY 4.0 attribution and the TalkJS MIT notice for the flag font', () => {
    expect(notices).toContain('Copyright 2019 Twitter, Inc and other contributors');
    expect(notices).toContain('https://creativecommons.org/licenses/by/4.0/');
    expect(notices).toMatch(/Modification: converted/);
    expect(notices).toContain('Copyright (c) 2022 TalkJS');
  });
});
