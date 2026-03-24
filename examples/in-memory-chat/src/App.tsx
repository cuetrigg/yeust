import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./index.css";

type Frame = {
  kind: "event" | "ack" | "system";
  event: string;
  id?: string;
  offset?: string;
  data?: unknown;
};

type ConnectionState = "connecting" | "connected" | "closed";

export function App() {
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<ConnectionState>("connecting");
  const [socketId, setSocketId] = useState("-");
  const [sessionId, setSessionId] = useState("-");
  const [pocketsInput, setPocketsInput] = useState("alpha");
  const [messageInput, setMessageInput] = useState(
    "Hello from the in-memory React example",
  );
  const [autoAck, setAutoAck] = useState(true);
  const [lastAckableId, setLastAckableId] = useState("");
  const [logs, setLogs] = useState<string[]>([]);

  const pockets = useMemo(
    () => pocketsInput.split(",").map((value) => value.trim()).filter(Boolean),
    [pocketsInput],
  );

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

  const connect = useCallback(() => {
    wsRef.current?.close();
    const ws = new WebSocket(`ws://${window.location.host}/ws`);
    wsRef.current = ws;
    setStatus("connecting");

    ws.onopen = () => setStatus("connected");
    ws.onclose = () => setStatus("closed");
    ws.onmessage = (event) => {
      const frame = JSON.parse(String(event.data)) as Frame;

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
        const data = frame.data as { socketId?: string; sessionId?: string } | undefined;
        setSocketId(data?.socketId ?? "-");
        setSessionId(data?.sessionId ?? "-");
      }
    };
  }, [appendLog, autoAck, send]);

  useEffect(() => {
    connect();

    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  return (
    <main className="page-shell memory-theme">
      <section className="hero-card">
        <p className="eyebrow">React Example</p>
        <h1>In-Memory Pockets</h1>
        <p className="lede">
          A React client and Bun server using <code>MemoryEmulsifier</code> for
          single-process pocket fanout.
        </p>
        <div className="meta-grid">
          <div><span>Status</span><strong>{status}</strong></div>
          <div><span>Socket</span><strong>{socketId}</strong></div>
          <div><span>Session</span><strong>{sessionId}</strong></div>
        </div>
        <div className="button-row">
          <button type="button" onClick={connect}>Reconnect</button>
          <button type="button" className="ghost" onClick={() => send({ type: "state" })}>State</button>
        </div>
      </section>

      <section className="panel-grid">
        <article className="panel-card">
          <h2>Pockets</h2>
          <label>
            Pocket list
            <input value={pocketsInput} onChange={(event) => setPocketsInput(event.target.value)} />
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
            <button type="button" onClick={() => send({ type: "broadcast", event: "chat:message", message: messageInput })}>Broadcast</button>
            <button type="button" className="accent" onClick={() => send({ type: "broadcast", event: "chat:message", message: messageInput, expectAck: true })}>Broadcast With Ack</button>
            <button type="button" className="ghost" onClick={() => lastAckableId && send({ kind: "ack", event: "ack", replyTo: lastAckableId, data: { manual: true } })}>Ack Last</button>
          </div>
        </article>
      </section>

      <section className="panel-card log-card">
        <div className="section-head">
          <h2>Event Log</h2>
          <button type="button" className="ghost" onClick={() => setLogs([])}>Clear</button>
        </div>
        <pre>{logs.join("\n")}</pre>
      </section>
    </main>
  );
}

export default App;
