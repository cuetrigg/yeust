# syntax=docker/dockerfile:1.7
FROM oven/bun:1.3.11 AS base

WORKDIR /app

FROM base AS yeust-package

COPY --from=yeust package.json index.ts tsconfig.json /pkg/yeust/
COPY --from=yeust src /pkg/yeust/src

FROM base AS install-dev

COPY package.json bunfig.toml tsconfig.json /app/
RUN bun -e 'import { readFileSync, writeFileSync } from "node:fs"; const path = "/app/package.json"; const pkg = JSON.parse(readFileSync(path, "utf8")); if (pkg.dependencies) delete pkg.dependencies.yeust; writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);'
RUN CI=0 bun install
COPY --from=yeust-package /pkg/yeust /app/node_modules/yeust

FROM base AS install-prod

COPY package.json bunfig.toml tsconfig.json /app/
RUN bun -e 'import { readFileSync, writeFileSync } from "node:fs"; const path = "/app/package.json"; const pkg = JSON.parse(readFileSync(path, "utf8")); if (pkg.dependencies) delete pkg.dependencies.yeust; writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);'
RUN CI=0 bun install --production
COPY --from=yeust-package /pkg/yeust /app/node_modules/yeust

FROM base AS prerelease

COPY . /app
COPY --from=install-dev /app/node_modules /app/node_modules

ENV NODE_ENV=production
RUN bun run build

FROM base AS release

COPY --from=prerelease /app /app
COPY --from=install-prod /app/node_modules /app/node_modules

USER bun
EXPOSE 3000/tcp

CMD ["bun", "run", "start"]
