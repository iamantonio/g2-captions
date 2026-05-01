# Token broker container — runs tools/token-broker.ts via tsx.
# The broker is the only sanctioned credential boundary: DEEPGRAM_API_KEY
# (and optionally ASSEMBLYAI_API_KEY) live as Fly secrets and are never
# exposed to the WebView. VITE_BROKER_AUTH_TOKEN is also a secret here
# (mirrors the Vite-injected value baked into the WebView bundle); without
# it, the broker's bearer-auth gate is open whenever it's reached
# non-loopback (i.e., always, in production).

FROM node:22-slim AS deps

WORKDIR /app

# Install ALL deps (including tsx) — tsx is in devDependencies in
# package.json. In production we want a fast Node + tsx runtime; we don't
# want to relocate tsx to dependencies and pollute consumer dev installs.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY tools/ ./tools/
COPY src/ ./src/
# tsx loads tsconfig at runtime to interpret path-style and target hints.
COPY tsconfig.json ./

# Fly's edge proxy reaches the container on the port set via fly.toml's
# internal_port. Default to 8080 to match the Fly convention; override
# with TOKEN_BROKER_PORT in the environment if a different port is needed.
ENV TOKEN_BROKER_HOST=0.0.0.0
ENV TOKEN_BROKER_PORT=8080
EXPOSE 8080

# tsx loads the entry directly with TypeScript-aware resolution.
# Healthz uses GET /healthz from inside Fly.
CMD ["npx", "tsx", "tools/token-broker.ts"]
