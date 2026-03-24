FROM oven/bun:1.3.11

WORKDIR /app

COPY package.json index.ts tsconfig.json /app/
COPY src /app/src
COPY examples/swarm-chat /app/examples/swarm-chat

WORKDIR /app/examples/swarm-chat
RUN bun install

EXPOSE 3000

CMD ["bun", "run", "start"]
