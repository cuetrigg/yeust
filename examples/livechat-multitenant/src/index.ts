import { RedisClient, serve, type ServerWebSocket } from "bun";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import index from "./index.html";
import {
  RedisEmulsifier,
  createSocketContext,
  serializeFrame,
  withMessageId,
  type InboundFrame,
  type OutboundFrame,
} from "../../../index.ts";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

type WidgetPosition = "left" | "right";

interface LivechatTheme {
  primaryColor: string;
  panelColor: string;
  surfaceColor: string;
  textColor: string;
  bubbleVisitor: string;
  bubbleAgent: string;
}

interface LivechatMessageRecord {
  messageId: string;
  tenantUuid: string;
  sessionId: string;
  pocketId: string;
  senderLabel: string;
  senderType: "visitor" | "agent" | "system";
  text: string;
  sentAt: string;
}

interface LivechatTenantConfig {
  uuid: string;
  tenantName: string;
  publicBaseUrl: string;
  scriptUrl: string;
  websocketUrl: string;
  apiBaseUrl: string;
  title: string;
  subtitle: string;
  welcomeMessage: string;
  launcherLabel: string;
  position: WidgetPosition;
  createdAt: string;
  updatedAt: string;
  theme: LivechatTheme;
}

interface BuildRequestPayload {
  uuid: string;
  tenantName?: string;
  publicBaseUrl?: string;
  title?: string;
  subtitle?: string;
  welcomeMessage?: string;
  launcherLabel?: string;
  position?: WidgetPosition;
  primaryColor?: string;
  panelColor?: string;
  surfaceColor?: string;
  textColor?: string;
  bubbleVisitor?: string;
  bubbleAgent?: string;
}

interface LivechatSocketData {
  nodeId: string;
  socketId: string;
  recoverySessionId: string;
  tenantUuid: string;
  chatSessionId: string;
  pocketId: string;
  recoveryResumeSessionId?: string;
  resumeOffset?: string;
}

type CommandMessage =
  | { type: "join"; tenantUuid?: string; sessionId?: string }
  | { type: "client-message"; sessionId?: string; text: string; senderLabel?: string }
  | { type: "state" }
  | { type: "disconnect" };

const appPort = Number(Bun.env.PORT ?? "3010");
const redisUrl = Bun.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const scope = Bun.env.YEUST_SCOPE ?? "yeust-livechat-multitenant";
const nodeId = Bun.env.YEUST_UID ?? Bun.env.HOSTNAME ?? crypto.randomUUID();
const exampleRoot = fileURLToPath(new URL("../", import.meta.url));
const dataRoot = join(exampleRoot, "data");
const configsRoot = join(dataRoot, "configs");
const widgetsRoot = join(dataRoot, "widgets");
const widgetEntryPath = fileURLToPath(new URL("./widget-entry.ts", import.meta.url));
const historyTtlSeconds = Math.max(
  60,
  Math.floor(Number(Bun.env.HISTORY_TTL_MS ?? Bun.env.SESSION_TTL_MS ?? "120000") / 1000),
);
const historyMaxItems = Number(Bun.env.HISTORY_MAX_ITEMS ?? "200");

await mkdir(configsRoot, { recursive: true });
await mkdir(widgetsRoot, { recursive: true });

const commandClient = new RedisClient(redisUrl);
await commandClient.connect();
const streamClient = await commandClient.duplicate();
if (!streamClient.connected) {
  await streamClient.connect();
}

const emulsifier = new RedisEmulsifier<{ nodeId: string }, { nodeId: string }>(
  {
    uid: nodeId,
    commandClient,
    streamClient,
    streamName: Bun.env.YEUST_STREAM_NAME ?? `yeust:{${scope}}:stream`,
    nodesKey: Bun.env.YEUST_NODES_KEY ?? `yeust:{${scope}}:nodes`,
    sessionKeyPrefix:
      Bun.env.YEUST_SESSION_PREFIX ?? `yeust:{${scope}}:session:`,
    heartbeatIntervalMs: Number(Bun.env.HEARTBEAT_INTERVAL_MS ?? "2500"),
    heartbeatTimeoutMs: Number(Bun.env.HEARTBEAT_TIMEOUT_MS ?? "5000"),
    sessionTtlMs: Number(Bun.env.SESSION_TTL_MS ?? "120000"),
    onError: (error) => console.error(`[${nodeId}] livechat builder error`, error),
  },
  { scope },
);

