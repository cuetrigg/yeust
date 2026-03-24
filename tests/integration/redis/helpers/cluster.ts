import type { RedisClient } from "bun";

export interface RedisTestScope {
  readonly name: string;
  readonly streamName: string;
  readonly sessionKeyPrefix: string;
}

export function createRedisTestScope(prefix = "yeust-test"): RedisTestScope {
  const name = `${prefix}-${crypto.randomUUID()}`;

  return {
    name,
    streamName: `yeust:{${name}}:stream`,
    sessionKeyPrefix: `yeust:{${name}}:session:`,
  };
}

export function createRedisNodeId(prefix = "node"): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export async function cleanupRedisTestScope(
  client: RedisClient,
  scope: RedisTestScope,
): Promise<void> {
  const keys = (await client.send("KEYS", [
    `yeust:{${scope.name}}:*`,
  ])) as string[];

  if (keys.length === 0) {
    return;
  }

  await client.send("DEL", keys);
}
