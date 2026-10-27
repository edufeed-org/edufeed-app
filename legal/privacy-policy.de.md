# Datenschutzerklärung

Stand: 27. Oktober 2026

## 1 Verantwortlicher

Steffen Rörtgen
E-Mail: kontakt@steffen-roertgen.de

Ein Datenschutzbeauftragter ist nicht bestellt; eine gesetzliche Pflicht dazu besteht nicht.

## 2 Grundsätzliches zu edufeed

edufeed ist eine Web-Anwendung auf Basis des offenen Protokolls **Nostr**. Das hat Folgen für den Datenschutz, die sich von üblichen Plattformen unterscheiden:

- **Inhalte, die du veröffentlichst, sind öffentlich.** Profile, Artikel, Lernressourcen, Termine, Kommentare, Reaktionen und Ähnliches werden als signierte Nachrichten an sogenannte Relays (Server) gesendet – an Relays, die wir betreiben, und je nach Einstellung an Relays Dritter. Sie sind dort für alle abrufbar und können von anderen Programmen angezeigt, kopiert und weiterverbreitet werden.
- **Löschen ist nur eingeschränkt möglich.** edufeed sendet beim Löschen eine Löschanfrage (NIP-09) an die Relays. Unsere Relays entfernen das betreffende Event; die Löschanfrage selbst bleibt gespeichert, damit auch andere Programme sie sehen. Ob Relays Dritter und andere Programme die Anfrage befolgen, können wir nicht garantieren – und weil Nostr-Inhalte von jedem weiterverbreitet werden können, lässt sich nicht sagen, wohin ein Event bereits gelangt ist.
- **Dein Konto ist ein Schlüsselpaar**, das wir nicht kennen und nicht speichern. Es liegt in deinem Browser oder in einer Signier-App deiner Wahl.

## 3 Aufruf der Website (Server-Protokolle)

Beim Aufruf von edufeed.org verarbeitet unser Server technisch notwendige Daten: IP-Adresse, Datum und Uhrzeit, aufgerufene Adresse einschließlich Suchparametern, Statuscode und übertragene Datenmenge. Die Anfragen laufen über einen gemieteten Server (netcup GmbH, Deutschland), der sie an die Anwendung auf eigener Hardware des Verantwortlichen weiterleitet.

- **Zweck:** Auslieferung der Website, Sicherheit und Abwehr von Angriffen.
- **Rechtsgrundlage:** Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an einem sicheren Betrieb).
- **Speicherdauer:** Die Protokolle werden nach spätestens 7 Tagen gelöscht.
- **Angriffserkennung mit CrowdSec:** Die Software erkennt auffällige Zugriffsmuster (zum Beispiel massenhaftes Abtasten nach Sicherheitslücken) und sperrt die betreffende IP-Adresse für 4 Stunden. Erkannte Angriffe – IP-Adresse, Art des Angriffs, Zeitpunkt – werden an die Gemeinschaftsdatenbank der CrowdSec SAS (Frankreich) übermittelt; im Gegenzug erhalten wir deren Liste bekannter Angreifer-Adressen. Normale Seitenaufrufe werden nicht übermittelt. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO.
- **Sicherungskopien:** Die Daten unserer Dienste werden verschlüsselt gesichert (bis zu 6 Monate rückwirkend). Gelöschte Daten können bis zum Ablauf dieser Frist in Sicherungen enthalten sein.

## 4 Nutzungsstatistik ohne personenbezogene Daten

Um zu verstehen, wie Suchmaschinen und KI-Assistenten edufeed finden, zählt die Anwendung täglich:

- Abrufe durch Suchmaschinen- und KI-Crawler (zum Beispiel Googlebot, Bingbot, GPTBot) je Seite. Ob ein Abruf wirklich vom angegebenen Crawler stammt, prüfen wir, indem wir die IP-Adresse im Arbeitsspeicher mit den vom Betreiber veröffentlichten Adressbereichen vergleichen. Die IP-Adresse wird dabei nicht gespeichert.
- Besuche, die von Suchmaschinen oder KI-Assistenten kommen – gespeichert wird nur der Name des Dienstes (zum Beispiel „chatgpt.com“), nicht die vollständige Herkunftsadresse – sowie die Gesamtzahl der Seitenaufrufe.

