import type { BroadcastOptions } from "../emulsifiers/types.ts";
import type { OutboundFrame } from "./frames.ts";
import type {
  PocketName,
  RecoverySessionId,
  SocketId,
} from "../sockets/context.ts";

export const RECOVERY_OFFSET_PATTERN = /^[0-9]+-[0-9]+$/;

export interface RecoverySession<TSessionData = unknown> {
  readonly sessionId: RecoverySessionId;
  readonly socketId: SocketId;
  readonly pockets: PocketName[];
  readonly data: TSessionData;
  readonly disconnectedAt: number;
}

export interface RecoveredSession<TSessionData = unknown>
  extends RecoverySession<TSessionData> {
  readonly missedFrames: OutboundFrame[];
}

export interface ReplayabilityOptions {
  readonly volatile?: boolean;
  readonly requiresAcknowledgement?: boolean;
}

export function isValidRecoveryOffset(offset: string): boolean {
  return RECOVERY_OFFSET_PATTERN.test(offset);
}

export function nextRecoveryOffset(offset: string): string {
  if (!isValidRecoveryOffset(offset)) {
    throw new Error(`Invalid recovery offset: ${offset}`);
  }

  const [timestamp, sequence = "0"] = offset.split("-");
  return `${timestamp}-${Number.parseInt(sequence, 10) + 1}`;
}

export function isReplayableFrame(
  frame: OutboundFrame,
  options: ReplayabilityOptions = {},
): boolean {
  if (frame.kind !== "event") {
    return false;
  }

  if (options.volatile || options.requiresAcknowledgement) {
    return false;
  }

  return true;
}

export function shouldReplayFrame(
  sessionPockets: Iterable<PocketName>,
  options: BroadcastOptions = {},
): boolean {
  const joinedPockets = new Set(sessionPockets);
  const targetPockets = new Set(options.pockets ?? []);
  const exceptPockets = new Set(options.except ?? []);

  const matchesTarget =
    targetPockets.size === 0 ||
    [...joinedPockets].some((pocket) => targetPockets.has(pocket));
  const matchesExcept = [...joinedPockets].some((pocket) =>
    exceptPockets.has(pocket),
  );

  return matchesTarget && !matchesExcept;
}
