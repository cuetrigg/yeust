import { RedisClient, type ServerWebSocket } from "bun";
import {
  RedisEmulsifier,
  createSocketContext,
  serializeFrame,
  withMessageId,
  type InboundFrame,
  type OutboundFrame,
} from "../../index.ts";

interface SwarmSocketData {
  nodeId: string;
  socketId: string;
  sessionId: string;
  resumeSessionId?: string;
  resumeOffset?: string;
  pockets: string[];
}

type ClientMessage =
  | { type: "join"; pockets: string[] }
  | { type: "leave"; pockets: string[] }
  | { type: "broadcast"; message?: string; expectAck?: boolean; except?: string[] }
  | { type: "disconnect" }
  | { type: "state" }
  | InboundFrame;

const port = Number(Bun.env.PORT ?? "3000");
const redisUrl = Bun.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const scope = Bun.env.YEUST_SCOPE ?? "yeust-swarm-example";
const nodeId = Bun.env.YEUST_UID ?? Bun.env.HOSTNAME ?? crypto.randomUUID();

const commandClient = new RedisClient(redisUrl);
await commandClient.connect();
const streamClient = await commandClient.duplicate();

if (!streamClient.connected) {
  await streamClient.connect();
}

const emulsifier = new RedisEmulsifier<{ nodeId: string }, { nodeId: string }>(
  {
    uid: nodeId,
    commandClient,
    streamClient,
    streamName: Bun.env.YEUST_STREAM_NAME ?? `yeust:{${scope}}:stream`,
    nodesKey: Bun.env.YEUST_NODES_KEY ?? `yeust:{${scope}}:nodes`,
    sessionKeyPrefix:
      Bun.env.YEUST_SESSION_PREFIX ?? `yeust:{${scope}}:session:`,
    heartbeatIntervalMs: Number(Bun.env.HEARTBEAT_INTERVAL_MS ?? "2500"),
    heartbeatTimeoutMs: Number(Bun.env.HEARTBEAT_TIMEOUT_MS ?? "5000"),
    sessionTtlMs: Number(Bun.env.SESSION_TTL_MS ?? "120000"),
    onError: (error) => console.error(`[${nodeId}]`, error),
  },
  { scope },
);

const html = Bun.file(new URL("./index.html", import.meta.url));
const clientJs = Bun.file(new URL("./client.js", import.meta.url));

