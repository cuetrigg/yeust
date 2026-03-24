import { describe, expect, test } from "bun:test";
import {
  createEmulsifier,
  MemoryEmulsifier,
} from "../../../src/emulsifiers/index.ts";
import { createSocketContext } from "../../../src/sockets/context.ts";
import {
  createAckFrame,
  parseFrame,
  withMessageId,
} from "../../../src/protocol/frames.ts";
import { createFakeServerWebSocket } from "../../helpers/fake-server-websocket.ts";

describe("MemoryEmulsifier", () => {
  test("supports factory creation and pocket lifecycle events", () => {
    const emulsifier = createEmulsifier(
      { type: "memory" },
      { scope: "unit-memory" },
    );

    expect(emulsifier).toBeInstanceOf(MemoryEmulsifier);

    const events: string[] = [];
    emulsifier.on("create", ({ pocket }) => events.push(`create:${pocket}`));
    emulsifier.on("join", ({ pocket, socketId }) =>
      events.push(`join:${pocket}:${socketId}`),
    );
    emulsifier.on("leave", ({ pocket, socketId }) =>
      events.push(`leave:${pocket}:${socketId}`),
    );
    emulsifier.on("delete", ({ pocket }) => events.push(`delete:${pocket}`));

    const alpha = createFakeServerWebSocket({ socketId: "socket-1" });
    emulsifier.addSocket(
      createSocketContext({ socketId: "socket-1", ws: alpha.ws }),
    );

    emulsifier.join("socket-1", ["alpha"]);
    emulsifier.leave("socket-1", ["alpha"]);

    expect(events).toEqual([
      "create:alpha",
      "join:alpha:socket-1",
      "leave:alpha:socket-1",
      "delete:alpha",
    ]);
  });

  test("broadcasts only to sockets selected by pocket filters", async () => {
    const emulsifier = new MemoryEmulsifier();
    const alpha = createFakeServerWebSocket({ socketId: "socket-1" });
    const beta = createFakeServerWebSocket({ socketId: "socket-2" });

    emulsifier.addSocket(
      createSocketContext({ socketId: "socket-1", ws: alpha.ws }),
    );
    emulsifier.addSocket(
      createSocketContext({ socketId: "socket-2", ws: beta.ws }),
    );

    emulsifier.join("socket-1", ["alpha"]);
    emulsifier.join("socket-2", ["beta"]);

    await emulsifier.broadcast(
      withMessageId({ kind: "event", event: "greeting", data: { ok: true } }),
      { pockets: ["alpha"] },
    );

    expect(alpha.sent).toHaveLength(1);
    expect(beta.sent).toHaveLength(0);
    expect(parseFrame(alpha.sent[0]!.data as string)).toMatchObject({
      kind: "event",
      event: "greeting",
      data: { ok: true },
    });
  });

  test("collects local acknowledgements", async () => {
    const emulsifier = new MemoryEmulsifier();
    const alpha = createFakeServerWebSocket({ socketId: "socket-1" });
    const beta = createFakeServerWebSocket({ socketId: "socket-2" });

    emulsifier.addSocket(
      createSocketContext({ socketId: "socket-1", ws: alpha.ws }),
    );
    emulsifier.addSocket(
      createSocketContext({ socketId: "socket-2", ws: beta.ws }),
    );
    emulsifier.join("socket-1", ["alpha"]);
    emulsifier.join("socket-2", ["alpha"]);

    const ackPromise = emulsifier.broadcastWithAck(
      withMessageId({ kind: "event", event: "needs-ack", data: { ok: true } }),
      { pockets: ["alpha"], timeoutMs: 200 },
    );

    const frame = parseFrame(alpha.sent[0]!.data as string);

    await emulsifier.handleInboundFrame(
      "socket-1",
      createAckFrame(frame.id!, "alpha-ok"),
    );
    await emulsifier.handleInboundFrame(
      "socket-2",
      createAckFrame(frame.id!, "beta-ok"),
    );

    await expect(ackPromise).resolves.toEqual({
      expected: 2,
      received: 2,
      responses: ["alpha-ok", "beta-ok"],
      timedOut: false,
    });
  });
});
