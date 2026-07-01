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

# Build the application. Raise Node's heap: the CI runner OOM-flakes the
# Vite/SvelteKit build at the default ~2GB limit (same commit passed on one
# run and failed on another purely from memory pressure).
RUN NODE_OPTIONS=--max-old-space-size=4096 pnpm run build

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

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); })"

# Start the application
CMD ["node", "build"]
