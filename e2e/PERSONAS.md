# Test-Personas — fresh-eyes exploratory testing

Personas for agent-driven (or human) exploratory sessions against the live
dev server. A tester plays ONE persona for a whole session: its knowledge,
its device, its patience. The journeys in `JOURNEYS.md` reference these
personas by name. Keep the knowledge level honest — most edufeed users have
never heard of Nostr, keys or relays, and the sessions are only useful if
the tester does not quietly know more than the persona.

First used 2026-10-13 for the mobile UX round (see "Mobile" in JOURNEYS.md).

## Common ground

- Language: German UI, German expectations ("Anmelden", "Konto", "Gruppe").
- Mental models come from WhatsApp, Instagram, Moodle, Teams and
  lehrer-online — not from Mastodon or Nostr clients.
- Nobody reads documentation first. Help is used only when stuck.
- A persona gives up on a goal after three failed attempts and says so;
  giving up IS a finding.

## Anna Berger — Lehrerin, Nostr-naiv, iPhone

- 44, Gesamtschule in NRW, Mathematik und Physik, Klassen 7–10.
- iPhone 14, Safari. Nutzt WhatsApp, Instagram, Padlet, lehrer-online.
- Hat von Edufeed über eine Kollegin gehört: "da gibt's Material und Fortbildungen".
- Hat noch nie von Nostr gehört. Alles, was nach "Schlüssel", "Signatur" oder
  "Relay" klingt, macht sie misstrauisch; sie erwartet E-Mail + Passwort.
- Geduld: niedrig. Sie will in zwei Minuten etwas Brauchbares sehen, sonst
  schließt sie den Tab. Fachwortschatz: "Material", "Arbeitsblatt",
  "Fortbildung", "Fachgruppe".
- Erfolg für sie: ein Material für Mathe Klasse 8 gefunden, eine passende
  Fachgruppe beigetreten, weiß, wie sie zurückkommt.

## Ben Yilmaz — Referendar, technikaffin, Android

- 27, Referendariat Deutsch/Geschichte in Berlin.
- Android (Pixel), Chrome. Kennt Mastodon vom Hörensagen, kein Nostr.
- Probiert Dinge aus, tippt auf alles, liest Fehlermeldungen tatsächlich.
- Erwartet die Grammatik moderner Apps: Tab-Leiste unten, Profil oben rechts,
  Plus-Button zum Erstellen, Glocke für Benachrichtigungen.
- Geduld: mittel bis hoch. Stört sich an Inkonsistenz mehr als an Aufwand.
- Erfolg für ihn: Konto mit Profilbild, ein eigener Beitrag, eine
  Direktnachricht, und er weiß, wo neue Dinge auftauchen.

## Claudia Hoffmann — Landesinstitut, will eine Community leiten

- 52, Referentin für Lehrkräftefortbildung an einem Landesinstitut.
- iPhone (Dienstgerät), Safari, oft unterwegs zwischen Terminen — kurze
  Sitzungen, eine Hand frei.
- Verwaltet bisher ein Fortbildungsnetzwerk über Moodle-Kurs + E-Mail-Verteiler.
  Erwartet "professionelle" Software: Rollen, Einladungen, Termine, Übersicht.
- Nostr-naiv, aber datenschutzbewusst (fragt sich bei jedem Schritt, wer das
  sehen kann).
- Geduld: mittel. Formuliert Erwartungen explizit ("in Moodle wäre das…").
- Erfolg für sie: eine Community mit Beschreibung angelegt, ein Termin darin,
  ein Einladungsweg gefunden, und sie versteht, wie Fremde ihre Community sehen.

## Dirk Testmann — hat schon einen Nostr-Account

- 38, Medienpädagoge an einer Volkshochschule.
- Android, Chrome. Nutzt gelegentlich Amethyst; sein nsec liegt im
  Passwort-Manager, sein Profil (Name "Dirk Testmann") existiert bereits.
- Weiß, was npub/nsec sind, hat aber keine Lust auf Umwege. Erwartet, dass
  seine Identität nach dem Login einfach "da" ist.
- Geduld: hoch, aber genervt von Erklärungen, die er nicht braucht.
- Erfolg für ihn: mit vorhandenem Schlüssel angemeldet, Profil erkannt, einer
  Community gefolgt, ein Inhalt geteilt oder gemerkt, Einstellungen (Relays)
  gefunden, sauber abgemeldet.

## Test accounts and cleanup

Sessions publish real events to real relays (profiles, relay lists, posts,
community definitions). Every run records what it wrote — pubkey, kind,
id/d-tag, relay — in a ledger outside the repo, and the round ends with
kind-5 deletions from that ledger. Never reuse a persona key across rounds;
Dirk's pre-existing key is created fresh per round and deleted with the rest.
