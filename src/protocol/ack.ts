import type { MessageId } from "./frames.ts";

export interface AckResult {
  readonly expected: number;
  readonly received: number;
  readonly responses: unknown[];
  readonly timedOut: boolean;
}

export interface AckTracker {
  readonly requestId: MessageId;
  readonly responses: unknown[];
  readonly receivedSources: Set<string>;
  readonly startedAt: number;
  expected: number;
  received: number;
  timeoutMs: number;
  timedOut: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

export interface CreateAckTrackerOptions {
  readonly requestId: MessageId;
  readonly expected?: number;
  readonly timeoutMs?: number;
}

export function createAckTracker(
  options: CreateAckTrackerOptions,
): AckTracker {
  return {
    requestId: options.requestId,
    responses: [],
    receivedSources: new Set(),
    startedAt: Date.now(),
    expected: options.expected ?? 0,
    received: 0,
    timeoutMs: options.timeoutMs ?? 0,
    timedOut: false,
  };
}

export function addExpectedAcks(
  tracker: AckTracker,
  count: number,
): AckTracker {
  tracker.expected += count;
  return tracker;
}

export function recordAckResponse(
  tracker: AckTracker,
  sourceId: string,
  response: unknown,
): boolean {
  if (tracker.receivedSources.has(sourceId)) {
    return false;
  }

  tracker.receivedSources.add(sourceId);
  tracker.received += 1;
  tracker.responses.push(response);
  return true;
}

export function isAckComplete(tracker: AckTracker): boolean {
  return tracker.received >= tracker.expected;
}

export function cancelAckTimeout(tracker: AckTracker): void {
  if (!tracker.timer) {
    return;
  }

  clearTimeout(tracker.timer);
  tracker.timer = undefined;
}

export function scheduleAckTimeout(
  tracker: AckTracker,
  onTimeout: (result: AckResult) => void,
): AckTracker {
  cancelAckTimeout(tracker);

  if (tracker.timeoutMs <= 0) {
    return tracker;
  }

  tracker.timer = setTimeout(() => {
    tracker.timedOut = true;
    tracker.timer = undefined;
    onTimeout(toAckResult(tracker));
  }, tracker.timeoutMs);

  return tracker;
}

export function toAckResult(tracker: AckTracker): AckResult {
  return {
    expected: tracker.expected,
    received: tracker.received,
    responses: [...tracker.responses],
    timedOut: tracker.timedOut,
  };
}
