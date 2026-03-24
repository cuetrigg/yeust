import { describe, expect, test } from "bun:test";
import { PocketIndex } from "../../../src/pockets/pocket-index.ts";

describe("PocketIndex", () => {
  test("emits create and join changes in order for the first socket", () => {
    const index = new PocketIndex();

    expect(index.join("socket-1", ["alpha"])).toEqual([
      { type: "create", pocket: "alpha" },
      { type: "join", pocket: "alpha", socketId: "socket-1" },
    ]);
    expect([...index.getPockets("socket-1")]).toEqual(["alpha"]);
    expect([...index.getSocketIds("alpha")]).toEqual(["socket-1"]);
  });

  test("deduplicates repeated joins and deletes empty pockets on last leave", () => {
    const index = new PocketIndex();

    index.join("socket-1", ["alpha"]);
    index.join("socket-2", ["alpha"]);

    expect(index.join("socket-1", ["alpha"])).toEqual([]);
    expect(index.leave("socket-1", ["alpha"])).toEqual([
      { type: "leave", pocket: "alpha", socketId: "socket-1" },
    ]);
    expect(index.leave("socket-2", ["alpha"])).toEqual([
      { type: "leave", pocket: "alpha", socketId: "socket-2" },
      { type: "delete", pocket: "alpha" },
    ]);
    expect(index.hasPocket("alpha")).toBe(false);
  });
});
