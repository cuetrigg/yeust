# Live Chat Builder Example

This example demonstrates a multi-tenant live chat builder and static server using:

- Docker Swarm
- Traefik for local routing and production HTTPS
- Redis
- Bun API
- React
- TailwindCSS
- `yeust` with `RedisEmulsifier`

The Bun API does three main jobs:

- generates tenant-specific JSON config files
- builds minified widget bundles named `livechat-{uuid}.js`
- provides a server-to-server API for pushing messages into a specific private session

The built widget is self-contained: tenant config is embedded into `livechat-{uuid}.js`, so the browser does not fetch a public config JSON file at runtime.

## Private chat sessions

Each tenant build is shared, but each visitor gets a private `sessionId` generated in the widget.

- the widget stores the `sessionId` in `sessionStorage`
- the widget reconnects with that same `sessionId` later in the same browser session
- the server maps that `sessionId` to a private pocket using `tenant:{uuid}:session:{sessionId}`
- visitors using the same widget build do not see each other's messages
- per-session message history is stored server-side and reloaded on reconnect

## Local development

```bash
cd examples/livechat-multitenant
bun install
bun run tailwind:build
REDIS_URL=redis://127.0.0.1:6379 bun dev
```

Open `http://localhost:3010`.

## Local swarm setup

Local Docker now uses the same Swarm stack shape as production, with a small overlay for localhost routing.

The base stack lives under `examples/livechat-multitenant/docker/swarm/compose.yml` and the local overlay lives under `examples/livechat-multitenant/docker/swarm/compose.local.yml`.

Then from the repo root:

```bash
docker swarm init
docker build --build-context yeust=. -f examples/livechat-multitenant/Dockerfile -t yeust-livechat-multitenant:local examples/livechat-multitenant
docker stack deploy -c examples/livechat-multitenant/docker/swarm/compose.yml -c examples/livechat-multitenant/docker/swarm/compose.local.yml yeustlivechat
```

If you copy this example out of the repo, point `--build-context yeust=/path/to/yeust` at your cloned `yeust` checkout before building the image.

Local routes:

- `http://livechat.localhost/`
- `http://livechat.localhost/livechat-{uuid}.js`
- `http://livechat.localhost/api/livechat/build`
- `http://livechat.localhost/api/livechat/messages`
- `http://livechat.localhost/api/livechat/history?tenantUuid={uuid}&sessionId={sessionId}`
- `http://traefik.localhost/`

## Production swarm setup

Production uses the same base stack file, with pipeline-supplied image and host values.

It includes:

- `traefik`
- `redis`
- `livechat-multitenant`

Then from the repo root:

```bash
docker swarm init
export LIVECHAT_IMAGE=registry.example.com/yeust-livechat-multitenant:${GIT_SHA}
export PUBLIC_HOST=chat.example.com
export TRAEFIK_DASHBOARD_HOST=traefik.example.com
export ACME_EMAIL=ops@example.com
docker stack deploy -c examples/livechat-multitenant/docker/swarm/compose.yml yeustlivechat
```

Main routes:

- `https://${PUBLIC_HOST}/`
- `https://${PUBLIC_HOST}/livechat-{uuid}.js`
- `https://${PUBLIC_HOST}/api/livechat/build`
- `https://${PUBLIC_HOST}/api/livechat/messages`
- `https://${TRAEFIK_DASHBOARD_HOST}/`

Production HTTPS is handled by Traefik's ACME certificate resolver in the base Swarm stack.

## Key files

- `examples/livechat-multitenant/src/index.ts`
- `examples/livechat-multitenant/src/App.tsx`
- `examples/livechat-multitenant/src/widget-entry.ts`
- `examples/livechat-multitenant/docker/swarm/compose.yml`
- `examples/livechat-multitenant/docker/swarm/compose.local.yml`
- `examples/livechat-multitenant/docker/swarm/traefik.local.yml`
