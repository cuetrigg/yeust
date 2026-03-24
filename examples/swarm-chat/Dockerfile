FROM oven/bun:1.3.11

WORKDIR /app

COPY package.json index.ts tsconfig.json /app/
COPY src /app/src
COPY examples/swarm-chat/package.json examples/swarm-chat/index.ts examples/swarm-chat/tsconfig.json /app/examples/swarm-chat/
COPY examples/swarm-chat/index.html examples/swarm-chat/client.js /app/examples/swarm-chat/

WORKDIR /app/examples/swarm-chat
RUN bun install

EXPOSE 3000

CMD ["bun", "run", "start"]
