# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# better-sqlite3 ships prebuilt binaries, so nothing is compiled here.
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
# Then drop dev dependencies, and better-sqlite3's C sources and other platforms' binaries.
RUN npm run build && npm prune --omit=dev \
  && rm -rf node_modules/better-sqlite3/deps node_modules/better-sqlite3/src \
  && find node_modules/better-sqlite3/prebuilds -type f \
    ! -name "linux-$(node -p process.arch).node" -delete

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    TZ=America/Sao_Paulo \
    DATABASE_PATH=/data/padrinho.db \
    SERVER_CONFIG_PATH=/app/server.yaml
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json server.yaml ./
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
# Each check starts a node process, so it runs every 2 minutes (every 10s while starting).
HEALTHCHECK --interval=2m --timeout=5s --start-period=60s --start-interval=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.HTTP_PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/index.js"]
