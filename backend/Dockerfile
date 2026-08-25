# ─────────────────────────────────────────────
# Stage 1: Install dependencies
# ─────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

COPY package*.json ./
RUN npm ci --frozen-lockfile

# ─────────────────────────────────────────────
# Stage 2: Generate Prisma client & build
# ─────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate the Prisma client before building
RUN npx prisma generate

RUN npm run build

# ─────────────────────────────────────────────
# Stage 3: Production runtime image
# ─────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Install OpenSSL for Prisma binary compatibility on Alpine
RUN apk add --no-cache openssl

# Create a non-root user for security
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nestjs

# Copy runtime artifacts
COPY --from=builder --chown=nestjs:nodejs /app/dist         ./dist
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/prisma       ./prisma
COPY --from=builder --chown=nestjs:nodejs /app/package.json ./package.json

USER nestjs

EXPOSE 4000

# Enable read-only root filesystem with explicit tmpfs mounts
VOLUME ["/tmp"]

# Run migrations then start the server
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
