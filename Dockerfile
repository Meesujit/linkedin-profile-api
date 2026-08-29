# ---- Base -----------------------------------------------------------------
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g pnpm@11.24.0
WORKDIR /app

# ---- Dependencies ---------------------------------------------------------
# Production deps only — the LinkedIn client is direct HTTP (native fetch), so
# no browser / Chromium is installed at runtime.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# ---- Build ----------------------------------------------------------------
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# ---- Runtime --------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8000

# Production artifacts only (no source, no secrets, no tests, no browser).
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# Session credentials are injected via env vars (LINKEDIN_LI_AT /
# LINKEDIN_JSESSIONID) at runtime — never baked into the image.
RUN mkdir -p storage

EXPOSE 8000
CMD ["node", "dist/server.js"]
