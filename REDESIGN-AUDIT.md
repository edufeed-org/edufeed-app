# Redesign-Audit — Reste der alten Optik (Stand 2026-07-08)

Systematischer Durchgang (visuell alle Hauptrouten + Code-Scan auf Token-Verstöße)
nach der Umstellung auf das editoriale Theme. Konventionen, gegen die geprüft wurde:
Seite = beige `base-200`, Karten = Papier `base-100`, Chrome (Navbar/Sidebars/Toolbars)
= `base-200` ohne Border/Schatten, Dropdowns/Modals = Papier, Farben/Fonts nur über
Tokens (`--c-*`, DaisyUI-Semantik), kein Dark-Mode mehr.

Legende: 🔴 sofort sichtbar / hoher Traffic · 🟡 mittel · ⚪ Politur

> **Status (2026-07-08, Branch `fix/redesign-audit`):** A1–A6 und B1–B7 sind
> behoben; aus C sind die `text-white`-Buttons und die Radius-Literale
> umgesetzt. Bewusst offen gelassen (als optional markiert): `--c-scrim`/
> `--c-shadow`-Tokens für Scrims & Schatten sowie das Kontrast-Ink in
> `CalendarEventBar`. Empty-States (B6) laufen jetzt über die neue Komponente
> `src/lib/components/shared/EmptyState.svelte` (Dashboard-Feed, Posteingang,
> Community-Inhaltslisten); weitere Kandidaten können folgen.

---

## 🔴 A — Sofort sichtbar

### A1. `/calendar` ist eine weiße Seite

`src/routes/calendar/+page.svelte:14` wrappt die ganze Seite in `bg-base-100`.
Die Kalender-Hauptroute wirkt dadurch wie die alte weiße App neben den beigen Seiten.
→ Wrapper entfernen (Body-Beige durchlassen), Karten/Panels innen auf Papier.

### A2. Create-Flows haben noch den alten weißen Header-Balken

Weißer Top-Bar mit hartem `border-b border-base-300` über beiger Seite (visuell bestätigt):

- `src/routes/create/article/+page.svelte:176`
- `src/routes/create/wiki/+page.svelte:142`
- `src/routes/create/resource/[variant=resourceVariant]/+page.svelte:112`
  → Bar borderless machen und auf `base-200`/transparent stellen (wie Navbar-Konvention).

### A3. Kein gestaltetes Error-Page — nackte „404 Not Found"

Es existiert kein `+error.svelte` unter `src/routes`. Falsche URLs (z. B. alte Links)
rendern reinen Text oben links im Layout. → Editorial gestaltete Fehlerseite
(404/500) mit Zurück-Link.

### A4. Retirierte `dark:`-Varianten + Roh-Palette (aktiviert sich bei OS-Dark!)

`dark:`-Klassen laufen über die Media-Query und greifen bei Nutzern mit
OS-Dunkelmodus weiterhin — obwohl es kein Dark-Theme mehr gibt:

- `src/lib/components/calendar/RsvpStatusBadge.svelte:17,22,27` — `bg-green-100 …
dark:bg-green-900/30` etc. → `badge-success/-error/-warning` bzw. `bg-success/15 text-success`.
- `src/lib/components/CommunikeyCard.svelte:70,76,78` — Emerald-Palette + `dark:` für den
  „Beigetreten"-Zustand (Community-Discovery, hoher Traffic) → `success`-Tokens.
- `src/lib/components/educational/TypoCover.svelte:348` — totes `[data-theme='dark']`-Blöckchen (Cleanup).

### A5. Chrome trägt noch Border-Trennlinien

- `src/routes/c/+layout.svelte:101` — mobiler Community-Header `border-b border-base-300`
  (jede Community-Seite auf Mobil).
- `src/lib/components/community/layout/CompactCommunityHeader.svelte:27` — dito.
- `src/lib/components/shared/DetailHeader.svelte:67` — Back-Zeile mit `border-b`
  (JEDE Detailansicht: naddr/nevent/Artikel/Wiki/Ressource/Event).
- `src/lib/components/shared/MarkdownEditor.svelte:177` — Editor-Toolbar `border-b … bg-base-200`.

### A6. Nachrichten/DM-Splitview ist mit grauen Linien eingezäunt (visuell bestätigt)

- `src/routes/c/(dashboard)/messages/+page.svelte:90,93` — `border-l` außen, `border-r` Liste.
- `src/lib/components/dm/DmComposer.svelte:66`, `dm/ConversationThread.svelte:343`,
  `dm/ConversationList.svelte:80` — Panel-Header je `border-b`.
  → Panels als Papier-Flächen mit Abstand statt Border-Fences, oder Borders auf `--c-rule` reduzieren.

---

## 🟡 B — Mittel

### B1. Dropdowns/Popovers liegen auf `bg-base-200` statt Papier

Menüs sollen Papier (`base-100`) sein; diese sind invertiert (beige auf beige):
`bookmarks/BookmarkButton.svelte:141`, `bookmarks/ShareMenu.svelte:110`,
`bookmarks/WebBookmarkDetailView.svelte:690`, `bookmarks/SocialBookmarkDetailView.svelte:718`,
`calendar/EventTags.svelte:84`, `dashboard/DashboardFeedSelector.svelte:38`,
`shared/EventContextMenu.svelte:175`, `meet/InRoomView.svelte:423,501`,
`reactions/ReactionPicker.svelte:66`, `community/views/Chat.svelte:364`,
`dm/ConversationThread.svelte:471`.

