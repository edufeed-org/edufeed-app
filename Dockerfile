# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files, lockfile, and patches
COPY package.json pnpm-lock.yaml ./
COPY patches/ ./patches/

# Install git (needed by pnpm/corepack in some paths) and enable pnpm
RUN apk add --no-cache git && corepack enable && corepack prepare pnpm@10.28.0 --activate

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# The commit being built (CI passes --build-arg GIT_SHA=<sha>; .git is not in
# the build context). scripts/app-version.mjs appends its short form to the
# version name so SvelteKit's update detection and the issue-report version
# can tell :dev images between releases apart.
ARG GIT_SHA
ENV GIT_SHA=$GIT_SHA

# Build the application. The live heap peaks at about 3.5 GB (8624 client
# modules, measured 2026-11-23 with --trace-gc; the build also passes at 4096,
# peak RSS 4.7 GB). It needed 8192 before scripts/vite-plugin-paraglide-named-
# reexports.mjs: if this OOMs again, check that plugin still matches
# Paraglide's generated messages/_index.js before raising the cap.
RUN NODE_OPTIONS=--max-old-space-size=6144 pnpm run build

# Production stage
FROM node:22-alpine

WORKDIR /app

# Install git (needed by pnpm/corepack in some paths) and enable pnpm
RUN apk add --no-cache git && corepack enable && corepack prepare pnpm@10.28.0 --activate

# Copy package files, lockfile, and patches
COPY package.json pnpm-lock.yaml ./
COPY patches/ ./patches/

# Install production dependencies only (--ignore-scripts skips husky prepare hook)
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# Copy built application from builder
COPY --from=builder /app/build ./build

# Legal texts a deployment can point PRIVACY_POLICY_PATH at (relative to /app)
COPY --from=builder /app/legal ./legal

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# No chown -R /app: a separate RUN chown duplicates every copied file into a
# ~400MB layer (the registry's slowest blob), and the app never writes under
# /app — root-owned world-readable files are exactly right for a read-only
# runtime; the PDF cache writes to /tmp (pdfSource.js).

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check. Deliberately uses Node's default 16KB header limit: the /
# response once carried a ~20KB modulepreload Link header (2026-07-29..09-01),
# every probe died with "Parse Error: Header overflow" and the container
# reported permanently unhealthy (Traefik then never routes it). The header is
# now folded into the HTML head (src/lib/server/link-header.js), so an
# unhealthy container here means that regression is back — do not paper over
# it with --max-http-header-size. The .on('error') handler turns that class of
# failure into a clean exit 1 instead of an uncaught-exception crash.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1))"

# Start the application
CMD ["node", "build"]
