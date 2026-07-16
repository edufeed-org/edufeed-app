# Edufeed - Decentralized Community App with a Calendar and other stuff

[![Node.js](https://img.shields.io/badge/Node.js-v22.16.0-green)](https://nodejs.org/) [![SvelteKit](https://img.shields.io/badge/SvelteKit-2.1.2-orange)](https://kit.svelte.dev/) [![Docker](https://img.shields.io/badge/Docker-Ready-blue)](https://www.docker.com/)

Comcal is a decentralized community management and calendar platform built on the **Nostr protocol**. It enables communities to create events, coordinate activities, and share calendars without relying on centralized services. All data is sovereign and stored on Nostr relays—your community maintains full control.

## Table of Contents

- [What is Comcal?](#what-is-comcal)
- [Key Features](#key-features)
- [Technology Stack](#technology-stack)
- [Quick Start (Development)](#quick-start-development)
- [Development Guide](#development-guide)
- [Deployment](#deployment)
- [Architecture](#architecture)
- [Resources](#resources)

---

## What is Comcal?

Comcal (Community Calendar) provides communities with a **sovereign, decentralized alternative** to centralized calendar and community management tools. Built on the Nostr protocol, it implements:

- [**NIP-52**](https://wikistr.com/nip-52*dd664d5e4016433a8cd69f005ae1480804351789b59de5af06276de65633d319): Calendar Events standard for event management
- [**Communikey NIP**](https://wikistr.com/nip-communikey*a9434ee165ed01b286becfc2771ef1705d3537d051b387288898cc00d5c885be): Community operations and management

Communities maintain full autonomy—no central server, no data lock-in, no platform dependency. Users authenticate with their private keys, ensuring complete control over their identity and data.

### Use Cases

- **Community Organizers**: Manage events and coordinate activities
- **Educational Institutions**: Coordinate study groups, lectures, and events
- **Interest-Based Communities**: Share calendars and coordinate meetings
- **Any Group**: Needing sovereign event coordination without centralized infrastructure

## Key Features

- ✅ **Community Management**: Create, join, and manage communities with full autonomy
- ✅ **Calendar System**: Decentralized calendar events with NIP-52 compliance
- ✅ **Multi-Calendar Support**: Personal and community-level calendars
- ✅ **Calendar Sharing**: Multiple sharing mechanisms (webcal, QR codes, direct links)
- ✅ **Private Key Authentication**: Secure, sovereignty-preserving authentication
- ✅ **Social Features**: Community feeds, member profiles, and interaction
- ✅ **Map Integration**: Location-based event discovery
- ✅ **Markdown Support**: Rich text content in events and profiles

## Technology Stack

| Category               | Technology             | Version                |
| ---------------------- | ---------------------- | ---------------------- |
| **Runtime**            | Node.js                | v22.16.0               |
| **Frontend Framework** | SvelteKit              | 2.1.2                  |
| **Svelte Version**     | Svelte                 | 5.0.0                  |
| **Styling**            | TailwindCSS            | 3.4.10                 |
| **Components**         | DaisyUI                | 4.12.10                |
| **State Management**   | Svelte 5 Runes         | Native                 |
| **Protocol**           | Nostr                  | NIP-52, Communikey NIP |
| **Nostr Libraries**    | Applesauce Suite       | Latest                 |
| **Deployment**         | Docker + Traefik       | Production-ready       |
| **Adapter**            | @sveltejs/adapter-node | 6.0.0                  |

## Quick Start (Development)

### Prerequisites

- **Node.js**: v22.16.0
- **pnpm**: Package manager
- **Git**: For cloning the repository

### Option A: NixOS / Nix (Recommended)

If you use NixOS or have Nix installed, the project includes a `flake.nix` that provides the exact development environment:

```bash
# Clone the repository
git clone <repository-url> comcal
cd comcal

# Allow direnv (auto-activates the environment)
direnv allow

# Install dependencies
pnpm install
```

The flake provides Node.js 22 and pnpm. With direnv configured, the environment activates automatically when you enter the project directory.

**First-time Nix setup:** Ensure you have `direnv` and `nix-direnv` installed, and flakes enabled in your Nix config (`experimental-features = nix-command flakes`).

### Option B: Traditional Setup

```bash
# Clone the repository
git clone <repository-url> comcal
cd comcal

# Use correct Node version (if using nvm)
nvm use

# Install dependencies
pnpm install
```

### Running the Development Server

```bash
# Start the dev server (runs on http://localhost:5173)
pnpm run dev

# Or open automatically in browser
pnpm run dev -- --open
```

### Building for Production

```bash
# Build the application
pnpm run build

# Preview production build locally
pnpm run preview
```

---

## Development Guide

### Available Scripts

```bash
# Development
pnpm run dev             # Start dev server with hot reload

# Production
pnpm run build           # Build for production (Node adapter)
pnpm run preview         # Preview production build

# Code Quality
pnpm run lint            # Run ESLint
pnpm run format          # Format code with Prettier

# Docker
docker compose build     # Build Docker image
docker compose up -d     # Start containers in background
docker compose logs -f   # View logs
```

### Development Workflow

1. **Start the dev server**: `pnpm run dev`
2. **Make changes**: Edit components, stores, or helpers
3. **See hot reload**: Changes apply instantly in the browser
4. **Run linting**: `pnpm run lint` to check code quality
5. **Format code**: `pnpm run format` to maintain style consistency

### Key Technologies in Use

- **SvelteKit**: Full-stack framework with server routes and API endpoints
- **Svelte 5 Runes**: Reactive state management with `$state`, `$derived`, `$effect`
- **TailwindCSS**: Utility-first CSS for styling
- **DaisyUI**: Component library on top of Tailwind
- **Nostr Protocol**: Decentralized event protocol
- **Applesauce**: Suite of libraries for Nostr interaction

### Theming & Customization

Comcal supports **customizable themes** for institutional branding:

| Theme       | Description                                 |
| ----------- | ------------------------------------------- |
| `light`     | Default light theme                         |
| `dark`      | Default dark theme                          |
| `stil`      | STIL institutional branding (orange accent) |
| `stil-dark` | STIL dark variant                           |

Users can choose between theme families and light/dark/system color modes via Settings.

**Configuration** (`.env`):

```env
THEME_DEFAULT_LIGHT=stil       # Default theme for light mode
THEME_DEFAULT_DARK=stil-dark   # Default theme for dark mode
```

**Icons** are organized in `src/lib/components/icons/` by category (ui, actions, social, calendar) with a consistent wrapper pattern using `currentColor` for theme compatibility.

See `CLAUDE.md` for detailed developer documentation on theming and icons.

## Deployment

Comcal is designed for production deployment using Docker and Traefik. This section covers deploying to a VPS or self-hosted server.

### Prerequisites for VPS/Server Deployment

- **OS**: Ubuntu 20.04+ or similar Linux distribution
- **Docker**: Latest version
- **Docker Compose**: v2+ with plugin support
- **Domain Name**: For SSL certificates via Let's Encrypt
- **Ports**: 80 and 443 publicly accessible
- **Resources**: 512MB RAM minimum (1GB recommended), 1-2GB storage

### Prerequisites for Local Development

See [Quick Start](#quick-start-development) section above.

### Step 1: Server Setup

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose v2+
sudo apt install docker-compose-plugin

# Add user to docker group (optional, for non-root docker access)
sudo usermod -aG docker $USER
newgrp docker
```

### Step 2: Clone Repository

```bash
# Clone the repository
git clone <repository-url> comcal
cd comcal
```

### Step 3: Configure Environment Variables

Comcal uses a **12-factor app approach** with runtime environment variables for configuration. This allows you to use the same Docker image across different environments (development, staging, production) by simply changing environment variables.

```bash
# Copy environment template
cp .env.example .env

# Edit environment variables
nano .env
```

#### Required Environment Variables

```env
# Your domain (required for SvelteKit CSRF protection)
ORIGIN=https://your-domain.com

# Internal service port (usually 3000)
PORT=3000

# Node environment
NODE_ENV=production
```

#### Complete Configuration Reference

The `.env.example` file contains all available configuration options. Key categories:

**App Branding**

- `APP_NAME`: Application name (default: "ComCal")
- `APP_LOGO`: URL to application logo
- `APP_GIT_REPO`: Git repository URL

**Nostr Relays**

- `FALLBACK_RELAYS`: Fallback relays for event discovery (used when gated mode is off)
- `CALENDAR_RELAYS`: App-specific relays for calendar events (kinds 31922-31925)
- `COMMUNIKEY_RELAYS`: App-specific relays for community events (kinds 10222, 30222)
- `AMB_RELAYS`: Educational content relays with NIP-50 search support (kind 30142)
- `LONGFORM_CONTENT_RELAY`: App-specific relay for articles (kind 30023)

**Gated Mode**

- `GATED_MODE_DEFAULT`: Default state for gated mode (true/false). When enabled, app fetches only from app-specific relays
- `GATED_MODE_FORCE`: When true, users cannot disable gated mode - useful for institutional deployments

**Curated Mode**

- `CURATED_PUBKEYS_SETS`: Comma-separated NIP-19 naddr identifiers pointing to kind 30000 follow sets. When set, only content from pubkeys in these follow sets is shown for primary content (calendar events, AMB resources, articles, community definitions). Social content (reactions, comments, chat, targeted publications) is not filtered. Leave empty to disable.
- `CURATED_PUBKEYS`: Comma-separated hex pubkeys or npub-encoded pubkeys for direct curated author filtering. These are unioned with pubkeys from `CURATED_PUBKEYS_SETS`. If either has entries, curated mode is active. Simpler than follow sets for small deployments.

**WoT (Web of Trust) Mode**

WoT extends curated mode by using anchor pubkeys' follow graphs. Anchor pubkeys' kind 3 contact lists are fetched at startup, and their follows become allowed authors. The effective author set is the union of curated authors, WoT anchors, WoT follows, and (optionally) the logged-in user's own follows.

- `WOT_ENABLED`: Enable WoT content filtering (true/false, default: false)
- `WOT_INCLUDE_USER_FOLLOWS`: Include logged-in user's own follows as allowed authors (true/false, default: true)
- `WOT_ANCHOR_PUBKEYS`: Global anchor pubkeys (hex or npub, comma-separated). These pubkeys + their follows become allowed authors for all categories
- `WOT_ANCHOR_PUBKEYS_CALENDAR`: Per-category anchor override (replaces global for calendar). Same pattern for `_COMMUNIKEY`, `_EDUCATIONAL`, `_LONGFORM`, `_KANBAN`

**Calendar Settings**

- `CALENDAR_WEEK_START_DAY`: Week start day (0=Sunday, 1=Monday)
- `CALENDAR_LOCALE`: Date/time locale (e.g., de-DE, en-US)
- `CALENDAR_TIME_FORMAT`: Time format (12h or 24h)

**Signup**

- `SIGNUP_SUGGESTED_COMMUNITIES`: Communities pre-checked in the signup step-3 picker (comma-separated npubs or hex pubkeys). Leave empty to disable.

**Membership & NIP-05 Handles**

Lets users apply for a memorable `name@<domain>` handle during signup. Requires a separately deployed [nip-05-service](https://git.edufeed.org/edufeed/nip-05-service) instance — the app proxies admin approvals to it, it does not host its own NIP-05 backend.

- `MEMBERSHIP_ENABLED`: Feature flag (true/false). When false, signup step 4 and the settings card are hidden
- `NIP05_HANDLE_DOMAIN`: Single domain handles are issued under (e.g. `edufeed.org`). Used for UI labels and for the live availability check against `https://<domain>/.well-known/nostr.json`
- `MEMBERSHIP_FORM_ADDRESS`: Kind 30168 form template address in the form `30168:<admin-pubkey-hex>:membership`. Published once via `scripts/publish-membership-form.js`
- `MEMBERSHIP_ADMIN_PUBKEYS`: Hex pubkeys allowed to see `/admin/membership` (comma-separated). The same allowlist is enforced server-side by `/api/nip05` — only NIP-98 events signed by one of these pubkeys are forwarded
- `NIP05_SERVICE_URL`: **SECRET** — Base URL of the standalone nip-05-service. Server-only (never sent to the browser)
- `NIP05_SERVICE_API_KEY`: **SECRET** — Bearer token for the nip-05-service admin API. Server-only

**Media Uploads (Blossom)**

- `BLOSSOM_UPLOAD_ENDPOINT`: Blossom server upload endpoint
- `BLOSSOM_MAX_FILE_SIZE`: Maximum file size in bytes (app-side limit; not enforced by the Blossom server itself)

**Metadata Cleaner (optional)**

Optional quiet opt-in backed by a [metadata-cleaner](https://git.edufeed.org/edufeed/metadata-cleaner) service instance. For supported files (PDF, JPG/JPEG, PNG, TIF/TIFF, WebP), the license modal shows an unchecked "remove hidden file metadata" checkbox (plus a compress select for PDFs) and a "show details" link into a read-only inspect view — no interstitial interrupts the normal upload flow. If ticked, stripping (and compression) happens silently during the deferred upload step and the cleaned bytes go to Blossom; a subtle confirmation note appears on the file row afterwards, and the cleaner failing never blocks the upload. The one interruption is a PDF over `BLOSSOM_MAX_FILE_SIZE`: it auto-opens a compression-first rescue modal (balanced preselected) before the upload proceeds, since compression may bring it under the limit.

- `METADATA_CLEANER_URL`: **SECRET** — Base URL of the metadata-cleaner service (e.g. `https://cleaner.edufeed.org`). Server-only, proxied via `/api/metaclean`; when unset the feature is hidden entirely
- `METADATA_CLEANER_MAX_UPLOAD_MB`: Maximum body size the `/api/metaclean` proxy accepts, in MB (default 200, matching the service's own limit). Deliberately independent of `BLOSSOM_MAX_FILE_SIZE`
- Deployment note: with adapter-node, `BODY_SIZE_LIMIT` (default 512K) must be raised above the proxy cap, or uploads to `/api/metaclean` are rejected before the route runs

**Geocoding (OpenCage API)**

- `GEOCODING_API_KEY`: **SECRET** - OpenCage API key (never expose to client)
- `GEOCODING_CACHE_DURATION_DAYS`: Cache duration for geocoded results
- `GEOCODING_MIN_ADDRESS_LENGTH`: Minimum address length for geocoding
- `GEOCODING_MIN_CONFIDENCE_SCORE`: Minimum confidence score (0-10)
- `GEOCODING_REQUIRE_ADDRESS_COMPONENTS`: Require address components (true/false)
- `GEOCODING_ACCEPTED_COMPONENT_TYPES`: Accepted component types (comma-separated)

**Imprint/Legal Information**

- `IMPRINT_ENABLED`: Enable/disable imprint page
- `IMPRINT_ORGANIZATION`: Organization name
- `IMPRINT_ADDRESS_*`: Address fields
- `IMPRINT_CONTACT_*`: Contact information
- `IMPRINT_*`: Other legal information

**Educational Content**

- `EDUCATIONAL_SEARCH_DEBOUNCE_MS`: Search debounce delay
- `EDUCATIONAL_VOCAB_*`: SKOS vocabulary keys

See `.env.example` for complete documentation of all variables with descriptions and defaults.

#### Security Best Practices

1. **Never commit `.env` files** - They are in `.gitignore` by default
2. **Protect API keys** - The `GEOCODING_API_KEY` is kept server-side only
3. **Use strong values** - Especially for production deployments
4. **Rotate secrets regularly** - Update API keys periodically
5. **Environment-specific configs** - Use different `.env` files for dev/staging/production

### Step 4: Configure Docker Compose

Edit `docker-compose.yml` and update:

1. **Service name** (if needed): Default is `comcal`
2. **Domain**: Replace `your-domain.com` with your actual domain in Traefik labels
3. **Traefik network**: Ensure `traefik_web` matches your Traefik setup

Example Traefik configuration:

```yaml
labels:
  - 'traefik.http.routers.comcal.rule=Host(`your-domain.com`)'
  - 'traefik.http.routers.comcal.entrypoints=websecure'
  - 'traefik.http.routers.comcal.tls.certresolver=letsencrypt'
```

### Step 5: Build and Deploy

```bash
# Build the Docker image
docker compose build

# Start the application in detached mode
docker compose up -d

# View real-time logs
docker compose logs -f
```

## Architecture

- [Nostr Event Kinds](#nostr-event-kinds)
- [Membership & NIP-05 Handle Provisioning](#membership--nip-05-handle-provisioning)

### Nostr Event Kinds

Comcal uses the following Nostr event kinds:

| Kind  | NIP        | Description                       |
| ----- | ---------- | --------------------------------- |
| 0     | NIP-01     | User profile (metadata)           |
| 3     | NIP-02     | Contact list                      |
| 5     | NIP-09     | Deletion event                    |
| 7     | NIP-25     | Reaction                          |
| 8     | NIP-58     | Badge award                       |
| 9     | —          | Chat message                      |
| 14    | NIP-17     | Private direct message (rumor)    |
| 1059  | NIP-17     | Gift wrap (sealed DM envelope)    |
| 1069  | —          | Form response                     |
| 1111  | NIP-22     | Comment                           |
| 10002 | NIP-65     | Relay list (outbox model)         |
| 10063 | —          | Blossom server list               |
| 10222 | Communikey | Community definition              |
| 30002 | NIP-51     | Relay set (user relay overrides)  |
| 30009 | NIP-58     | Badge definition                  |
| 30142 | AMB        | Educational resource (OER)        |
| 30168 | —          | Form template                     |
| 30222 | Communikey | Targeted publication              |
| 30301 | —          | Kanban board                      |
| 30000 | NIP-51     | Follow set (community membership) |
| 31922 | NIP-52     | Date-based calendar event         |
| 31923 | NIP-52     | Time-based calendar event         |
| 31924 | NIP-52     | Calendar collection               |
| 31925 | NIP-52     | Calendar RSVP                     |

See `CLAUDE.md` for the full reference including implementation details.

### Membership & NIP-05 Handle Provisioning

Edufeed-style deployments hand out memorable `name@<domain>` handles (NIP-05) to vetted members. The app **does not** run its own NIP-05 backend — it integrates with a separately deployed [nip-05-service](https://git.edufeed.org/edufeed/nip-05-service).

**Components:**

- **Application form** (in-app): rendered as signup step 4 and as a settings card. Submits a kind 1069 form response addressing the kind 30168 membership form template. The wished handle is sent NIP-44-encrypted to admin pubkeys.
- **Admin review** (in-app, `/admin/membership`): lists pending applications, gated by `MEMBERSHIP_ADMIN_PUBKEYS`. Each row shows the applicant's profile and decrypted wished handle, with live status against the upstream NIP-05 directory (available / already taken / already mapped to applicant).
- **Approval proxy** (server-side, `/api/nip05`): SvelteKit endpoint that re-authenticates the admin via NIP-98, verifies their pubkey is on the allowlist, then forwards a `POST` to the standalone nip-05-service with `NIP05_SERVICE_API_KEY`. The browser never sees the API key.
- **Applicant notification**: on successful approval, the admin browser sends a NIP-17 wrapped DM (kind 1059) to the applicant with the activated handle.
- **Add-to-profile**: a CTA appears in the applicant's settings card once `/.well-known/nostr.json` lists their handle. One click writes `nip05: name@<domain>` to their kind 0 profile.

**Operator setup checklist:**

1. Deploy the standalone nip-05-service (see its own README) and note its base URL and admin Bearer token.
2. In this app's `.env`, set `MEMBERSHIP_ENABLED=true`, `NIP05_HANDLE_DOMAIN`, `MEMBERSHIP_ADMIN_PUBKEYS`, `NIP05_SERVICE_URL`, `NIP05_SERVICE_API_KEY`.
3. Bootstrap the form template once with the admin key:

   ```bash
   ADMIN_NSEC=nsec1… node scripts/publish-membership-form.js
   ```

   Copy the printed `30168:<pubkey>:membership` address into `MEMBERSHIP_FORM_ADDRESS` and restart.

4. Sign in as an admin pubkey and verify `/admin/membership` is reachable.

## Resources & Support

### Protocol Documentation

- **[Nostr Protocol](https://nostr.com)**: Overview of the Nostr protocol
- **[NIP-52: Calendar Events](https://github.com/nostr-protocol/nips/blob/master/52.md)**: Calendar event standard
- **[Communikey NIP](https://wikistr.com/nip-communikey)**: Community operations specification

### Framework & Libraries

- **[SvelteKit Documentation](https://kit.svelte.dev)**: Full framework documentation
- **[SvelteKit Node Adapter](https://github.com/sveltejs/kit/tree/main/packages/adapter-node)**: Node.js deployment
- **[Svelte 5 Documentation](https://svelte.dev)**: Latest Svelte features
- **[TailwindCSS](https://tailwindcss.com)**: Utility-first CSS framework
- **[DaisyUI](https://daisyui.com)**: Tailwind component library

### Deployment & Infrastructure

- **[Docker Documentation](https://docs.docker.com)**: Containerization platform
- **[Traefik Documentation](https://doc.traefik.io)**: Reverse proxy and load balancer
- **[Let's Encrypt](https://letsencrypt.org)**: Free SSL/TLS certificates

### Getting Help

1. **Check Troubleshooting**: See [Troubleshooting](#troubleshooting) section above
2. **Review Logs**: Use `docker compose logs` for application logs
3. **Open Issues**: Report bugs on the repository
4. **Community**: Join Nostr communities discussing comcal

---

## Funding

This project was funded by the BMBSFJ.

Förderkennzeichen: 01PZ24007

![Logo BMBSFJ](/static/BMBFSFJ.png)

Further development happens under funding of Stiftung Innovation in der Hochschullehre:

![Logo STIL](https://blossom.edufeed.org/c9a88acfbf57042191cfb97bafd288436ae959dd0239d5d47b91aa66465205a3.webp)

## Contributing

Contributions are welcome!

**Built with ❤️ on the Nostr protocol.**
