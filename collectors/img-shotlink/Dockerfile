# Base image with Playwright + Chromium pre-installed. Saves us
# apt-getting ~500 MB of system deps on every build.
FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app

# Install prod deps only. Copy just package.json first so Docker can
# cache the layer when only source files change.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Copy source. The `.dockerignore` keeps recon artefacts + test files out.
COPY collector.mjs publisher.mjs translator.mjs ./

# Non-root user (comes with the playwright base). Reduces blast radius
# if the collector is ever exploited via the widget.
USER pwuser

# Fly.io injects PORT for health checks. Our collector doesn't need
# to bind — Fly's TCP health check is optional. Log to stdout.
ENV NODE_ENV=production
ENV NODE_OPTIONS=--enable-source-maps

CMD ["node", "collector.mjs"]