const server = serve<LivechatSocketData>({
  hostname: "0.0.0.0",
  port: appPort,
  routes: {
    "/": index,
  },
  async fetch(request, serverRef) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    if (pathname === "/ws/livechat") {
      const upgraded = serverRef.upgrade(request, {
        data: {
          nodeId,
          socketId: crypto.randomUUID(),
          recoverySessionId: crypto.randomUUID(),
          tenantUuid: url.searchParams.get("uuid") ?? "",
          chatSessionId: url.searchParams.get("sessionId") ?? "",
          pocketId: url.searchParams.get("pocketId") ?? "",
          recoveryResumeSessionId:
            url.searchParams.get("recoverySessionId") ?? undefined,
          resumeOffset: url.searchParams.get("offset") ?? undefined,
        },
      });

      if (!upgraded) {
        return new Response("Upgrade failed", { status: 400 });
      }

      return;
    }

    if (pathname === "/api/livechat/build" && request.method === "POST") {
      return handleBuildRequest(request);
    }

    if (pathname === "/api/livechat/messages" && request.method === "POST") {
      return handlePocketMessage(request);
    }

    if (pathname === "/api/livechat/configs" && request.method === "GET") {
      return Response.json(
        { configs: await listConfigs() },
        { headers: CORS_HEADERS },
      );
    }

    if (pathname === "/api/livechat/history" && request.method === "GET") {
      const tenantUuid = normalizeUuid(url.searchParams.get("tenantUuid") ?? undefined);
      const sessionId = normalizeSessionId(url.searchParams.get("sessionId") ?? undefined);

      if (!tenantUuid || !sessionId) {
        return new Response("tenantUuid and sessionId are required.", {
          status: 400,
          headers: CORS_HEADERS,
        });
      }

      return Response.json(
        {
          tenantUuid,
          sessionId,
          pocketId: buildSessionPocketId(tenantUuid, sessionId),
          messages: await listSessionMessages(tenantUuid, sessionId),
        },
        { headers: CORS_HEADERS },
      );
    }

    if (pathname === "/health") {
      return Response.json(
        {
          ok: true,
          nodeId,
          scope,
          sockets: emulsifier.size,
        },
        { headers: CORS_HEADERS },
      );
    }

    if (/^\/livechat-[A-Za-z0-9_-]+\.js$/.test(pathname)) {
      const filePath = join(widgetsRoot, basename(pathname));
      if (!existsSync(filePath)) {
        return new Response("Widget not found", { status: 404 });
      }
      return new Response(Bun.file(filePath), {
        headers: {
          ...CORS_HEADERS,
          "content-type": "text/javascript; charset=utf-8",
        },
      });
    }

    if (pathname.startsWith("/configs/")) {
      return new Response("Not found", { status: 404 });
    }

    if (pathname === "/") {
      return index as unknown as Response;
    }

    return new Response("Not found", { status: 404 });
  },
  websocket: {
    open: async (ws) => {
      let recovered = null;

      if (ws.data.recoveryResumeSessionId && ws.data.resumeOffset) {
        recovered = await emulsifier.restoreSession(
          ws.data.recoveryResumeSessionId,
          ws.data.resumeOffset,
        );
      }

      const tenantUuid = normalizeUuid(ws.data.tenantUuid);
      const chatSessionId = normalizeSessionId(ws.data.chatSessionId);

      if (!tenantUuid || !chatSessionId) {
        ws.close(4001, "Missing tenant uuid or chat session id");
        return;
      }

      const pocketId = buildSessionPocketId(tenantUuid, chatSessionId);

      if (recovered) {
        ws.data.socketId = recovered.socketId;
        ws.data.recoverySessionId = recovered.sessionId;
      }

      ws.data.tenantUuid = tenantUuid;
      ws.data.chatSessionId = chatSessionId;
      ws.data.pocketId = pocketId;

      emulsifier.addSocket(
        createSocketContext({
          socketId: ws.data.socketId,
          sessionId: ws.data.recoverySessionId,
          ws,
          pockets: [pocketId],
          data: { nodeId },
        }),
      );

      sendSystem(ws, "welcome", {
        nodeId,
        socketId: ws.data.socketId,
        recoverySessionId: ws.data.recoverySessionId,
        sessionId: ws.data.chatSessionId,
        tenantUuid,
        pocketId,
        recovered: Boolean(recovered),
        missedFrames: recovered?.missedFrames.length ?? 0,
      });

      for (const frame of recovered?.missedFrames ?? []) {
        ws.send(serializeFrame(frame));
      }
    },
    message: async (ws, message) => {
      const payload = JSON.parse(
        typeof message === "string" ? message : message.toString("utf8"),
      ) as CommandMessage | InboundFrame;

      if (isAckFrame(payload)) {
        await emulsifier.handleInboundFrame(ws.data.socketId, payload);
        return;
      }

      switch (payload.type) {
        case "join": {
          const tenantUuid = normalizeUuid(payload.tenantUuid ?? ws.data.tenantUuid);
          const chatSessionId = normalizeSessionId(
            payload.sessionId ?? ws.data.chatSessionId,
          );

          if (!tenantUuid || !chatSessionId) {
            sendSystem(ws, "error", { message: "Invalid tenant uuid or session id" });
            return;
          }

          const pocketId = buildSessionPocketId(tenantUuid, chatSessionId);
          await emulsifier.join(ws.data.socketId, [pocketId]);
          ws.data.tenantUuid = tenantUuid;
          ws.data.chatSessionId = chatSessionId;
          ws.data.pocketId = pocketId;
          sendSystem(ws, "joined", { nodeId, tenantUuid, sessionId: chatSessionId, pocketId });
          return;
        }
        case "client-message": {
          const chatSessionId = normalizeSessionId(
            payload.sessionId ?? ws.data.chatSessionId,
          );
          const tenantUuid = normalizeUuid(ws.data.tenantUuid);
          if (!tenantUuid || !chatSessionId || !payload.text.trim()) {
            sendSystem(ws, "error", { message: "Tenant uuid, session id, and text are required." });
            return;
          }

          await broadcastPocketMessage({
            tenantUuid,
            sessionId: chatSessionId,
            pocketId: buildSessionPocketId(tenantUuid, chatSessionId),
            senderLabel: payload.senderLabel ?? "visitor",
            senderType: "visitor",
            text: payload.text,
          });
          return;
        }
        case "state": {
          sendSystem(ws, "state", {
            nodeId,
            socketId: ws.data.socketId,
            recoverySessionId: ws.data.recoverySessionId,
            sessionId: ws.data.chatSessionId,
            tenantUuid: ws.data.tenantUuid,
            pocketId: ws.data.pocketId,
          });
          return;
        }
        case "disconnect": {
          ws.close(1000, "client requested disconnect");
          return;
        }
      }
    },
    close: async (ws) => {
      await emulsifier.removeSocket(ws.data.socketId);
    },
  },
  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

console.log(`[${nodeId}] livechat builder running at ${server.url}`);

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function shutdown(): Promise<void> {
  server.stop(true);
  await emulsifier.close();
  if (commandClient.connected) commandClient.close();
  if (streamClient.connected) streamClient.close();
  process.exit(0);
}

async function handleBuildRequest(request: Request): Promise<Response> {
  try {
    const payload = (await request.json()) as BuildRequestPayload;
    const uuid = normalizeUuid(payload.uuid);

    if (!uuid) {
      return new Response("Payload must include a valid uuid.", { status: 400 });
    }

    const now = new Date().toISOString();
    const publicBaseUrl = normalizeBaseUrl(
      payload.publicBaseUrl ?? inferPublicBaseUrl(request),
    );
    const existingConfig = await readConfig(uuid);
    const config: LivechatTenantConfig = {
      uuid,
      tenantName: payload.tenantName?.trim() || existingConfig?.tenantName || "Tenant Live Chat",
      publicBaseUrl,
      scriptUrl: `${publicBaseUrl}/livechat-${uuid}.js`,
      websocketUrl: `${publicBaseUrl.replace(/^http/, "ws")}/ws/livechat`,
      apiBaseUrl: `${publicBaseUrl}/api/livechat`,
      title: payload.title?.trim() || existingConfig?.title || "Live chat",
      subtitle:
        payload.subtitle?.trim() ||
        existingConfig?.subtitle ||
        "Multi-tenant live support powered by yeust",
      welcomeMessage:
        payload.welcomeMessage?.trim() ||
        existingConfig?.welcomeMessage ||
        "Hi there. Send a message and we will respond as soon as possible.",
      launcherLabel:
        payload.launcherLabel?.trim() || existingConfig?.launcherLabel || "Chat now",
      position: payload.position ?? existingConfig?.position ?? "right",
      createdAt: existingConfig?.createdAt ?? now,
      updatedAt: now,
      theme: {
        primaryColor:
          normalizeHex(payload.primaryColor) ?? existingConfig?.theme.primaryColor ?? "#0f766e",
        panelColor:
          normalizeHex(payload.panelColor) ?? existingConfig?.theme.panelColor ?? "#0f172a",
        surfaceColor:
          normalizeHex(payload.surfaceColor) ?? existingConfig?.theme.surfaceColor ?? "#fffaf2",
        textColor:
          normalizeHex(payload.textColor) ?? existingConfig?.theme.textColor ?? "#f8fafc",
        bubbleVisitor:
          normalizeHex(payload.bubbleVisitor) ?? existingConfig?.theme.bubbleVisitor ?? "#134e4a",
        bubbleAgent:
          normalizeHex(payload.bubbleAgent) ?? existingConfig?.theme.bubbleAgent ?? "#ffffff",
      },
    };

    await writeConfig(config);
    await buildWidget(config);

    return Response.json({
      ok: true,
      config,
      embedSnippet: `<script src="${config.scriptUrl}" async></script>`,
    }, { headers: CORS_HEADERS });
  } catch (error) {
    return new Response(
      error instanceof Error ? error.message : String(error),
      { status: 500, headers: CORS_HEADERS },
    );
  }
}

async function handlePocketMessage(request: Request): Promise<Response> {
  try {
    const payload = (await request.json()) as {
      tenantUuid?: string;
      sessionId?: string;
      pocketId?: string;
      senderLabel?: string;
      text?: string;
    };
    const tenantUuid = normalizeUuid(payload.tenantUuid);
    const sessionId = normalizeSessionId(payload.sessionId);
    const pocketId =
      normalizePocketId(payload.pocketId) ??
      (tenantUuid && sessionId
        ? buildSessionPocketId(tenantUuid, sessionId)
        : null);
    const text = payload.text?.trim();

    if (!pocketId || !text) {
      return new Response(
        "Payload must include text and either pocketId or tenantUuid + sessionId.",
        { status: 400, headers: CORS_HEADERS },
      );
    }

    await broadcastPocketMessage({
      tenantUuid:
        tenantUuid ?? extractTenantUuidFromPocketId(pocketId) ?? "unknown-tenant",
      sessionId:
        sessionId ?? extractSessionIdFromPocketId(pocketId) ?? "unknown-session",
      pocketId,
      senderLabel: payload.senderLabel?.trim() || "server",
      senderType: "agent",
      text,
    });

    return Response.json({
      ok: true,
      tenantUuid: tenantUuid ?? extractTenantUuidFromPocketId(pocketId),
      sessionId: sessionId ?? extractSessionIdFromPocketId(pocketId),
      pocketId,
      acceptedAt: new Date().toISOString(),
    }, { headers: CORS_HEADERS });
  } catch (error) {
    return new Response(
      error instanceof Error ? error.message : String(error),
      { status: 500, headers: CORS_HEADERS },
    );
  }
}

async function broadcastPocketMessage({
  tenantUuid,
  sessionId,
  pocketId,
  senderLabel,
  senderType,
  text,
}: {
  tenantUuid: string;
  sessionId: string;
  pocketId: string;
  senderLabel: string;
  senderType: "visitor" | "agent" | "system";
  text: string;
}): Promise<void> {
  const sentAt = new Date().toISOString();
  const frame = withMessageId({
    kind: "event",
    event: "livechat:message",
    data: {
      messageId: "",
      tenantUuid,
      sessionId,
      pocketId,
      senderLabel,
      senderType,
      text,
      sentAt,
    },
  }) as OutboundFrame & { id: string; data: LivechatMessageRecord };

  frame.data.messageId = frame.id;

  await appendSessionMessage({
    messageId: frame.id,
    tenantUuid,
    sessionId,
    pocketId,
    senderLabel,
    senderType,
    text,
    sentAt,
  });

  await emulsifier.broadcast(frame, { pockets: [pocketId] });
}

async function appendSessionMessage(message: LivechatMessageRecord): Promise<void> {
  const historyKey = getHistoryKey(message.tenantUuid, message.sessionId);
  await commandClient.send("RPUSH", [historyKey, JSON.stringify(message)]);
  await commandClient.send("LTRIM", [historyKey, String(-historyMaxItems), "-1"]);
  await commandClient.send("EXPIRE", [historyKey, String(historyTtlSeconds)]);
}

async function listSessionMessages(
  tenantUuid: string,
  sessionId: string,
): Promise<LivechatMessageRecord[]> {
  const historyKey = getHistoryKey(tenantUuid, sessionId);
  const values = (await commandClient.send("LRANGE", [historyKey, "0", "-1"])) as
    | string[]
    | null;

  if (!values || !Array.isArray(values)) {
    return [];
  }

  return values.map((value) => JSON.parse(value) as LivechatMessageRecord);
}

function getHistoryKey(tenantUuid: string, sessionId: string): string {
  return `yeust:{${scope}}:history:${tenantUuid}:${sessionId}`;
}

async function listConfigs(): Promise<LivechatTenantConfig[]> {
  const entries = await readdir(configsRoot, { withFileTypes: true });
  const configs = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => {
        const raw = await readFile(join(configsRoot, entry.name), "utf8");
        return JSON.parse(raw) as LivechatTenantConfig;
      }),
  );

  return configs.sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

