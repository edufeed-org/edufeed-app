# Buzz-Post-Entwurf: Groups-Architektur (10222 × NIP-29 × Concord)

**ENTWURF — nicht gepostet.** Das Posten in den Buzz-Design-Thread ist laocs
Entscheidung. Dieser Text ist ein Vorschlag, kein veröffentlichter Beitrag.

**Ziel-Thread:** Buzz-Design-Thread, Channel `c69a3dc3…`, Root-Post `3f4351e6…`
(„categories not protocols", `#`/🔒-Glyphen, Disclosure-Line — der Thread, der
als Design-Grundlage diente).

---

## Vorgeschlagener Post-Text (Deutsch)

Kurzes Update zum Groups-Design, das wir hier im Thread besprochen hatten:
Die Community-Architektur ist inzwischen vollständig in edufeed-app
umgesetzt — fünf Implementierungspläne, abgeschlossen am 13.08.2026.

**Drei Community-Typen, aus dem 10222 abgeleitet, nie separat deklariert:**

- **Offen** — das klassische 10222, keine Gruppe dahinter.
- **Moderiert** — 10222 + eine NIP-29-„Root-Gruppe" als öffentlich einsehbare
  Mitgliederliste. Beitritt per Join-Request, Invite-Code oder optionalem
  Anwendungsformular; Freigabe = NIP-29 `put-user`.
- **Geschlossen** — 10222-Hülle (Name, Bild, „nur auf Einladung") +
  Ende-zu-Ende-Engine-Pointer (aktuell Concord). Der Pointer benennt die
  Engine, „Geschlossen" bleibt aber ein Produktkonzept — eine spätere Engine
  bekäme einfach ihren eigenen Tag-Namen.

**Roster ist Wahrheit, Formulare sind nur noch Intake:** Die NIP-29-Roster der
Root-Gruppe (Mitglieder + Rollen) sind die einzige Mitgliedschaftsquelle für
moderierte Communities. Das alte Formular-/Badge-basierte Zugriffsmodell
(Profile-Lists, Badge-Definitionen) ist Legacy — nur noch lesbar, nicht mehr
neu geschrieben.

**Gating ist Write-Gating, nie Read-Gating:** Pro Content-Sektion lässt sich
festlegen, wer veröffentlichen darf — alle / nur Mitglieder / nur eine
bestimmte Rolle. Lesen bleibt für Offen/Moderiert immer öffentlich; Clients
filtern beim Rendern gegen das aktuelle Roster, serverseitige Durchsetzung
ist eine optionale Zusatzstufe.

**Eine Sidebar, zwei Zonen:** Die Community-Seite zeigt jetzt oben die
**Inhalte**-Zone (Materialien, Kalender, Artikel, … — wie Seiten aussehen)
und darunter die **Kanäle**-Zone (`#`/🔒-Zeilen aus Concord-Areas und
NIP-29-Gruppen — euer Glyphen-/Disclosure-Line-Design aus diesem Thread lebt
hier weiter). Besucher:innen sehen Inhalte + weltoffene Kanäle + einen
Beitritts-Hinweis; 🔒-Kanäle nur für Mitglieder.

**Erstellungs-Assistent:** Profil → Typ → Inhalte → Personen. Der Typ kommt
bewusst früh, weil er die späteren Schritte prägt — Protokollnamen tauchen
in der UI nirgends auf.

Die normative Spezifikation liegt jetzt als NIP-Entwurf vor und ist bereit
für externes Review:
`docs/nips/communikey-groups.md` (im edufeed-app-Repo, Branch
`feat/community-group-pointer`) — versteht sich als Nachfolger der
Design-Entscheidungen aus diesem Thread (Kategorien statt Protokolle,
`#`/🔒 statt Protokoll-Tabs, Disclosure-Line) und schreibt sie für die
Community-Ebene (10222) fort.

Bewusst noch offen gelassen (siehe NIP-Entwurf, Abschnitt „Future
extensions"): entdeckbare Geschlossen-Communities über Armada-artige
Einladungslinks mit Ablaufdatum — kommt, wenn's gebraucht wird.

Feedback und Fragen gerne hier im Thread oder direkt am NIP-Entwurf.

---

## Notizen für laoc (nicht Teil des Post-Texts)

- Quelle für die Zusammenfassung: `docs/superpowers/specs/2026-08-12-groups-architecture-design.md`
  (Status: COMPLETE) und `docs/nips/communikey-groups.md`.
- Der Post verlinkt bewusst nur auf den NIP-Entwurf, nicht auf einzelne
  Plan-/Task-Dokumente (die sind SDD-intern, kein Community-Publikum).
- Ton/Länge orientiert sich am Thread-Vorbild (kurze Absätze, keine
  Protokoll-Jargon-Dichte, Beispiele statt Tag-Syntax) — Tag-Tabellen bleiben
  im NIP-Entwurf, nicht im Post.
- Falls gewünscht, lässt sich ein Kurz-Update-Kommentar (statt Vollpost)
  daraus ableiten — dieser Entwurf ist der ausführliche Fall.
