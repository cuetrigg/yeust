import type { RedisClient } from "bun";

export interface RedisStreamEntry {
  readonly id: string;
  readonly fields: Record<string, string>;
}

export interface XReadOptions {
  readonly blockMs?: number;
  readonly count?: number;
}

export interface XAddOptions {
  readonly maxLen?: number;
}

export interface XRangeOptions {
  readonly count?: number;
}

export async function xadd(
  client: RedisClient,
  streamName: string,
  fields: Record<string, string>,
  options: XAddOptions = {},
): Promise<string> {
  const args = [streamName];

  if (options.maxLen && options.maxLen > 0) {
    args.push("MAXLEN", "~", String(options.maxLen));
  }

  args.push("*");

  for (const [key, value] of Object.entries(fields)) {
    args.push(key, value);
  }

  const response = await client.send("XADD", args);

  if (typeof response !== "string") {
    throw new Error("Unexpected XADD response from Redis.");
  }

  return response;
}

export async function xread(
  client: RedisClient,
  streamName: string,
  offset: string,
  options: XReadOptions = {},
): Promise<RedisStreamEntry[]> {
  const blockMs = String(options.blockMs ?? 100);
  const count = String(options.count ?? 100);
  const response = await client.send("XREAD", [
    "BLOCK",
    blockMs,
    "COUNT",
    count,
    "STREAMS",
    streamName,
    offset,
  ]);

  if (response === null) {
    return [];
  }

  const rawStreams = normalizeXReadResponse(response);

  if (rawStreams === null) {
    throw new Error("Unexpected XREAD response from Redis.");
  }

  const entries: RedisStreamEntry[] = [];

  for (const streamResponse of rawStreams) {
    if (!Array.isArray(streamResponse) || streamResponse.length < 2) {
      continue;
    }

    const rawEntries = streamResponse[1];

    if (!Array.isArray(rawEntries)) {
      continue;
    }

    for (const rawEntry of rawEntries) {
      if (!Array.isArray(rawEntry) || rawEntry.length < 2) {
        continue;
      }

      const entryId = rawEntry[0];
      const rawFields = rawEntry[1];

      if (typeof entryId !== "string" || !Array.isArray(rawFields)) {
        continue;
      }

      entries.push({
        id: entryId,
        fields: pairArrayToRecord(rawFields),
      });
    }
  }

  return entries;
}

function normalizeXReadResponse(value: unknown): unknown[] | null {
  if (Array.isArray(value)) {
    return value;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const streams = Object.entries(value as Record<string, unknown>).map(
    ([streamName, entries]) => [streamName, entries],
  );

  return streams.length > 0 ? streams : null;
}

export async function xrange(
  client: RedisClient,
  streamName: string,
  start: string,
  end: string,
  options: XRangeOptions = {},
): Promise<RedisStreamEntry[]> {
  const args = [streamName, start, end];

  if (options.count && options.count > 0) {
    args.push("COUNT", String(options.count));
  }

  const response = await client.send("XRANGE", args);

  if (!Array.isArray(response)) {
    throw new Error("Unexpected XRANGE response from Redis.");
  }

  const entries: RedisStreamEntry[] = [];

  for (const rawEntry of response) {
    if (!Array.isArray(rawEntry) || rawEntry.length < 2) {
      continue;
    }

    const entryId = rawEntry[0];
    const rawFields = rawEntry[1];

    if (typeof entryId !== "string" || !Array.isArray(rawFields)) {
      continue;
    }

    entries.push({
      id: entryId,
      fields: pairArrayToRecord(rawFields),
    });
  }

  return entries;
}

function pairArrayToRecord(value: unknown[]): Record<string, string> {
  const record: Record<string, string> = {};

  for (let index = 0; index < value.length; index += 2) {
    const key = value[index];
    const fieldValue = value[index + 1];

    if (typeof key !== "string" || typeof fieldValue !== "string") {
      continue;
    }

    record[key] = fieldValue;
  }

  return record;
}
