# Swarm React Example

This app was created with `bun init --react` and then wired to `RedisEmulsifier`.

Run it directly first:

```bash
cd examples/swarm-chat
REDIS_URL=redis://127.0.0.1:6379 bun dev
```

To test Docker Swarm from the repo root:

```bash
docker swarm init
docker build -f examples/swarm-chat/Dockerfile -t yeust-swarm-example:dev .
docker stack deploy -c examples/swarm-chat/docker-stack.yml yeustexample
```

Open `http://localhost:3000` in multiple tabs and test:

- cross-node pocket broadcasts
- acknowledgement aggregation
- reconnect recovery with offsets
- heartbeat-based pruning by scaling replicas up and down

Core files:

- `examples/swarm-chat/src/index.ts`
- `examples/swarm-chat/src/App.tsx`
- `examples/swarm-chat/docker-stack.yml`
