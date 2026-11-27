# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# better-sqlite3 loads its prebuilt binary, but npm would still run node-gyp because the package
# has a binding.gyp; no runtime dependency needs an install script, so they are all skipped.
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
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
HEALTHCHECK --interval=2m --timeout=5s --start-period=60s --start-interval=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.HTTP_PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/index.js"]
