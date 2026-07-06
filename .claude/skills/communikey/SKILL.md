---
name: communikey
description: Communikey protocol for Nostr communities. Use when implementing community creation, membership (join/leave), targeted publications, or working with kinds 10222, 30382, 30222. Covers community definition events, relationship events, and cross-community content sharing.
---

# Communikey Protocol

A standard for creating, managing, and publishing to communities on Nostr using existing key pairs and relays.

## Key Principles

- Any existing npub can become a community (the pubkey IS the community identifier)
- Any existing publication can be targeted at multiple communities
- Communities define their own content types and publishing conditions
- No relay-specific implementations required

## Event Kinds

| Kind | Type | Purpose |
|------|------|---------|
| 10222 | Replaceable | Community definition |
| 30382 | Addressable | Community relationship (join/leave) |
| 30222 | Addressable | Targeted publication |

---

## Kind 10222: Community Definition

A community is created when a keypair publishes a kind 10222 event. The pubkey becomes the unique community identifier. Community name, picture, and description come from the pubkey's kind 0 metadata.

```json
{
  "kind": 10222,
  "pubkey": "<community-pubkey>",
  "tags": [
    ["r", "<relay-url>"],
    ["blossom", "<blossom-url>"],
    ["mint", "<mint-url>", "cashu"],
    ["strict", "content"],

    ["content", "Chat"],
    ["k", "9"],

    ["content", "Calendar"],
    ["k", "31922"],
    ["k", "31923"],

    ["content", "Article"],
    ["k", "30023"],
    ["a", "30009:<pubkey>:writer"],

    ["location", "<location>"],
    ["g", "<geohash>"],
    ["description", "Override profile description"]
  ],
  "content": ""
}
```

### Tag Reference

| Tag | Purpose |
|-----|---------|
| `r` | Relay URLs (first is main relay) |
| `blossom` | Blossom server URLs |
| `mint` | Cashu mint URL |
| `content` | Content type section name |
| `k` | Event kind (within content section) |
| `strict` | `["strict", "content"]` — content sections are exhaustive (see below) |
| `fee` | `[kind, amount, "sat"]` admission fee |
| `exclusive` | `"true"` if content ONLY for this community |
| `a` | Badge requirement `30009:<pubkey>:<badge-id>` |
| `location` | Community location |
| `g` | Geohash |
| `description` | Override profile description |

### Strict Content Declarations

The bare marker tag `["strict", "content"]` declares that the event's content sections are an exhaustive, owner-reviewed list. Clients then filter navigation tabs and content-creation UIs down to the declared kinds.

Read rules (clients MUST fail open):

- No community event loaded → show everything
- No `["strict", "content"]` marker → legacy definition; declarations are advisory only, show everything
- Marker present but zero `content` sections → show everything
- Marker present + content sections → filter tabs/actions to the declared kinds

Write rule: clients whose editing UI presents the full content-type vocabulary (so a save is a deliberate, exhaustive choice) always write the marker. When editing a legacy definition, pre-enable all content types so saving preserves the status quo and the owner unchecks deliberately.

Rationale: legacy definitions were written by clients that displayed all content types regardless of declarations. Filtering on their section lists would silently hide existing community content after an app update.

---

## Kind 30382: Community Membership

Membership uses addressable replaceable events with the community pubkey as the `d` tag.

### Join Community

```json
{
  "kind": 30382,
  "pubkey": "<user-pubkey>",
  "tags": [
    ["d", "<community-pubkey>"],
    ["n", "follow"],
    ["p", "<community-pubkey>"]
  ],
  "content": ""
}
```

### Leave Community

Publish a replacement without the `n` tag:

```json
{
  "kind": 30382,
  "pubkey": "<user-pubkey>",
  "tags": [
    ["d", "<community-pubkey>"]
  ],
  "content": ""
}
```

### Query User's Communities

```javascript
// Filter for user's memberships
{
  kinds: [30382],
  authors: [userPubkey]
}

// Then filter events where n tag = "follow"
events.filter(e => e.tags.find(t => t[0] === 'n' && t[1] === 'follow'))
```

### Query Community Members

```javascript
{
  kinds: [30382],
  '#d': [communityPubkey],
  '#n': ['follow']
}
```

---

## Kind 30222: Targeted Publication

Targets existing content at one or more communities (max 12).

```json
{
  "kind": 30222,
  "pubkey": "<author-pubkey>",
  "tags": [
    ["d", "<unique-id>"],
    ["e", "<event-id>"],
    ["k", "<kind-of-content>"],
    ["p", "<community1-pubkey>"],
    ["r", "<community1-relay>"],
    ["p", "<community2-pubkey>"],
    ["r", "<community2-relay>"]
  ],
  "content": ""
}
```

### Reference Types

**Event reference (`e` tag):**
```json
["e", "<event-id>", "<relay-hint>", "<pubkey-hint>"]
```

**Addressable reference (`a` tag):**
```json
["a", "<kind>:<pubkey>:<d-tag>", "<relay-hint>"]
```

### Query Targeted Publications for Community

```javascript
{
  kinds: [30222],
  '#p': [communityPubkey],
  '#k': ['31922', '31923']  // Optional: filter by content kind
}
```

---

## Exclusive Content (h-tag)

For content types marked `exclusive: true` (chat, forum), use direct `h` tag instead of targeted publication:

```json
{
  "kind": 9,
  "tags": [
    ["h", "<community-pubkey>"]
  ],
  "content": "Hello community!"
}
```

### Query Exclusive Content

```javascript
{
  kinds: [9],
  '#h': [communityPubkey]
}
```

---

## Combining Direct + Targeted Content

To get all content for a community, query both:

1. **Direct content** with `h` tag
2. **Targeted publications** with `p` tag, then resolve references

```javascript
// Direct content
const directFilter = {
  kinds: [31922, 31923],
  '#h': [communityPubkey]
};

// Targeted publications
const targetedFilter = {
  kinds: [30222],
  '#p': [communityPubkey],
  '#k': ['31922', '31923']
};

// Resolve: extract e/a tags from targeted pubs, fetch those events
```

---

## Badge-Based Permissions

Communities can require badges for publishing certain content:

```json
["content", "Article"],
["k", "30023"],
["a", "30009:<community-pubkey>:writer"]
```

Only users with the `writer` badge awarded by the community can publish articles.

---

## Best Practices

1. **Publish membership to user's write relays** (NIP-65) for sovereignty
2. **Cache community metadata** (kind 10222) to reduce queries
3. **Verify targeted publications exist on community's main relay**
4. **Check for deletion events** when processing relationships
5. **Use reactive queries** that update when membership changes

---

## Community Identifier Format

```
ncommunity://<pubkey>?relay=<url-encoded-relay>
```

Follows same pattern as `nprofile` but for communities.
