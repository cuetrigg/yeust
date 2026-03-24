const state = {
  ws: null,
  sessionId: localStorage.getItem("yeust:swarm:session") || "",
  lastOffset: localStorage.getItem("yeust:swarm:offset") || "",
  lastAckableId: "",
};

const el = {
  status: document.querySelector("#status"),
  node: document.querySelector("#node"),
  socket: document.querySelector("#socket"),
  session: document.querySelector("#session"),
  offset: document.querySelector("#offset"),
  pockets: document.querySelector("#pockets"),
  except: document.querySelector("#except"),
  message: document.querySelector("#message"),
  autoAck: document.querySelector("#auto-ack"),
  log: document.querySelector("#log"),
};

document.querySelector("#connect-fresh").addEventListener("click", () => {
  state.sessionId = "";
  state.lastOffset = "";
  localStorage.removeItem("yeust:swarm:session");
  localStorage.removeItem("yeust:swarm:offset");
  connect(false);
});
document.querySelector("#reconnect").addEventListener("click", () => connect(true));
document.querySelector("#join").addEventListener("click", () =>
  send({ type: "join", pockets: parseList(el.pockets.value) }),
);
document.querySelector("#leave").addEventListener("click", () =>
  send({ type: "leave", pockets: parseList(el.pockets.value) }),
);
document.querySelector("#broadcast").addEventListener("click", () =>
  send({
    type: "broadcast",
    message: el.message.value,
    except: parseList(el.except.value),
  }),
);
document.querySelector("#broadcast-ack").addEventListener("click", () =>
  send({
    type: "broadcast",
    message: el.message.value,
    except: parseList(el.except.value),
    expectAck: true,
  }),
);
document.querySelector("#disconnect").addEventListener("click", () =>
  send({ type: "disconnect" }),
);
document.querySelector("#state").addEventListener("click", () => send({ type: "state" }));
document.querySelector("#ack").addEventListener("click", () => {
  if (!state.lastAckableId) return;
  send({ kind: "ack", event: "ack", replyTo: state.lastAckableId, data: { manual: true } });
});

connect(true);

function connect(useRecovery) {
  state.ws?.close();
  const url = new URL("/ws", location.href);

  if (useRecovery && state.sessionId && state.lastOffset) {
    url.searchParams.set("sessionId", state.sessionId);
    url.searchParams.set("offset", state.lastOffset);
  }

  const ws = new WebSocket(url);
  state.ws = ws;
  el.status.textContent = "connecting";

  ws.onopen = () => {
    el.status.textContent = "connected";
    log(`CONNECTED ${url}`);
  };
  ws.onclose = () => {
    el.status.textContent = "closed";
    log("CLOSED");
  };
  ws.onmessage = (event) => {
    const frame = JSON.parse(event.data);

    if (frame.offset) {
      state.lastOffset = frame.offset;
      localStorage.setItem("yeust:swarm:offset", frame.offset);
      el.offset.textContent = frame.offset;
    }

    if (frame.kind === "event") {
      state.lastAckableId = frame.id || "";
      log(`EVENT ${frame.event} ${JSON.stringify(frame.data)}`);

      if (el.autoAck.checked && frame.id) {
        send({ kind: "ack", event: "ack", replyTo: frame.id, data: { auto: true } });
      }

      return;
    }

    log(`${frame.event.toUpperCase()} ${JSON.stringify(frame.data)}`);

    if (frame.event === "welcome" || frame.event === "state") {
      el.node.textContent = frame.data?.nodeId ?? "-";
      el.socket.textContent = frame.data?.socketId ?? "-";
      el.session.textContent = frame.data?.sessionId ?? "-";
      if (frame.data?.sessionId) {
        state.sessionId = frame.data.sessionId;
        localStorage.setItem("yeust:swarm:session", frame.data.sessionId);
      }
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

function parseList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function log(line) {
  el.log.textContent += `${line}\n`;
  el.log.scrollTop = el.log.scrollHeight;
}
