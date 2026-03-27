import { serve, type ServerWebSocket } from "bun";
import index from "./index.html";
import {
  MemoryEmulsifier,
  createSocketContext,
  type InboundFrame,
  type OutboundFrame,
  serializeFrame,
  withMessageId,
} from "yeust";

interface ChatSocketData {
  socketId: string;
  sessionId: string;
  pockets: string[];
}

type CommandMessage =
  | { type: "join"; pockets: string[] }
  | { type: "leave"; pockets: string[] }
  | { type: "broadcast"; event?: string; message?: string; expectAck?: boolean }
  | { type: "state" };

const emulsifier = new MemoryEmulsifier();

const server = serve<ChatSocketData>({
  hostname: "0.0.0.0",
  port: Number(Bun.env.PORT ?? "3001"),
  routes: {
    "/health": () => Response.json({ ok: true, mode: "memory", sockets: emulsifier.size }),
    "/*": index,
  },
  fetch(request, serverRef) {
    if (new URL(request.url).pathname === "/ws") {
      const upgraded = serverRef.upgrade(request, {
        data: {
          socketId: crypto.randomUUID(),
          sessionId: crypto.randomUUID(),
          pockets: [],
        },
      });

      if (!upgraded) {
        return new Response("Upgrade failed", { status: 400 });
      }

      return;
    }

    return new Response("Not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      emulsifier.addSocket(
        createSocketContext({
          socketId: ws.data.socketId,
          sessionId: ws.data.sessionId,
          ws,
          pockets: ws.data.pockets,
          data: { mode: "memory" },
        }),
      );
      sendSystem(ws, "welcome", {
        socketId: ws.data.socketId,
        sessionId: ws.data.sessionId,
        mode: "memory",
      });
    },
    async message(ws, message) {
      const payload = JSON.parse(typeof message === "string" ? message : message.toString("utf8")) as CommandMessage | InboundFrame;

      if (isAckFrame(payload)) {
        await emulsifier.handleInboundFrame(ws.data.socketId, payload);
        return;
      }

      switch (payload.type) {
        case "join": {
          const pockets = normalizePockets(payload.pockets);
          emulsifier.join(ws.data.socketId, pockets);
          ws.data.pockets = mergePockets(ws.data.pockets, pockets);
          sendSystem(ws, "joined", { pockets: ws.data.pockets });
          break;
        }
        case "leave": {
          const pockets = normalizePockets(payload.pockets);
          emulsifier.leave(ws.data.socketId, pockets);
          ws.data.pockets = ws.data.pockets.filter((pocket) => !pockets.includes(pocket));
          sendSystem(ws, "left", { pockets: ws.data.pockets });
          break;
        }
        case "broadcast": {
          const frame = withMessageId({
            kind: "event",
            event: payload.event ?? "chat:message",
            data: {
              from: ws.data.socketId,
              text: payload.message ?? "Hello from the in-memory React example",
            },
          }) as OutboundFrame & { id: string };

          if (payload.expectAck) {
            const result = await emulsifier.broadcastWithAck(frame, {
              pockets: ws.data.pockets,
              timeoutMs: 5_000,
            });
            sendSystem(ws, "ack:result", { requestId: frame.id, result });
            break;
          }

          await emulsifier.broadcast(frame, { pockets: ws.data.pockets });
          sendSystem(ws, "broadcast:sent", { requestId: frame.id });
          break;
        }
        case "state": {
          sendSystem(ws, "state", {
            socketId: ws.data.socketId,
            sessionId: ws.data.sessionId,
            pockets: ws.data.pockets,
          });
          break;
        }
      }
    },
    async close(ws) {
      await emulsifier.removeSocket(ws.data.socketId);
    },
  },
  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

console.log(`In-memory React example running at ${server.url}`);

function isAckFrame(message: CommandMessage | InboundFrame): message is InboundFrame {
  return typeof message === "object" && message !== null && "kind" in message;
}

function normalizePockets(pockets: string[]): string[] {
  return [...new Set(pockets.map((pocket) => pocket.trim()).filter(Boolean))];
}

function mergePockets(current: string[], next: string[]): string[] {
  return [...new Set([...current, ...next])];
}

function sendSystem(
  ws: ServerWebSocket<ChatSocketData>,
  event: string,
  data?: unknown,
): void {
  ws.send(serializeFrame({ kind: "system", event, data }));
}
