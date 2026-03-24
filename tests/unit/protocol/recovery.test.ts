import { describe, expect, test } from "bun:test";
import {
  isReplayableFrame,
  isValidRecoveryOffset,
  nextRecoveryOffset,
  shouldReplayFrame,
} from "../../../src/protocol/recovery.ts";

describe("recovery helpers", () => {
  test("validates and increments stream offsets", () => {
    expect(isValidRecoveryOffset("123-0")).toBe(true);
    expect(isValidRecoveryOffset("abc")).toBe(false);
    expect(nextRecoveryOffset("123-0")).toBe("123-1");
  });

  test("skips volatile and acknowledgement-dependent frames from replay", () => {
    const frame = { kind: "event", event: "replay-me", data: { ok: true } } as const;

    expect(isReplayableFrame(frame)).toBe(true);
    expect(isReplayableFrame(frame, { volatile: true })).toBe(false);
    expect(isReplayableFrame(frame, { requiresAcknowledgement: true })).toBe(false);
  });

  test("filters replayed frames by pockets and except rules", () => {
    expect(shouldReplayFrame(["alpha"], { pockets: ["alpha"] })).toBe(true);
    expect(shouldReplayFrame(["alpha"], { pockets: ["beta"] })).toBe(false);
    expect(
      shouldReplayFrame(["alpha", "beta"], {
        pockets: ["alpha"],
        except: ["beta"],
      }),
    ).toBe(false);
  });
});
