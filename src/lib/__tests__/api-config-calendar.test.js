/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// CALENDAR_LOCALE is deprecated and ignored: calendar names follow the app
// language (QA round 3 K5). A deployment that still sets it must keep working.
describe('/api/config calendar block', () => {
  beforeEach(() => vi.resetModules());

  it('no longer exposes a calendar locale, even when CALENDAR_LOCALE is set', async () => {
    vi.doMock('$env/dynamic/private', () => ({
      env: { CALENDAR_LOCALE: 'en-US', CALENDAR_WEEK_START_DAY: '0' }
    }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.calendar).not.toHaveProperty('locale');
    expect(body.calendar.weekStartDay).toBe(0);
    expect(body.calendar.timeFormat).toBe('24h');
  });
});
