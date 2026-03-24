# Swarm Example

This example shows how to wire `RedisEmulsifier` into a Bun websocket server and run it behind Docker Swarm.

Run it locally without Docker first:

```bash
cd examples/swarm-chat
bun run dev
```

To test it with Docker Swarm from the repo root:

```bash
docker swarm init
docker build -f examples/swarm-chat/Dockerfile -t yeust-swarm-example:dev .
docker stack deploy -c examples/swarm-chat/docker-stack.yml yeustexample
```

Then open `http://localhost:3000` in multiple tabs and test:

- cross-node pocket broadcasts
- broadcasts with acknowledgements
- reconnect and recovery
- heartbeat-based node pruning by scaling replicas up and down

Key files:

- `examples/swarm-chat/index.ts`
- `examples/swarm-chat/docker-stack.yml`
- `examples/swarm-chat/Dockerfile`
