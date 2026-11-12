/** @vitest-environment node */
// The privacy policy is a Markdown file the deployment points at with
// PRIVACY_POLICY_PATH. It is rendered server-side through the same
// allowlist sanitizer as crawler-facing content, and re-read when the file
// changes so an operator can update the text without a rebuild.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** @type {string} */
let dir;

/** @param {Record<string, string>} env */
async function policyWith(env) {
  vi.doMock('$env/dynamic/private', () => ({ env }));
  const mod = await import('../server/privacy-policy.js');
  return mod;
}

beforeEach(() => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), 'privacy-policy-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('loadPrivacyPolicy', () => {
  it('returns null when no path is configured', async () => {
    const { loadPrivacyPolicy } = await policyWith({});
    expect(await loadPrivacyPolicy()).toBeNull();
  });

  it('returns null when the file is missing', async () => {
    const { loadPrivacyPolicy } = await policyWith({
      PRIVACY_POLICY_PATH: join(dir, 'missing.md')
    });
    expect(await loadPrivacyPolicy()).toBeNull();
  });

  it('renders the Markdown to sanitized HTML and keeps headings, lists and tables', async () => {
    const file = join(dir, 'policy.md');
    writeFileSync(
      file,
      [
        '# Datenschutzerklärung',
        '',
        'Stand: 27. Oktober 2026',
        '',
        '## 1 Verantwortlicher',
        '',
        '- IP-Adresse',
        '',
        '| Dienst | Zweck |',
        '|---|---|',
        '| relay.damus.io | Relay |',
        '',
        '<script>alert(1)</script><img src=x onerror="alert(1)">',
        ''
      ].join('\n')
    );
    const { loadPrivacyPolicy } = await policyWith({ PRIVACY_POLICY_PATH: file });
    const policy = await loadPrivacyPolicy();
    expect(policy).not.toBeNull();
    const html = /** @type {{ html: string }} */ (policy).html;
    expect(html).toContain('<h1');
    expect(html).toContain('Datenschutzerklärung');
    expect(html).toContain('<li>IP-Adresse</li>');
    expect(html).toContain('<table');
    expect(html).toContain('relay.damus.io');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
  });

  it('re-reads the file when it changes on disk', async () => {
    const file = join(dir, 'policy.md');
    writeFileSync(file, '# Version eins\n');
    const { loadPrivacyPolicy } = await policyWith({ PRIVACY_POLICY_PATH: file });
    expect(/** @type {any} */ (await loadPrivacyPolicy()).html).toContain('Version eins');

    writeFileSync(file, '# Version zwei\n');
    const later = new Date(Date.now() + 5000);
    utimesSync(file, later, later);
    expect(/** @type {any} */ (await loadPrivacyPolicy()).html).toContain('Version zwei');
  });

  describe('Termi sections (<!-- if:termi --> markers)', () => {
    const SHIPPED = join(process.cwd(), 'legal', 'privacy-policy.de.md');

    it('flag off: the shipped policy names neither Termi nor GWDG', async () => {
      const { loadPrivacyPolicy } = await policyWith({ PRIVACY_POLICY_PATH: SHIPPED });
      const html = /** @type {any} */ (await loadPrivacyPolicy()).html;
      // "Termin(e)" (calendar events) stays, of course.
      expect(html).not.toMatch(/Termi(?!n)/);
      expect(html).not.toContain('GWDG');
      expect(html).not.toContain('if:termi');
      expect(html).not.toContain('prettier-ignore');
      expect(html).toContain('mcp.edufeed.org (Metadaten-Vorschläge)');
    });

    it('flag on: both appear, the markers never leak, the table stays a table', async () => {
      const { loadPrivacyPolicy } = await policyWith({
        PRIVACY_POLICY_PATH: SHIPPED,
        TERMI_AI_ENABLED: 'true'
      });
      const html = /** @type {any} */ (await loadPrivacyPolicy()).html;
      expect(html).toContain('Termi');
      expect(html).toContain('GWDG');
      expect(html).toContain('Termi-Materialsuche');
      expect(html).not.toContain('if:termi');
      expect(html).not.toContain('prettier-ignore');
      expect(html).toMatch(/<td>chat-ai\.academiccloud\.de/);
      expect(html).toContain('NIP-05');
    });

    it('flag off: Termi conversations are not named', async () => {
      const { loadPrivacyPolicy } = await policyWith({ PRIVACY_POLICY_PATH: SHIPPED });
      const html = /** @type {any} */ (await loadPrivacyPolicy()).html;
      expect(html).not.toContain('Termi-Unterhaltungen');
      expect(html).not.toContain('Art. 6 Abs. 1 lit. b DSGVO (Bereitstellung der Funktion)');
      // The inbox marker sentence is unconditional and no longer absolute.
      expect(html).toContain('Benachrichtigungen gesehen hast');
      expect(html).toContain(
        'auf deine Relays und auf die in Abschnitt 6 genannten Relays für Benachrichtigungen und Relay-Listen'
      );
      expect(html).not.toContain('Diese Daten verlassen deinen Browser nicht');
    });

    it('flag on: Termi conversations are named as stored encrypted for you', async () => {
      const { loadPrivacyPolicy } = await policyWith({
        PRIVACY_POLICY_PATH: SHIPPED,
        TERMI_AI_ENABLED: 'true'
      });
      const html = /** @type {any} */ (await loadPrivacyPolicy()).html;
      expect(html).toContain('deine Termi-Unterhaltungen (für dich verschlüsselt)');
      expect(html).toContain(
        '(deine NIP-65-Schreibrelays; hast du keine eingetragen, die Standard-Relays dieser Installation)'
      );
      expect(html).toContain(
        'sowie, wenn du Mitglied einer angeschlossenen Einrichtung bist, auf dem Mitglieder-Relay dieser Installation'
      );
      expect(html).toContain('wenn dein Signer NIP-44 unterstützt, sonst nur lokal');
      expect(html).toContain('Der Inhalt ist nur für dich lesbar');
      expect(html).toContain('nur für die Dauer der Sitzung im Browser');
      expect(html).toContain('Rechtsgrundlage dafür: Art. 6 Abs. 1 lit. b DSGVO');
      expect(html).toContain('Unser Server speichert den Gesprächsverlauf nicht');
      expect(html).not.toContain('Wir speichern den Gesprächsverlauf nicht');
    });

    it('flag off: LiaScript is a third-party server that receives the article address', async () => {
      const { loadPrivacyPolicy } = await policyWith({ PRIVACY_POLICY_PATH: SHIPPED });
      const html = /** @type {any} */ (await loadPrivacyPolicy()).html;
      expect(html).toMatch(/<td>LiaScript\.github\.io \(GitHub Pages\)/);
      expect(html).toContain(
        'übertragen wird die Nostr-Adresse des Artikels, LiaScript lädt ihn dann selbst von den darin genannten Relays</td>'
      );
      expect(html).not.toContain('Termi-Dokument');
      expect(html).not.toContain('Werkbank');
    });

    it("flag on: the Werkbank's Kurs view loads the player; the course text stays in the browser", async () => {
      const { loadPrivacyPolicy } = await policyWith({
        PRIVACY_POLICY_PATH: SHIPPED,
        TERMI_AI_ENABLED: 'true'
      });
      const html = /** @type {any} */ (await loadPrivacyPolicy()).html;
      // the address sentence names only the clicks that send an address; the Kurs view sends none
      expect(html).toContain(
        'bzw. „Als LiaScript-Kurs öffnen“; übertragen wird die Nostr-Adresse des Artikels'
      );
      expect(html).not.toContain('„Kurs“ in der Termi-Werkbank');
      expect(html).toContain(
        'Die Kurs-Ansicht der Werkbank lädt den LiaScript-Player von LiaScript.github.io; die Anfrage enthält deine IP-Adresse und einen kurzen Prüfwert des Inhalts, keine Adresse'
      );
      expect(html).toContain(
        'Den Kurstext übergibt dein Browser dem Player direkt; edufeed sendet ihn an keinen Server</td>'
      );
      // after the document sentences: their „dafür“ still means the LiaScript link, not the Kurs view
      expect(html).toContain(
        'genannten Relays. Ein Termi-Dokument wird dafür zuerst als dein eigener'
      );
      expect(html).toContain(
        'kein Dokumenttext steht in der Adresse. Die Kurs-Ansicht der Werkbank lädt'
      );
    });

    it("flag on: a Termi document reaches LiaScript as the user's own draft, not in the URL", async () => {
      const { loadPrivacyPolicy } = await policyWith({
        PRIVACY_POLICY_PATH: SHIPPED,
        TERMI_AI_ENABLED: 'true'
      });
      const html = /** @type {any} */ (await loadPrivacyPolicy()).html;
      expect(html).toContain('Öffnen eines Artikels oder Termi-Dokuments als interaktiver Kurs');
      expect(html).toContain('zuerst als dein eigener, nicht gelisteter Entwurf auf deinen Relays');
      expect(html).toContain('kein Dokumenttext steht in der Adresse.');
      expect(html).not.toContain('als Teil der Adresse');
    });

    const FILE_CLAUSE = 'Ziehst du eine Datei ins Termi-Fenster';

    it('flag off: no file-import clause', async () => {
      const { loadPrivacyPolicy } = await policyWith({ PRIVACY_POLICY_PATH: SHIPPED });
      expect(/** @type {any} */ (await loadPrivacyPolicy()).html).not.toContain(FILE_CLAUSE);
    });

    it('flag on: the file-import clause names the send button, the instruction and the 60 000-char cap', async () => {
      const { loadPrivacyPolicy } = await policyWith({
        PRIVACY_POLICY_PATH: SHIPPED,
        TERMI_AI_ENABLED: 'true'
      });
      const html = /** @type {any} */ (await loadPrivacyPolicy()).html;
      expect(html).toContain(FILE_CLAUSE);
      expect(html).toContain('60.000 Zeichen');
      expect(html).toContain('abschickst (Senden-Knopf oder Eingabetaste');
      expect(html).toContain('dein Gesprächsverlauf sowie das heutige Datum und deine Zeitzone');
      expect(html).toContain('zusammen mit deiner Anweisung dazu');
      expect(html).not.toContain('ausdrücklich bestätigt');
      // After the "Ohne KI" fallback sentence, which does not cover the import.
      const fallback = html.indexOf('läuft dieselbe Frage stattdessen wie oben');
      expect(fallback).toBeGreaterThan(0);
      expect(html.indexOf(FILE_CLAUSE)).toBeGreaterThan(fallback);
      expect(html).toContain('Für den Terminimport gibt es keinen Weg ohne KI.');
    });

    it('flag on: "Termine aus Partnerquellen" stays a top-level sibling bullet, not nested under Termi', async () => {
      // Regression: an indented endif:termi marker (prettier may reindent a
      // marker line under the Termi bullet's nested Ohne-KI/Mit-KI sublist)
      // must not leave stray leading whitespace behind — that previously
      // turned this next bullet into a sub-bullet of the Termi item.
      const { loadPrivacyPolicy } = await policyWith({
        PRIVACY_POLICY_PATH: SHIPPED,
        TERMI_AI_ENABLED: 'true'
      });
      const html = /** @type {any} */ (await loadPrivacyPolicy()).html;
      const i = html.indexOf('Termine aus Partnerquellen');
      expect(i).toBeGreaterThan(-1);
      // The nested Ohne-KI/Mit-KI </ul> and the Termi </li> both close
      // before this bullet's own top-level <li> opens — never inside them.
      expect(html.slice(0, i)).toMatch(/<\/ul>\s*(?:<\/li>\s*)?<li>(?:<p>)?\s*<strong>$/);
    });

    it('strips block and inline sections when off, only the markers when on', async () => {
      const file = join(dir, 'policy.md');
      writeFileSync(
        file,
        [
          'A<!-- if:termi -->, inline<!-- endif:termi -->.',
          '',
          '| x | y |',
          '|---|---|',
          '| 1 | 2 |',
          '<!-- if:termi -->',
          '| row | termi |',
          '<!-- endif:termi -->',
          '| 3 | 4 |',
          ''
        ].join('\n')
      );
      const off = await policyWith({ PRIVACY_POLICY_PATH: file });
      const offHtml = /** @type {any} */ (await off.loadPrivacyPolicy()).html;
      expect(offHtml).not.toContain('inline');
      expect(offHtml).not.toContain('termi');
      expect(offHtml).toContain('<td>3</td>');

      vi.resetModules();
      const on = await policyWith({ PRIVACY_POLICY_PATH: file, TERMI_AI_ENABLED: 'true' });
      const onHtml = /** @type {any} */ (await on.loadPrivacyPolicy()).html;
      expect(onHtml).toContain('A, inline.');
      expect(onHtml).toContain('<td>termi</td>');
      expect(onHtml).toContain('<td>3</td>');
      expect(onHtml).not.toContain('if:termi');
    });

    it('the shipped file balances every if:termi with an endif:termi', async () => {
      const { readFileSync } = await import('node:fs');
      const text = readFileSync(SHIPPED, 'utf8');
      const opens = text.match(/<!-- if:termi -->/g)?.length ?? 0;
      expect(opens).toBeGreaterThan(0);
      expect(text.match(/<!-- endif:termi -->/g)?.length).toBe(opens);
    });

    it('a missing endif leaks its section (fails safe) instead of deleting the next one', async () => {
      const file = join(dir, 'policy.md');
      writeFileSync(
        file,
        [
          'A<!-- if:termi --> leaked',
          '',
          'Wichtiger Absatz.',
          '',
          'B<!-- if:termi --> cut<!-- endif:termi -->.',
          ''
        ].join('\n')
      );
      const { loadPrivacyPolicy } = await policyWith({ PRIVACY_POLICY_PATH: file });
      const html = /** @type {any} */ (await loadPrivacyPolicy()).html;
      expect(html).toContain('Wichtiger Absatz.');
      expect(html).toContain('leaked');
      expect(html).not.toContain('cut');
      expect(html).toContain('B.');
    });

    it('the cache key includes the flag', async () => {
      const file = join(dir, 'policy.md');
      writeFileSync(file, 'A<!-- if:termi --> Termi<!-- endif:termi -->\n');
      /** @type {Record<string, string>} */
      const env = { PRIVACY_POLICY_PATH: file };
      const { loadPrivacyPolicy } = await policyWith(env);
      expect(/** @type {any} */ (await loadPrivacyPolicy()).html).not.toContain('Termi');
      env.TERMI_AI_ENABLED = 'true';
      expect(/** @type {any} */ (await loadPrivacyPolicy()).html).toContain('Termi');
    });
  });

  it('resolves a relative path against the working directory', async () => {
    const { resolvePolicyPath } = await policyWith({ PRIVACY_POLICY_PATH: 'legal/x.md' });
    expect(resolvePolicyPath()).toBe(join(process.cwd(), 'legal', 'x.md'));
  });
});