async function readConfig(uuid: string): Promise<LivechatTenantConfig | null> {
  const configPath = getConfigPath(uuid);
  if (!existsSync(configPath)) {
    return null;
  }

  const raw = await readFile(configPath, "utf8");
  return JSON.parse(raw) as LivechatTenantConfig;
}

async function writeConfig(config: LivechatTenantConfig): Promise<void> {
  await writeFile(getConfigPath(config.uuid), JSON.stringify(config, null, 2));
}

async function buildWidget(config: LivechatTenantConfig): Promise<void> {
  const result = await Bun.build({
    entrypoints: [widgetEntryPath],
    target: "browser",
    format: "iife",
    minify: true,
    outdir: widgetsRoot,
    naming: {
      entry: `livechat-${config.uuid}.js`,
    },
    throw: false,
    define: {
      __LIVECHAT_UUID__: JSON.stringify(config.uuid),
      __LIVECHAT_CONFIG__: JSON.stringify(JSON.stringify(config)),
    },
  });

  if (!result.success) {
    const message = result.logs[0]?.message ?? "Widget build failed.";
    throw new Error(message);
  }
}

function getConfigPath(uuid: string): string {
  return join(configsRoot, `livechat-${uuid}.json`);
}

function getWidgetPath(uuid: string): string {
  return join(widgetsRoot, `livechat-${uuid}.js`);
}