Bun.serve<SwarmSocketData>({
  hostname: "0.0.0.0",
  port,
  fetch(request, server) {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      const upgraded = server.upgrade(request, {
        data: {
          nodeId,
          socketId: crypto.randomUUID(),
          sessionId: crypto.randomUUID(),
          resumeSessionId: url.searchParams.get("sessionId") ?? undefined,
          resumeOffset: url.searchParams.get("offset") ?? undefined,
          pockets: [],
        },
      });

      if (!upgraded) {
        return new Response("Upgrade failed", { status: 400 });
      }

      return;
    }

    if (url.pathname === "/client.js") {
      return new Response(clientJs, {
        headers: { "content-type": "text/javascript; charset=utf-8" },
      });
    }

    if (url.pathname === "/health") {
      return Response.json({ ok: true, nodeId, scope, sockets: emulsifier.size });
    }

    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
  websocket: {
    open: async (ws) => {
      let recovered = null;

      if (ws.data.resumeSessionId && ws.data.resumeOffset) {
        recovered = await emulsifier.restoreSession(
          ws.data.resumeSessionId,
          ws.data.resumeOffset,
        );
      }

      if (recovered) {
        ws.data.socketId = recovered.socketId;
        ws.data.sessionId = recovered.sessionId;
        ws.data.pockets = [...recovered.pockets];
      }

      emulsifier.addSocket(
        createSocketContext({
          socketId: ws.data.socketId,
          sessionId: ws.data.sessionId,
          ws,
          pockets: ws.data.pockets,
          data: { nodeId },
        }),
      );

      sendSystem(ws, "welcome", {
        nodeId,
        socketId: ws.data.socketId,
        sessionId: ws.data.sessionId,
        pockets: ws.data.pockets,
        recovered: Boolean(recovered),
        missedFrames: recovered?.missedFrames.length ?? 0,
      });

      for (const frame of recovered?.missedFrames ?? []) {
        ws.send(serializeFrame(frame));
      }
    },
    message: async (ws, message) => {
      const payload = parseMessage(message);

      if (isAckFrame(payload)) {
        await emulsifier.handleInboundFrame(ws.data.socketId, payload);
        return;
      }

      if (!isCommandMessage(payload)) {
        sendSystem(ws, "error", { nodeId, message: "Unsupported message" });
        return;
      }

      switch (payload.type) {
        case "join": {
          const pockets = normalizePockets(payload.pockets);
          await emulsifier.join(ws.data.socketId, pockets);
          ws.data.pockets = mergePockets(ws.data.pockets, pockets);
          sendSystem(ws, "joined", { nodeId, pockets: ws.data.pockets });
          return;
        }
        case "leave": {
          const pockets = normalizePockets(payload.pockets);
          await emulsifier.leave(ws.data.socketId, pockets);
          ws.data.pockets = ws.data.pockets.filter(
            (pocket) => !pockets.includes(pocket),
          );
          sendSystem(ws, "left", { nodeId, pockets: ws.data.pockets });
          return;
        }
        case "broadcast": {
          const frame = withMessageId({
            kind: "event",
            event: "swarm:message",
            data: {
              from: ws.data.socketId,
              nodeId,
              text: payload.message ?? "Hello from the swarm example",
            },
          }) as OutboundFrame & { id: string };
          const options = {
            pockets: ws.data.pockets,
            except: normalizeOptionalPockets(payload.except),
          };

          if (payload.expectAck) {
            const result = await emulsifier.broadcastWithAck(frame, {
              ...options,
              timeoutMs: 5_000,
            });
            sendSystem(ws, "ack:result", { nodeId, requestId: frame.id, result });
            return;
          }

          await emulsifier.broadcast(frame, options);
          sendSystem(ws, "broadcast:sent", { nodeId, requestId: frame.id });
          return;
        }
        case "disconnect": {
          ws.close(1000, "client requested disconnect");
          return;
        }
        case "state": {
          sendSystem(ws, "state", {
            nodeId,
            socketId: ws.data.socketId,
            sessionId: ws.data.sessionId,
            pockets: ws.data.pockets,
          });
          return;
        }
      }
    },
    close: async (ws) => {
      await emulsifier.removeSocket(ws.data.socketId);
    },
  },
});

console.log(`[${nodeId}] swarm example listening on http://localhost:${port}`);

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function shutdown(): Promise<void> {
  await emulsifier.close();
  if (commandClient.connected) {
    commandClient.close();
  }
  if (streamClient.connected) {
    streamClient.close();
  }
  process.exit(0);
}

function parseMessage(message: string | Buffer): ClientMessage {
  const text = typeof message === "string" ? message : message.toString("utf8");
  return JSON.parse(text) as ClientMessage;
}

function isAckFrame(message: ClientMessage): message is InboundFrame {
  return typeof message === "object" && message !== null && "kind" in message;
}

function isCommandMessage(
  message: ClientMessage,
): message is Exclude<ClientMessage, InboundFrame> {
  return typeof message === "object" && message !== null && "type" in message;
}

function normalizePockets(pockets: string[]): string[] {
  return [...new Set(pockets.map((pocket) => pocket.trim()).filter(Boolean))];
}

function normalizeOptionalPockets(pockets?: string[]): string[] | undefined {
  if (!pockets || pockets.length === 0) {
    return undefined;
  }

  return normalizePockets(pockets);
}

function mergePockets(current: string[], next: string[]): string[] {
  return [...new Set([...current, ...next])];
}

function sendSystem(
  ws: ServerWebSocket<SwarmSocketData>,
  event: string,
  data?: unknown,
): void {
  ws.send(
    serializeFrame({
      kind: "system",
      event,
      data,
    }),
  );
}
