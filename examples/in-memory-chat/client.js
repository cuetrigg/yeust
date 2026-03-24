const state = {
  ws: null,
  lastAckableId: "",
};

const el = {
  status: document.querySelector("#status"),
  session: document.querySelector("#session"),
  socket: document.querySelector("#socket"),
  pockets: document.querySelector("#pockets"),
  message: document.querySelector("#message"),
  autoAck: document.querySelector("#auto-ack"),
  log: document.querySelector("#log"),
};

document.querySelector("#connect").addEventListener("click", connect);
document.querySelector("#join").addEventListener("click", () =>
  send({ type: "join", pockets: parsePockets() }),
);
document.querySelector("#leave").addEventListener("click", () =>
  send({ type: "leave", pockets: parsePockets() }),
);
document.querySelector("#broadcast").addEventListener("click", () =>
  send({
    type: "broadcast",
    event: "chat:message",
    message: el.message.value,
  }),
);
document.querySelector("#broadcast-ack").addEventListener("click", () =>
  send({
    type: "broadcast",
    event: "chat:message",
    message: el.message.value,
    expectAck: true,
  }),
);
document.querySelector("#ack").addEventListener("click", () => {
  if (!state.lastAckableId) return;
  send(createAckPayload(state.lastAckableId, { manual: true }));
});
document.querySelector("#state").addEventListener("click", () => send({ type: "state" }));

connect();

function connect() {
  state.ws?.close();
  const ws = new WebSocket(`ws://${location.host}/ws`);
  state.ws = ws;
  updateStatus("connecting");

  ws.onopen = () => updateStatus("connected");
  ws.onclose = () => updateStatus("closed");
  ws.onmessage = (event) => {
    const frame = JSON.parse(event.data);

    if (frame.kind === "event") {
      state.lastAckableId = frame.id ?? "";
      log(`EVENT ${frame.event} ${JSON.stringify(frame.data)}`);

      if (el.autoAck.checked && frame.id) {
        send(createAckPayload(frame.id, { auto: true }));
      }

      return;
    }

    log(`${frame.event.toUpperCase()} ${JSON.stringify(frame.data)}`);

    if (frame.event === "welcome" || frame.event === "state") {
      el.socket.textContent = frame.data?.socketId ?? "-";
      el.session.textContent = frame.data?.sessionId ?? "-";
    }
  };
}

function send(payload) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    log("Socket not connected.");
    return;
  }

  state.ws.send(JSON.stringify(payload));
}

function parsePockets() {
  return el.pockets.value
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function updateStatus(value) {
  el.status.textContent = value;
}

function createAckPayload(replyTo, data) {
  return {
    kind: "ack",
    event: "ack",
    replyTo,
    data,
  };
}

function log(line) {
  el.log.textContent += `${line}\n`;
  el.log.scrollTop = el.log.scrollHeight;
}