Gespeichert werden ausschließlich Summen pro Tag. Es werden keine IP-Adressen, keine Browserkennungen und keine Cookies verwendet; ein Rückschluss auf einzelne Personen ist nicht möglich. Rechtsgrundlage für die kurzzeitige Verarbeitung der IP-Adresse im Arbeitsspeicher: Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an der Auffindbarkeit unserer Bildungsinhalte).

## 5 Speicherung im Browser

edufeed setzt **keine Cookies** und bindet **keine Analyse- oder Werbedienste** ein. Im Speicher deines Browsers (localStorage, IndexedDB) legt die Anwendung ab, was für ihre Funktion nötig ist: Einstellungen, angemeldete Konten und gegebenenfalls dein privater Schlüssel, zwischengespeicherte Inhalte, Lesestatus. Diese Daten verlassen deinen Browser nicht. Rechtsgrundlage: § 25 Abs. 2 Nr. 2 TDDDG (unbedingt erforderlich für den von dir gewünschten Dienst).

Benachrichtigungen des Betriebssystems über neue Nachrichten kannst du in den Einstellungen einschalten; sie werden ausschließlich von deinem Browser erzeugt, ohne Push-Dienst eines Dritten.

## 6 Verbindungen deines Browsers zu anderen Servern

Weil Nostr dezentral ist, verbindet sich dein Browser direkt mit weiteren Servern. Diese erhalten dabei technisch bedingt deine IP-Adresse und können sie nach eigenen Regeln verarbeiten.

**Von uns betriebene Server** (für ihre Protokolle gilt Abschnitt 3): relay.edufeed.org (Inhalte, Communities, Termine), amb-relay.edufeed.org und oersi.edufeed.org (Lernressourcen), dm.edufeed.org (Direktnachrichten), groups.edufeed.org (Kanäle), livekit.edufeed.org und turn.edufeed.org (Audio- und Videokonferenzen), blossom.edufeed.org (Dateien), nip05.edufeed.org (verifizierte Adressen), mcp.edufeed.org (Metadaten-Vorschläge) sowie sparql.mem.edufeed.org (Lehrplandaten). relay-rpi.edufeed.org (Kanban-Boards) wird für das Comenius-Institut auf der Infrastruktur des Verantwortlichen betrieben.

**Server Dritter**, die dein Browser je nach Funktion kontaktiert:

| Dienst                                               | Zweck                                                                                                                                    | Betreiber          |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| relay.damus.io, relay.primal.net                     | allgemeine Nostr-Relays: Benachrichtigungen; Abruf und Veröffentlichung, wenn du den geschützten Modus in den Einstellungen ausschaltest | Dritte             |
| purplepag.es                                         | Profile und Relay-Listen anderer Nutzer:innen finden                                                                                     | Dritte             |
| tags.brainstorm.world, scores.brainstorm.world       | Personensuche und Vertrauenswerte zur Sortierung von Suchergebnissen                                                                     | Dritte             |
| relay.nostr.band, nos.lol, relay.damus.io            | Hinweise auf andere Nostr-Apps für Inhaltstypen, die edufeed nicht selbst anzeigt (nur auf solchen Detailseiten)                         | Dritte             |
| tiles.openfreemap.org                                | Kartenkacheln bei Terminen mit Ort                                                                                                       | OpenFreeMap        |
| iframe.diy                                           | abgeschottete Ausführung interaktiver Inhalte (webxdc, H5P), nur beim Öffnen                                                             | Dritte             |
| Bild- und Medien-Server in Beiträgen                 | Anzeige von Bildern und Videos, die andere in ihre Beiträge eingebunden haben                                                            | jeweilige Anbieter |
| von dir selbst eingetragene Relays und Medien-Server | nach deiner Wahl                                                                                                                         | Dritte             |

Bilder aus Beiträgen lädt unser Server nach Möglichkeit selbst und liefert sie verkleinert an dich aus; nur wenn das fehlschlägt, lädt dein Browser das Bild direkt vom ursprünglichen Server.

Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO (Bereitstellung der von dir genutzten Funktion).

