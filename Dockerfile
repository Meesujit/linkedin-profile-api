# ---- Base -----------------------------------------------------------------
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g pnpm@11.24.0
WORKDIR /app

# ---- Dependencies ---------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---- Build ----------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ---- Runtime --------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8000

# Install Chromium + its OS dependencies (Playwright knows the right set).
COPY --from=build /app/node_modules ./node_modules
RUN ./node_modules/.bin/playwright install --with-deps chromium

# Production artifacts only (no source, no secrets, no tests).
COPY --from=build /app/dist ./dist
COPY package.json ./

# Session state is mounted here at runtime — never baked into the image.
RUN mkdir -p storage

EXPOSE 8000
CMD ["node", "dist/server.js"]
