# Scripts

One-off publishing scripts for edufeed defaults. All require a private key
in `EDUFEED_PUBLISHER_NSEC` (hex) and a comma-separated relay list in
`EDUFEED_PUBLISH_RELAYS`.

## publish:vocabs

Publishes edufeed default vocabularies (Schulfächer, HCRT) as kind 39737.
Logs the naddr of each scheme on success.

```
pnpm run publish:vocabs
```

## publish:forms

Publishes edufeed default form templates (`amb-basic`) as kind 30168,
with `field-vocab` tags pointing at the vocabs from `publish:vocabs`.
Reads scheme naddrs from `SCHEME_NADDR_SCHULFAECHER` and
`SCHEME_NADDR_HCRT` in env (paste them from the output of the previous
step).

```
pnpm run publish:forms
```
