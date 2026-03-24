import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./index.css";

type Frame = {
  kind: "event" | "ack" | "system";
  event: string;
  id?: string;
  offset?: string;
  data?: Record<string, unknown>;
};

type ConnectionState = "connecting" | "connected" | "closed";

const sessionKey = "yeust:swarm-example:session";
const offsetKey = "yeust:swarm-example:offset";

export function App() {
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<ConnectionState>("connecting");
  const [nodeId, setNodeId] = useState("-");
  const [socketId, setSocketId] = useState("-");
  const [sessionId, setSessionId] = useState(() => localStorage.getItem(sessionKey) ?? "");
  const [lastOffset, setLastOffset] = useState(() => localStorage.getItem(offsetKey) ?? "");
  const [pocketsInput, setPocketsInput] = useState("alpha");
  const [exceptInput, setExceptInput] = useState("ignore");
  const [messageInput, setMessageInput] = useState("Hello from the swarm React example");
  const [autoAck, setAutoAck] = useState(true);
  const [lastAckableId, setLastAckableId] = useState("");
  const [logs, setLogs] = useState<string[]>([]);

  const pockets = useMemo(() => parseList(pocketsInput), [pocketsInput]);
  const except = useMemo(() => parseList(exceptInput), [exceptInput]);

  const appendLog = useCallback((line: string) => {
    setLogs((current) => [...current, line]);
  }, []);

  const send = useCallback((payload: unknown) => {
    const ws = wsRef.current;

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      appendLog("Socket not connected.");
      return;
    }

    ws.send(JSON.stringify(payload));
  }, [appendLog]);

  const connect = useCallback((useRecovery: boolean) => {
    wsRef.current?.close();

    const url = new URL("/ws", window.location.href);
    if (useRecovery && sessionId && lastOffset) {
      url.searchParams.set("sessionId", sessionId);
      url.searchParams.set("offset", lastOffset);
    }

    const ws = new WebSocket(url);
    wsRef.current = ws;
    setStatus("connecting");

    ws.onopen = () => setStatus("connected");
    ws.onclose = () => setStatus("closed");
    ws.onmessage = (event) => {
      const frame = JSON.parse(String(event.data)) as Frame;

      if (frame.offset) {
        setLastOffset(frame.offset);
        localStorage.setItem(offsetKey, frame.offset);
      }

      if (frame.kind === "event") {
        setLastAckableId(frame.id ?? "");
        appendLog(`EVENT ${frame.event} ${JSON.stringify(frame.data)}`);

        if (autoAck && frame.id) {
          send({ kind: "ack", event: "ack", replyTo: frame.id, data: { auto: true } });
        }

        return;
      }

      appendLog(`${frame.event.toUpperCase()} ${JSON.stringify(frame.data)}`);

      if (frame.event === "welcome" || frame.event === "state") {
        const data = frame.data ?? {};
        setNodeId(String(data.nodeId ?? "-"));
        setSocketId(String(data.socketId ?? "-"));
        const nextSessionId = String(data.sessionId ?? (sessionId || "-"));
        setSessionId(nextSessionId);
        if (nextSessionId && nextSessionId !== "-") {
          localStorage.setItem(sessionKey, nextSessionId);
        }
      }
    };
  }, [appendLog, autoAck, lastOffset, send, sessionId]);

  useEffect(() => {
    connect(true);

    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  return (
    <main className="page-shell swarm-theme">
      <section className="hero-card">
        <p className="eyebrow">React + Docker Swarm</p>
        <h1>Redis Clustered Pockets</h1>
        <p className="lede">
          A React client and Bun server wired to <code>RedisEmulsifier</code> for
          clustered broadcasts, acknowledgements, and recovery.
        </p>
        <div className="meta-grid">
          <div><span>Status</span><strong>{status}</strong></div>
          <div><span>Node</span><strong>{nodeId}</strong></div>
          <div><span>Socket</span><strong>{socketId}</strong></div>
          <div><span>Session</span><strong>{sessionId || "-"}</strong></div>
          <div><span>Offset</span><strong>{lastOffset || "-"}</strong></div>
        </div>
        <div className="button-row">
          <button type="button" onClick={() => {
            localStorage.removeItem(sessionKey);
            localStorage.removeItem(offsetKey);
            setSessionId("");
            setLastOffset("");
            connect(false);
          }}>Connect Fresh</button>
          <button type="button" onClick={() => connect(true)}>Reconnect</button>
          <button type="button" className="ghost" onClick={() => send({ type: "state" })}>State</button>
          <button type="button" className="accent" onClick={() => send({ type: "disconnect" })}>Disconnect</button>
        </div>
      </section>

      <section className="panel-grid">
        <article className="panel-card">
          <h2>Pockets</h2>
          <label>
            Join pockets
            <input value={pocketsInput} onChange={(event) => setPocketsInput(event.target.value)} />
          </label>
          <label>
            Except pockets
            <input value={exceptInput} onChange={(event) => setExceptInput(event.target.value)} />
          </label>
          <div className="button-row">
            <button type="button" onClick={() => send({ type: "join", pockets })}>Join</button>
            <button type="button" className="accent" onClick={() => send({ type: "leave", pockets })}>Leave</button>
          </div>
        </article>

        <article className="panel-card">
          <h2>Broadcast</h2>
          <label>
            Message
            <input value={messageInput} onChange={(event) => setMessageInput(event.target.value)} />
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={autoAck} onChange={(event) => setAutoAck(event.target.checked)} />
            Auto-ack incoming events
          </label>
          <div className="button-row">
            <button type="button" onClick={() => send({ type: "broadcast", message: messageInput, except })}>Broadcast</button>
            <button type="button" className="accent" onClick={() => send({ type: "broadcast", message: messageInput, except, expectAck: true })}>Broadcast With Ack</button>
            <button type="button" className="ghost" onClick={() => lastAckableId && send({ kind: "ack", event: "ack", replyTo: lastAckableId, data: { manual: true } })}>Ack Last</button>
          </div>
        </article>
      </section>

      <section className="panel-card log-card">
        <div className="section-head">
          <h2>Cluster Log</h2>
          <button type="button" className="ghost" onClick={() => setLogs([])}>Clear</button>
        </div>
        <pre>{logs.join("\n")}</pre>
      </section>
    </main>
  );
}

function parseList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export default App;
