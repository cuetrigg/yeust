import { describe, expect, test } from "bun:test";
import { xread } from "../../../../src/emulsifiers/redis/stream-commands.ts";

describe("redis stream commands", () => {
  test("parses Bun object-shaped XREAD responses", async () => {
    const client = {
      send: async () => ({
        "yeust:{scope}:stream": [["1-0", ["uid", "node-1", "type", "broadcast"]]],
      }),
    };

    await expect(
      xread(client as never, "yeust:{scope}:stream", "0-0"),
    ).resolves.toEqual([
      {
        id: "1-0",
        fields: {
          uid: "node-1",
          type: "broadcast",
        },
      },
    ]);
  });

  test("parses RESP2-style array XREAD responses", async () => {
    const client = {
      send: async () => [
        ["yeust:{scope}:stream", [["2-0", ["uid", "node-2", "type", "heartbeat"]]]],
      ],
    };

    await expect(
      xread(client as never, "yeust:{scope}:stream", "0-0"),
    ).resolves.toEqual([
      {
        id: "2-0",
        fields: {
          uid: "node-2",
          type: "heartbeat",
        },
      },
    ]);
  });
});
