# Build context: the repository root (docker-compose.prod.yml sets it).
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @foodboll/api build
# `--legacy`: pnpm 10 refuses a plain deploy unless inject-workspace-packages is on, and this
# repository keeps it off. The workspace packages are bundled into dist by tsup, so the runtime
# only needs the third-party dependencies that this command installs.
RUN pnpm --filter @foodboll/api --prod deploy --legacy /out

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist
# Migration SQL. dist/db/migrate-cli.js finds it at ../../drizzle relative to itself.
COPY --from=build --chown=node:node /repo/apps/api/drizzle ./drizzle
RUN mkdir -p /app/data/receipts && chown -R node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/main.js"]