### B2. Invertierte Karten (beige auf beige, z. T. alte Schatten)

- `src/routes/wiki/[topic]/+page.svelte:113` — Wiki-Themenliste `card bg-base-200` (fast unsichtbar).
- `community/stats/CalendarEventsStat.svelte:70` + `community/stats/MessagesStat.svelte:65`
  — Stat-Kacheln `bg-base-200 shadow` (Kinder der bereits umgestellten HomeView, übersehen).
- `forms/FormLinkManager.svelte:174` — `card bg-base-200 shadow-xl`.
- `calendar/CalendarManagement.svelte:413,440` — Empty-States als `hero … bg-base-200` (alte Hero-Wanne).

### B3. Eingebettete Nostr-Preview-Karten mit Alt-Styling

`shared/NostrPreviews/{Calendar,CalendarEvent,Article,Wiki,AMBResource}Preview.svelte`
— `bg-base-200` als Inset ist ok, aber `shadow-md` + Hover-Schatten sind die alte Kartenoptik.

### B4. Hardcodierte Farbliterale in prominenten Komponenten

- `educational/AMBResourceView.svelte:886` — `.ed-cover-framed { background:#fff }` → `var(--c-paper)`;
  `:1029` `rgba(255,255,255,.16)` → `color-mix` mit `--c-on-dark`.
- `profile/ProfileHeader.svelte:268`, `profile/ProfileRail.svelte:361`,
  `profile/ImpersonationWarning.svelte:181` — Avatar-/Banner-Gradient endet in
  hartkodiertem Lila `oklch(56% 0.13 290)` statt `--c-hero-2`; dazu `#fff` → `--c-on-dark`.
- `profile/ProfileTabEditor.svelte:159` — `color:#fff` → `--c-on-dark`.
- `comments/Comment.svelte:245` — „Jump-to-comment"-Flash in hartkodiertem Blau → `--color-info`-Mix.
- `AccountProfile.svelte:23` — `border-purple-400` → `border-primary/40` o. ä.

### B5. „Meine Inhalte"-Akzentpalette liegt außerhalb der Token-Ebene

`src/lib/helpers/myContentTypes.js:22-28` — Akzentfarben pro Inhaltstyp als rohe
`oklch()`-Literale, inline verwendet in `DashboardMyStuff.svelte:73` und
`ExpandableListCard.svelte:32`. Funktioniert im Editorial-Theme, aber stil/rpi-Deployments
können sie nicht umfärben. → als benannte Tokens/abgeleitete `color-mix`-Werte definieren.

### B6. Vier verschiedene Empty-State-Stile

Dashboard/Posteingang: umrandete beige Wanne · Community Wikis/Boards: rahmenloser
zentrierter Text · Meine Inhalte: Papierkarte mit Kacheln (schön!) · Profil: `pf-empty`
Papier mit gestrichelter Linie. → auf einen Stil einigen (Vorschlag: pf-empty-Optik).

### B7. i18n-Ausreißer im redesignten Discover

„Create Community"-Button (Communities-Tab) ist englisch auf deutscher UI;
ebenso „Add existing" auf der Community-Wiki-Seite.

---

## ⚪ C — Politur

- `text-white` auf DaisyUI-Buttons, die ihre Content-Farbe schon mitbringen:
  `calendar/InlineRsvp.svelte:193,218,243`, `waves/WaveButton.svelte:57`,
  `inbox/InboxItem.svelte:145` → `text-white` streichen bzw. `text-*-content`.
- Radius-Literale statt Tokens: `educational/MetadataCardGrid.svelte:107,126` (18/12px),
  `educational/TypoCover.svelte:138,149` (22/12px).
- `bg-black/40–50`-Scrims (GlobalFAB, ReactionPicker, AddToCalendarDropdown) — üblich,
  optional `--c-scrim`-Token.
- `rgba(0,0,0,x)`-Schattenliterale (ProfileHeader, AMBResourceView) — optional `--c-shadow`.
- `calendar/CalendarEventBar.svelte:35-39` — erzwungenes `#000` auf Nutzerfarben;
  Kontrast-Ink zentralisieren, falls behalten.

## Bewusst NICHT geflaggt (geprüft, absichtlich)

Karten-/Leaflet-Marker, QR-Codes (brauchen s/w), HighlightOverlay-/Annotation-Farben,
Cover-Hue-Mathematik (TypoCover/CoverColorPicker), Text über Bildern (LandingHero,
Discover-Hero), Meet-Videoflächen (inhärent dunkel), deterministische Autor-/Kind-Farben
(`nostrUtils.js generateKindColor/AuthorColor`), stil/rpi-Themes in app.css (env-gated).

## Empfohlene Reihenfolge

1. A1 Kalender-Seite (eine Zeile, größter Effekt)
2. A4 dark:-Reste (RsvpStatusBadge, CommunikeyCard) — echter Bug bei OS-Dark
3. A2 Create-Flow-Header + A5 Chrome-Borders (ein Sweep, gleiche Änderung)
4. A3 Error-Page (kleines neues Design)
5. A6 + B1 (DM-Splitview & Dropdown-Sweep)
6. B2–B7, dann C
