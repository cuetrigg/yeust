declare const __LIVECHAT_UUID__: string;
declare const __LIVECHAT_CONFIG__: string;

type TenantConfig = {
  uuid: string;
  tenantName: string;
  websocketUrl: string;
  apiBaseUrl: string;
  title: string;
  subtitle: string;
  welcomeMessage: string;
  launcherLabel: string;
  position: "left" | "right";
  theme: {
    primaryColor: string;
    panelColor: string;
    surfaceColor: string;
    textColor: string;
    bubbleVisitor: string;
    bubbleAgent: string;
  };
};

type MessagePayload = {
  messageId: string;
  tenantUuid: string;
  sessionId: string;
  pocketId: string;
  senderLabel: string;
  senderType: "visitor" | "agent" | "system";
  text: string;
  sentAt: string;
};

void bootstrap();

async function bootstrap(): Promise<void> {
  const config = JSON.parse(__LIVECHAT_CONFIG__) as TenantConfig;

  const container = document.createElement("div");
  container.dataset.livechatUuid = __LIVECHAT_UUID__;
  document.body.append(container);

  const shadow = container.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>${createStyles(config)}</style>
    <div class="livechat-shell ${config.position}">
      <button class="launcher" type="button">${escapeHtml(config.launcherLabel)}</button>
      <section class="panel hidden">
        <header>
          <div>
            <p class="tenant">${escapeHtml(config.tenantName)}</p>
            <h2>${escapeHtml(config.title)}</h2>
            <p class="subtitle">${escapeHtml(config.subtitle)}</p>
          </div>
          <button class="close" type="button" aria-label="Close chat">&times;</button>
        </header>
        <div class="messages"></div>
        <form class="composer">
          <input type="text" name="message" placeholder="Send a message..." autocomplete="off" />
          <button type="submit">Send</button>
        </form>
      </section>
    </div>
  `;

  const launcher = shadow.querySelector<HTMLButtonElement>(".launcher")!;
  const panel = shadow.querySelector<HTMLElement>(".panel")!;
  const close = shadow.querySelector<HTMLButtonElement>(".close")!;
  const messages = shadow.querySelector<HTMLElement>(".messages")!;
  const composer = shadow.querySelector<HTMLFormElement>(".composer")!;
  const messageInput = shadow.querySelector<HTMLInputElement>('input[name="message"]')!;

  launcher.addEventListener("click", () => panel.classList.toggle("hidden"));
  close.addEventListener("click", () => panel.classList.add("hidden"));

  const sessionStorageKey = `yeust-livechat:session:${config.uuid}`;
  const recoverySessionStorageKey = `yeust-livechat:recovery:${config.uuid}`;
  const offsetStorageKey = `yeust-livechat:offset:${config.uuid}`;
  const renderedMessages = new Set<string>();
  const chatSessionId =
    sessionStorage.getItem(sessionStorageKey) ?? crypto.randomUUID();
  sessionStorage.setItem(sessionStorageKey, chatSessionId);

  const historyUrl = new URL(`${config.apiBaseUrl}/history`);
  historyUrl.searchParams.set("tenantUuid", config.uuid);
  historyUrl.searchParams.set("sessionId", chatSessionId);
  const history = (await fetch(historyUrl).then((response) => {
    if (!response.ok) {
      throw new Error(`Failed to load ${historyUrl}`);
    }

    return response.json();
  })) as { messages: MessagePayload[] };

  for (const message of history.messages) {
    appendMessage(messages, message, renderedMessages);
  }

  if (history.messages.length === 0) {
    appendMessage(
      messages,
      {
        messageId: `welcome:${config.uuid}`,
        tenantUuid: config.uuid,
        sessionId: chatSessionId,
        pocketId: `tenant:${config.uuid}:session:${chatSessionId}`,
        senderLabel: config.tenantName,
        senderType: "agent",
        text: config.welcomeMessage,
        sentAt: new Date().toISOString(),
      },
      renderedMessages,
    );
  }

  const wsUrl = new URL(config.websocketUrl);
  wsUrl.searchParams.set("uuid", config.uuid);
  wsUrl.searchParams.set("sessionId", chatSessionId);

  const recoverySessionId = sessionStorage.getItem(recoverySessionStorageKey);
  const offset = sessionStorage.getItem(offsetStorageKey);
  if (recoverySessionId && offset) {
    wsUrl.searchParams.set("recoverySessionId", recoverySessionId);
    wsUrl.searchParams.set("offset", offset);
  }

  const ws = new WebSocket(wsUrl);

  ws.addEventListener("message", (event) => {
    const frame = JSON.parse(String(event.data)) as {
      kind: "event" | "system";
      event: string;
      id?: string;
      offset?: string;
      data?: Record<string, unknown>;
    };

    if (frame.offset) {
      sessionStorage.setItem(offsetStorageKey, frame.offset);
    }

    if (frame.kind === "system") {
      if (frame.event === "welcome") {
        const nextSessionId = frame.data?.sessionId;
        const nextRecoverySessionId = frame.data?.recoverySessionId;
        if (typeof nextSessionId === "string") {
          sessionStorage.setItem(sessionStorageKey, nextSessionId);
        }
        if (typeof nextRecoverySessionId === "string") {
          sessionStorage.setItem(recoverySessionStorageKey, nextRecoverySessionId);
        }
      }
      return;
    }

    if (frame.event === "livechat:message") {
      const payload = frame.data as unknown as MessagePayload;
      if (!payload.messageId && frame.id) {
        payload.messageId = frame.id;
      }
      appendMessage(messages, payload, renderedMessages);
    }
  });

  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = messageInput.value.trim();
    if (!text) return;

    ws.send(
      JSON.stringify({
        type: "client-message",
        sessionId: chatSessionId,
        text,
        senderLabel: "visitor",
      }),
    );
    messageInput.value = "";
  });
}

function appendMessage(
  target: HTMLElement,
  message: MessagePayload,
  renderedMessages: Set<string>,
): void {
  if (renderedMessages.has(message.messageId)) {
    return;
  }

  renderedMessages.add(message.messageId);
  const item = document.createElement("article");
  item.className = `message ${message.senderType}`;
  item.innerHTML = `
    <div class="meta">
      <span>${escapeHtml(message.senderLabel)}</span>
      <time>${new Date(message.sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
    </div>
    <p>${escapeHtml(message.text)}</p>
  `;
  target.append(item);
  target.scrollTop = target.scrollHeight;
}

function createStyles(config: TenantConfig): string {
  return `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: Inter, Arial, sans-serif; }
    .livechat-shell { position: fixed; bottom: 20px; z-index: 2147483000; }
    .livechat-shell.right { right: 20px; }
    .livechat-shell.left { left: 20px; }
    .launcher {
      border: 0;
      border-radius: 999px;
      padding: 14px 18px;
      cursor: pointer;
      font-weight: 700;
      color: ${config.theme.textColor};
      background: ${config.theme.primaryColor};
      box-shadow: 0 18px 30px rgba(15, 23, 42, 0.28);
    }
    .panel {
      margin-top: 12px;
      width: min(360px, calc(100vw - 32px));
      border-radius: 24px;
      overflow: hidden;
      border: 1px solid rgba(255,255,255,0.12);
      background: ${config.theme.surfaceColor};
      color: #111827;
      box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28);
    }
    .panel.hidden { display: none; }
    header {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 18px;
      color: ${config.theme.textColor};
      background: ${config.theme.panelColor};
    }
    .tenant { margin: 0 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .16em; opacity: .8; }
    h2 { margin: 0; font-size: 20px; }
    .subtitle { margin: 6px 0 0; font-size: 13px; opacity: .8; }
    .close { border: 0; background: transparent; color: ${config.theme.textColor}; font-size: 24px; cursor: pointer; }
    .messages { max-height: 340px; overflow: auto; padding: 16px; background: ${config.theme.surfaceColor}; }
    .message { margin-bottom: 12px; padding: 12px 14px; border-radius: 16px; }
    .message.agent, .message.system { background: ${config.theme.bubbleAgent}; color: #111827; }
    .message.visitor { background: ${config.theme.bubbleVisitor}; color: ${config.theme.textColor}; }
    .meta { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .12em; opacity: .72; }
    .message p { margin: 0; line-height: 1.5; white-space: pre-wrap; }
    .composer {
      display: flex;
      gap: 10px;
      padding: 16px;
      border-top: 1px solid rgba(15, 23, 42, 0.08);
      background: white;
    }
    .composer input {
      flex: 1;
      border-radius: 14px;
      border: 1px solid rgba(15, 23, 42, 0.12);
      padding: 12px 14px;
      outline: none;
    }
    .composer button {
      border: 0;
      border-radius: 14px;
      padding: 0 16px;
      cursor: pointer;
      font-weight: 700;
      color: ${config.theme.textColor};
      background: ${config.theme.primaryColor};
    }
  `;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