function normalizeUuid(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : null;
}

function normalizeSessionId(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : null;
}

function normalizePocketId(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9:_-]+$/.test(trimmed) ? trimmed : null;
}

function buildSessionPocketId(tenantUuid: string, sessionId: string): string {
  return `tenant:${tenantUuid}:session:${sessionId}`;
}

function extractTenantUuidFromPocketId(pocketId: string): string | null {
  const match = pocketId.match(/^tenant:([^:]+):session:[^:]+$/);
  return match?.[1] ?? null;
}

function extractSessionIdFromPocketId(pocketId: string): string | null {
  const match = pocketId.match(/^tenant:[^:]+:session:([^:]+)$/);
  return match?.[1] ?? null;
}

function normalizeHex(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^#[0-9A-Fa-f]{6}$/.test(trimmed) ? trimmed : null;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/$/, "");
}

function inferPublicBaseUrl(request: Request): string {
  const url = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const forwardedHost = request.headers.get("x-forwarded-host") ?? url.host;
  return `${forwardedProto}://${forwardedHost}`;
}

function isAckFrame(message: CommandMessage | InboundFrame): message is InboundFrame {
  return typeof message === "object" && message !== null && "kind" in message;
}

function sendSystem(
  ws: ServerWebSocket<LivechatSocketData>,
  event: string,
  data?: unknown,
): void {
  ws.send(serializeFrame({ kind: "system", event, data }));
}
