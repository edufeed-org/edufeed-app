# Kind 30146 (learning module): the NIP-89 handler

The spec of kind 30146 is the wiki article `edufeed-learning-module`
(edufeed/wikis). Generic clients learn how to open a 30146 from a
kind 31990 handler event. It is published once by the **edufeed key**
(the same key that signs the wiki articles), so the command below is run
by the key holder, not by the app.

Two `web` entries: the LiaScript player, which loads any naddr and renders
the content as a course, and edufeed's own naddr route. The app reads
handlers from `APP_HANDLER_RELAYS` (default `wss://relay.primal.net`), so
the event goes there and to the edufeed relay.

```sh
nak event -k 31990 \
  -t d=edufeed-learning-module \
  -t k=30146 \
  -t 'web=https://liascript.github.io/course/?nostr:<bech32>;naddr' \
  -t 'web=https://edufeed.org/<bech32>;naddr' \
  -c '{"name":"edufeed","display_name":"edufeed","about":"Offene Bildungsmaterialien, Lehrplanbezug und Unterrichtsplanung auf Nostr. Kind 30146 = Lernmodul (LiaScript-Kurs oder Markdown).","website":"https://edufeed.org","picture":"https://edufeed.org/og-default.png"}' \
  --sec "$(cat <path to the edufeed nsec>)" \
  wss://relay.edufeed.org wss://relay.primal.net wss://relay.damus.io
```

Notes

- `nak -t` splits on `;` for multi-value tags, so `web=<url>;naddr` becomes
  `["web", "<url>", "naddr"]`.
- `<bech32>` is literal: NIP-89 clients substitute the event's naddr.
- Re-running the command with the same `d` replaces the handler (addressable).
- Verify: `nak req -k 31990 -t k=30146 wss://relay.primal.net`.
- Users recommend the handler with a kind 31989 (`d=30146`, an `a` tag to
  the 31990) — the app's `AppHandlerList` shows recommendations by the user
  and their follows first, then this direct `#k` query.
