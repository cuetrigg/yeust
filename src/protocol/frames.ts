export type MessageId = string;
export type FrameKind = "event" | "ack" | "system";

export interface BaseFrame {
  readonly kind: FrameKind;
  readonly id?: MessageId;
  readonly event: string;
  readonly data?: unknown;
  readonly offset?: string;
}

export interface EventFrame extends BaseFrame {
  readonly kind: "event";
}

export interface AckFrame extends BaseFrame {
  readonly kind: "ack";
  readonly replyTo: MessageId;
}

export interface SystemFrame extends BaseFrame {
  readonly kind: "system";
}

export type OutboundFrame = EventFrame | AckFrame | SystemFrame;
export type InboundFrame = OutboundFrame;

export function createMessageId(): MessageId {
  return crypto.randomUUID();
}

export function withMessageId<TFrame extends OutboundFrame>(
  frame: TFrame,
  id = createMessageId(),
): TFrame {
  return {
    ...frame,
    id,
  };
}

export function withRecoveryOffset<TFrame extends OutboundFrame>(
  frame: TFrame,
  offset: string,
): TFrame {
  return {
    ...frame,
    offset,
  };
}

export function createAckFrame(
  replyTo: MessageId,
  data?: unknown,
): AckFrame {
  return {
    kind: "ack",
    event: "ack",
    replyTo,
    data,
  };
}

export function serializeFrame(frame: OutboundFrame): string {
  return JSON.stringify(frame);
}

export function parseFrame(value: string): InboundFrame {
  return JSON.parse(value) as InboundFrame;
}
