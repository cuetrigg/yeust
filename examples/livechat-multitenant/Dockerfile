FROM oven/bun:1.3.11

WORKDIR /app

COPY package.json index.ts tsconfig.json /app/
COPY src /app/src
COPY examples/livechat-multitenant /app/examples/livechat-multitenant

WORKDIR /app/examples/livechat-multitenant
RUN bun install

EXPOSE 3010

CMD ["bun", "run", "start"]