## 7 Einzelne Funktionen

- **Dateien hochladen:** Bilder und Dateien werden auf unseren Server blossom.edufeed.org oder auf von dir gewählte Server geladen und sind dort öffentlich abrufbar. Bedenke, dass Fotos Metadaten wie Aufnahmeort und -zeit enthalten können.
- **Orte bei Terminen:** Gibst du eine Adresse ein, sendet unser Server diesen Text an den Geokodierungsdienst OpenCage (OpenCage GmbH, Deutschland), um Koordinaten zu ermitteln. Deine IP-Adresse wird dabei nicht übermittelt.
- **Link-Vorschauen:** Für die Vorschaukarte zu einem Weblink ruft unser Server die verlinkte Seite und ihr Vorschaubild selbst ab; der fremde Server sieht dabei unsere, nicht deine IP-Adresse. Link-Vorschauen lassen sich in den Einstellungen abschalten.
- **Direktnachrichten:** Ende-zu-Ende-verschlüsselt nach NIP-17; wir können den Inhalt nicht lesen. Die verschlüsselten Nachrichten liegen auf dm.edufeed.org und den Relays der Empfänger:innen.
- **Audio- und Videokonferenzen in Kanälen:** Ton und Bild laufen über unseren Konferenzserver livekit.edufeed.org (bei Bedarf über turn.edufeed.org), transportverschlüsselt. Gespräche werden nicht aufgezeichnet. Wer gerade teilnimmt, wird vom Kanal-Relay für die Mitglieder des Kanals sichtbar gemacht. Gäste mit Einladungslink nehmen ohne Konto teil; der Link ist zeitlich begrenzt.
- **Mitgliedschaft und verifizierte Adresse (@edufeed.org):** Im Antrag gibst du Wunsch-Adresse, Namen, Institution, Rolle und Motivation an. Der Antrag wird verschlüsselt an die Administrator:innen gesendet (gespeichert auf relay.edufeed.org, nur für sie lesbar) und dient der Entscheidung über die Aufnahme (Art. 6 Abs. 1 lit. b DSGVO). Bei Aufnahme wird die Zuordnung von Adresse und öffentlichem Schlüssel öffentlich abrufbar gespeichert. Anträge werden 180 Tage nach Eingang automatisch vom Relay gelöscht.
- **Metadaten-Vorschläge:** Beim Anlegen einer Lernressource aus einer URL sendet unser Server nur die URL und die gewählte Formularart an unseren Dienst nope-mcp (mcp.edufeed.org). Dieser ruft die öffentliche Seite ab und lässt ihren Text, sofern sie keine maschinenlesbaren Bildungsmetadaten enthält, von einem KI-Modell der Anthropic PBC (USA) auswerten. Übermittelt werden nur Inhalte der öffentlichen Seite und ihre Adresse – keine Daten über dich (keine IP-Adresse, kein Konto). nope-mcp protokolliert die abgefragten Adressen.
- **Termine aus Partnerquellen:** Veranstaltungen aus öffentlichen Bildungskalendern werden automatisiert gespiegelt; sie enthalten keine Daten über dich.

## 8 Deine Rechte

Du hast das Recht auf Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18), Datenübertragbarkeit (Art. 20) und Widerspruch gegen Verarbeitungen auf Grundlage berechtigter Interessen (Art. 21 DSGVO). Wende dich dazu an die oben genannte E-Mail-Adresse. Für öffentlich auf Nostr veröffentlichte Inhalte gilt die Einschränkung aus Abschnitt 2.

Du hast außerdem das Recht, dich bei einer Datenschutz-Aufsichtsbehörde zu beschweren, zum Beispiel bei:
Die Landesbeauftragte für den Datenschutz Niedersachsen, Prinzenstraße 5, 30159 Hannover, poststelle@lfd.niedersachsen.de.

## 9 Änderungen

Wir passen diese Erklärung an, wenn sich die Verarbeitung ändert. Maßgeblich ist die jeweils auf dieser Seite veröffentlichte Fassung.
