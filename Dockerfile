# Dockerfile for BingeMe Express API
# Multi-stage build for smaller final image

FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
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

# Expose default port (override with PORT env)
EXPOSE 4000

# Healthcheck endpoint should be available at /health if implemented
# HEALTHCHECK CMD wget -qO- http://localhost:4000/health || exit 1

CMD ["node", "src/server.js"]


