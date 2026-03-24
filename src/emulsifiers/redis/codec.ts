import type { RedisClusterMessage } from "./messages.ts";

export interface RedisStreamMessageFields {
  readonly uid: string;
  readonly scope: string;
  readonly type: string;
  readonly payload: string;
}

export function encodeRedisClusterMessage(
  message: RedisClusterMessage,
): Record<string, string> {
  return {
    uid: message.uid,
    scope: message.scope,
    type: message.type,
    payload: JSON.stringify(message),
  };
}

export function decodeRedisClusterMessage(
  fields: Record<string, string>,
): RedisClusterMessage {
  const payload = fields.payload;

  if (!payload) {
    throw new Error("Redis stream entry is missing payload field.");
  }

  return JSON.parse(payload) as RedisClusterMessage;
}
