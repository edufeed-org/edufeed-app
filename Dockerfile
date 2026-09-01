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

# Build the application. Raise Node's heap: the adapter-node server-bundling
# phase deterministically OOMs at 4096 MB since the NIP-29 groups merge
# (2026-08-27, CI runs 186-193; reproduced locally) and completes at 6144.
# The runner VM carries a swapfile so this cap fits beside dockerd.
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

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check. --max-http-header-size is load-bearing: the / response's
# modulepreload Link header alone is ~20KB, over Node's 16KB client default —
# without the flag every probe dies with "Parse Error: Header overflow" and
# the container reports permanently unhealthy (Traefik then never routes it).
# The .on('error') handler turns that class of failure into a clean exit 1
# instead of an uncaught-exception crash.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node --max-http-header-size=65536 -e "require('http').get('http://localhost:3000/', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1))"

# Start the application
CMD ["node", "build"]
