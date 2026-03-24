import type { OutboundFrame } from "../../protocol/frames.ts";
import type { Pocket, BroadcastFlags } from "../types.ts";
import type { SocketId } from "../../sockets/context.ts";

export type RedisClusterMessageType =
  | "heartbeat:init"
  | "heartbeat"
  | "adapter:close"
  | "broadcast"
  | "broadcast:ack:count"
  | "broadcast:ack:response"
  | "pockets:join"
  | "pockets:leave";

export interface SerializedBroadcastOptions {
  readonly pockets?: Pocket[];
  readonly except?: Pocket[];
  readonly socketIds?: SocketId[];
  readonly flags?: BroadcastFlags;
}

export interface RedisClusterMessageBase {
  readonly uid: string;
  readonly scope: string;
  readonly type: RedisClusterMessageType;
}

export interface RedisBroadcastMessage extends RedisClusterMessageBase {
  readonly type: "broadcast";
  readonly frame: OutboundFrame;
  readonly options?: SerializedBroadcastOptions;
  readonly requestId?: string;
  readonly timeoutMs?: number;
}

export interface RedisHeartbeatMessage extends RedisClusterMessageBase {
  readonly type: "heartbeat:init" | "heartbeat";
}

export interface RedisAdapterCloseMessage extends RedisClusterMessageBase {
  readonly type: "adapter:close";
}

export interface RedisBroadcastAckCountMessage extends RedisClusterMessageBase {
  readonly type: "broadcast:ack:count";
  readonly requestId: string;
  readonly targetUid: string;
  readonly count: number;
}

export interface RedisBroadcastAckResponseMessage
  extends RedisClusterMessageBase {
  readonly type: "broadcast:ack:response";
  readonly requestId: string;
  readonly targetUid: string;
  readonly socketId: SocketId;
  readonly response: unknown;
}

export interface RedisPocketMembershipMessage extends RedisClusterMessageBase {
  readonly type: "pockets:join" | "pockets:leave";
  readonly socketId: SocketId;
  readonly pockets: Pocket[];
}

export type RedisClusterMessage =
  | RedisHeartbeatMessage
  | RedisAdapterCloseMessage
  | RedisBroadcastMessage
  | RedisBroadcastAckCountMessage
  | RedisBroadcastAckResponseMessage
  | RedisPocketMembershipMessage;

export function serializeBroadcastOptions(
  options: SerializedBroadcastOptions = {},
): SerializedBroadcastOptions {
  return {
    pockets: options.pockets ? [...options.pockets] : undefined,
    except: options.except ? [...options.except] : undefined,
    socketIds: options.socketIds ? [...options.socketIds] : undefined,
    flags: options.flags,
  };
}
