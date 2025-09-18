# Dockerfile for BingeMe Express API
# Multi-stage build for smaller final image

FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./

# Install build dependencies (for sharp / native modules)
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    libc6-compat

# Prefer lockfile install; fall back to npm install if lock is out of sync
RUN npm ci --omit=dev || npm install --omit=dev

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# No build step required for pure Node.js; keep stage for future use

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=prod
COPY --from=builder /app .

# Create logs dir for PM2 (if used in container) and app
RUN mkdir -p logs

EXPOSE 4000

CMD ["node", "src/server.js"]