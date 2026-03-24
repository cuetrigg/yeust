import { RedisClient } from "bun";

const DEFAULT_REDIS_URL =
  Bun.env.VALKEY_URL ?? Bun.env.REDIS_URL ?? "redis://127.0.0.1:6379";

export function getRedisUrl(): string {
  return DEFAULT_REDIS_URL;
}

export async function createRedisClient(
  url = getRedisUrl(),
): Promise<RedisClient> {
  const client = new RedisClient(url);
  await client.connect();
  return client;
}

export async function duplicateRedisClient(
  client: RedisClient,
): Promise<RedisClient> {
  const duplicate = await client.duplicate();

  if (!duplicate.connected) {
    await duplicate.connect();
  }

  return duplicate;
}

export async function waitForRedis(
  url = getRedisUrl(),
  attempts = 20,
  delayMs = 100,
): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const client = new RedisClient(url, {
      autoReconnect: false,
      connectionTimeout: Math.max(delayMs, 50),
      maxRetries: 0,
    });

    try {
      await client.connect();
      await client.ping();
      client.close();
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      client.close();

      if (attempt + 1 < attempts) {
        await Bun.sleep(delayMs);
      }
    }
  }

  throw new Error(
    `Redis did not become ready at ${url}: ${lastError?.message ?? "unknown error"}`,
  );
}
