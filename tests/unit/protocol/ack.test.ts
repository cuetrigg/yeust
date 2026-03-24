import { describe, expect, test } from "bun:test";
import {
  addExpectedAcks,
  createAckTracker,
  isAckComplete,
  recordAckResponse,
  toAckResult,
} from "../../../src/protocol/ack.ts";

describe("ack protocol helpers", () => {
  test("deduplicates responses from the same source", () => {
    const tracker = createAckTracker({ requestId: "req-1" });

    addExpectedAcks(tracker, 2);

    expect(recordAckResponse(tracker, "socket-1", "ok-1")).toBe(true);
    expect(recordAckResponse(tracker, "socket-1", "duplicate")).toBe(false);
    expect(recordAckResponse(tracker, "socket-2", "ok-2")).toBe(true);
    expect(isAckComplete(tracker)).toBe(true);
    expect(toAckResult(tracker)).toEqual({
      expected: 2,
      received: 2,
      responses: ["ok-1", "ok-2"],
      timedOut: false,
    });
  });
});
