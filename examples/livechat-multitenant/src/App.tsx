import { useCallback, useEffect, useMemo, useState } from "react";
import "./index.css";

type TenantConfig = {
  uuid: string;
  tenantName: string;
  publicBaseUrl: string;
  scriptUrl: string;
  websocketUrl: string;
  title: string;
  subtitle: string;
  welcomeMessage: string;
  launcherLabel: string;
  position: "left" | "right";
  createdAt: string;
  updatedAt: string;
  theme: {
    primaryColor: string;
    panelColor: string;
    surfaceColor: string;
    textColor: string;
    bubbleVisitor: string;
    bubbleAgent: string;
  };
};

type BuildResponse = {
  ok: true;
  config: TenantConfig;
  embedSnippet: string;
};

type BuildFormState = {
  uuid: string;
  tenantName: string;
  publicBaseUrl: string;
  title: string;
  subtitle: string;
  welcomeMessage: string;
  launcherLabel: string;
  position: "left" | "right";
  primaryColor: string;
  panelColor: string;
  surfaceColor: string;
  textColor: string;
  bubbleVisitor: string;
  bubbleAgent: string;
};

type MessageFormState = {
  tenantUuid: string;
  sessionId: string;
  senderLabel: string;
  text: string;
};

const defaultBuildForm = (): BuildFormState => ({
  uuid: crypto.randomUUID(),
  tenantName: "Acme Support",
  publicBaseUrl: "http://livechat.localhost",
  title: "Acme Live Support",
  subtitle: "A Bun + yeust multi-tenant live chat example",
  welcomeMessage: "Hi there. Ask us anything and we will reply in real time.",
  launcherLabel: "Chat with Acme",
  position: "right",
  primaryColor: "#0f766e",
  panelColor: "#0f172a",
  surfaceColor: "#fffaf2",
  textColor: "#f8fafc",
  bubbleVisitor: "#134e4a",
  bubbleAgent: "#ffffff",
});

const defaultMessageForm = (): MessageFormState => ({
  tenantUuid: "",
  sessionId: "",
  senderLabel: "crm-bot",
  text: "Hello from the server-to-server API",
});

export function App() {
  const [buildForm, setBuildForm] = useState<BuildFormState>(defaultBuildForm);
  const [messageForm, setMessageForm] = useState<MessageFormState>(defaultMessageForm);
  const [buildResult, setBuildResult] = useState<BuildResponse | null>(null);
  const [configs, setConfigs] = useState<TenantConfig[]>([]);
  const [loadingConfigs, setLoadingConfigs] = useState(true);
  const [submittingBuild, setSubmittingBuild] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [notice, setNotice] = useState<string>("");
  const [error, setError] = useState<string>("");

  const snippet = useMemo(
    () => buildResult?.embedSnippet ?? "<script src=\"http://livechat.localhost/livechat-your-uuid.js\" async></script>",
    [buildResult],
  );

  const loadConfigs = useCallback(async () => {
    setLoadingConfigs(true);
    setError("");

    try {
      const response = await fetch("/api/livechat/configs");

      if (!response.ok) {
        throw new Error(`Failed to load configs (${response.status})`);
      }

      const data = (await response.json()) as { configs: TenantConfig[] };
      setConfigs(data.configs);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : String(caughtError),
      );
    } finally {
      setLoadingConfigs(false);
    }
  }, []);

  useEffect(() => {
    void loadConfigs();
  }, [loadConfigs]);

  async function handleBuildSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittingBuild(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/livechat/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildForm),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const data = (await response.json()) as BuildResponse;
      setBuildResult(data);
      setMessageForm((current) => ({ ...current, tenantUuid: data.config.uuid }));
      setNotice(`Built ${data.config.scriptUrl}`);
      await loadConfigs();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : String(caughtError),
      );
    } finally {
      setSubmittingBuild(false);
    }
  }

  async function handleSendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSendingMessage(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/livechat/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(messageForm),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const data = (await response.json()) as {
        ok: true;
        tenantUuid: string;
        sessionId: string;
        pocketId: string;
        acceptedAt: string;
      };
      setNotice(
        `Queued server message for ${data.tenantUuid}/${data.sessionId} at ${data.acceptedAt}`,
      );
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : String(caughtError),
      );
    } finally {
      setSendingMessage(false);
    }
  }

  function updateBuildField<K extends keyof BuildFormState>(
    key: K,
    value: BuildFormState[K],
  ) {
    setBuildForm((current) => ({ ...current, [key]: value }));
  }

  function updateMessageField<K extends keyof MessageFormState>(
    key: K,
    value: MessageFormState[K],
  ) {
    setMessageForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <main className="min-h-screen bg-stone-950 text-stone-100">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
        <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top_left,_rgba(45,212,191,0.22),_transparent_28%),radial-gradient(circle_at_right,_rgba(249,115,22,0.18),_transparent_22%),linear-gradient(135deg,_rgba(15,23,42,0.98),_rgba(28,25,23,0.94))] shadow-2xl shadow-black/30">
          <div className="grid gap-8 p-8 lg:grid-cols-[1.3fr_0.7fr] lg:p-10">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-teal-300/80">
                Swarm + Traefik + Redis + React
              </p>
              <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                Multi-tenant live chat builder with dynamic JSON configs.
              </h1>
              <p className="mt-4 max-w-3xl text-base leading-7 text-stone-300 sm:text-lg">
                Generate a tenant config, build a minified chat widget named
                <code className="mx-1 rounded bg-white/10 px-2 py-1 text-sm text-white">
                  livechat-{'{uuid}'}.js
                </code>
                , serve it over HTTPS through Traefik, and push operator messages into
                a specific pocket without opening another websocket client.
              </p>
              <div className="mt-6 flex flex-wrap gap-3 text-sm text-stone-300">
                <Pill label="docker/swarm" />
                <Pill label="traefik + https" />
                <Pill label="redis pockets" />
                <Pill label="react admin" />
                <Pill label="tailwindcss" />
                <Pill label="bun api" />
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-white/10 bg-black/20 p-5 backdrop-blur">
              <h2 className="text-sm font-semibold uppercase tracking-[0.25em] text-stone-300">
                Quick flow
              </h2>
              <ol className="mt-4 space-y-3 text-sm leading-6 text-stone-200">
                <li>1. Post tenant settings to the build API.</li>
                <li>2. Store JSON under <code className="rounded bg-white/10 px-1.5 py-0.5">data/configs</code>.</li>
                <li>3. Build and minify <code className="rounded bg-white/10 px-1.5 py-0.5">livechat-{'{uuid}'}.js</code>.</li>
                <li>4. Serve widget assets and configs through Traefik HTTPS.</li>
                <li>5. Push server messages into any pocket with one API call.</li>
              </ol>
            </div>
          </div>
        </section>

        {(notice || error) && (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm ${error ? "border-rose-500/50 bg-rose-500/10 text-rose-100" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"}`}
          >
            {error || notice}
          </div>
        )}

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <form onSubmit={(event) => void handleBuildSubmit(event)} className="rounded-[1.75rem] border border-white/10 bg-stone-900/80 p-6 shadow-xl shadow-black/20">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-orange-300/80">
                  Build API
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-white">
                  Generate tenant config and widget bundle
                </h2>
              </div>
              <button
                type="button"
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10"
                onClick={() => {
                  const nextUuid = crypto.randomUUID();
                  updateBuildField("uuid", nextUuid);
                }}
              >
                New UUID
              </button>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <Field label="UUID">
                <input value={buildForm.uuid} onChange={(event) => updateBuildField("uuid", event.target.value)} className={inputClass} />
              </Field>
              <Field label="Tenant name">
                <input value={buildForm.tenantName} onChange={(event) => updateBuildField("tenantName", event.target.value)} className={inputClass} />
              </Field>
              <Field label="Public base URL">
                <input value={buildForm.publicBaseUrl} onChange={(event) => updateBuildField("publicBaseUrl", event.target.value)} className={inputClass} />
              </Field>
              <Field label="Widget title">
                <input value={buildForm.title} onChange={(event) => updateBuildField("title", event.target.value)} className={inputClass} />
              </Field>
              <Field label="Launcher label">
                <input value={buildForm.launcherLabel} onChange={(event) => updateBuildField("launcherLabel", event.target.value)} className={inputClass} />
              </Field>
              <Field label="Subtitle">
                <input value={buildForm.subtitle} onChange={(event) => updateBuildField("subtitle", event.target.value)} className={inputClass} />
              </Field>
              <Field label="Position">
                <select value={buildForm.position} onChange={(event) => updateBuildField("position", event.target.value as BuildFormState["position"])} className={inputClass}>
                  <option value="right">right</option>
                  <option value="left">left</option>
                </select>
              </Field>
              <Field label="Primary color"><input type="color" value={buildForm.primaryColor} onChange={(event) => updateBuildField("primaryColor", event.target.value)} className={colorClass} /></Field>
              <Field label="Panel color"><input type="color" value={buildForm.panelColor} onChange={(event) => updateBuildField("panelColor", event.target.value)} className={colorClass} /></Field>
              <Field label="Surface color"><input type="color" value={buildForm.surfaceColor} onChange={(event) => updateBuildField("surfaceColor", event.target.value)} className={colorClass} /></Field>
              <Field label="Text color"><input type="color" value={buildForm.textColor} onChange={(event) => updateBuildField("textColor", event.target.value)} className={colorClass} /></Field>
              <Field label="Visitor bubble"><input type="color" value={buildForm.bubbleVisitor} onChange={(event) => updateBuildField("bubbleVisitor", event.target.value)} className={colorClass} /></Field>
              <Field label="Agent bubble"><input type="color" value={buildForm.bubbleAgent} onChange={(event) => updateBuildField("bubbleAgent", event.target.value)} className={colorClass} /></Field>
              <Field label="Welcome message" className="md:col-span-2">
                <textarea value={buildForm.welcomeMessage} onChange={(event) => updateBuildField("welcomeMessage", event.target.value)} className={`${inputClass} min-h-28 resize-y`} />
              </Field>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button type="submit" disabled={submittingBuild} className="rounded-full bg-teal-500 px-5 py-3 text-sm font-semibold text-stone-950 transition hover:bg-teal-400 disabled:cursor-not-allowed disabled:bg-teal-500/50">
                {submittingBuild ? "Building..." : "Build live chat widget"}
              </button>
              <span className="text-sm text-stone-400">
                Output: <code className="rounded bg-white/10 px-2 py-1">/livechat-{'{uuid}'}.js</code>
              </span>
            </div>
          </form>

          <div className="space-y-6">
            <section className="rounded-[1.75rem] border border-white/10 bg-stone-900/80 p-6 shadow-xl shadow-black/20">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-300/80">
                Script output
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Generated snippet</h2>
              <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
                <p className="text-xs uppercase tracking-[0.25em] text-stone-400">Embed</p>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all text-sm text-emerald-100">
                  <code>{snippet}</code>
                </pre>
              </div>
              {buildResult && (
                <dl className="mt-4 grid gap-3 text-sm text-stone-300">
                  <MetaRow label="Tenant UUID" value={buildResult.config.uuid} />
                  <MetaRow label="Script URL" value={buildResult.config.scriptUrl} />
                  <MetaRow label="WebSocket URL" value={buildResult.config.websocketUrl} />
                  <MetaRow label="Config delivery" value="Inlined into livechat-{uuid}.js" />
                  <MetaRow label="Private pocket format" value={`tenant:${buildResult.config.uuid}:session:{sessionId}`} />
                </dl>
              )}
            </section>

            <form onSubmit={(event) => void handleSendMessage(event)} className="rounded-[1.75rem] border border-white/10 bg-stone-900/80 p-6 shadow-xl shadow-black/20">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-fuchsia-300/80">
                Server-to-server API
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Send a message to one private session</h2>
              <div className="mt-4 space-y-4">
                <Field label="Tenant UUID"><input value={messageForm.tenantUuid} onChange={(event) => updateMessageField("tenantUuid", event.target.value)} className={inputClass} /></Field>
                <Field label="Session ID"><input value={messageForm.sessionId} onChange={(event) => updateMessageField("sessionId", event.target.value)} className={inputClass} /></Field>
                <Field label="Sender label"><input value={messageForm.senderLabel} onChange={(event) => updateMessageField("senderLabel", event.target.value)} className={inputClass} /></Field>
                <Field label="Message"><textarea value={messageForm.text} onChange={(event) => updateMessageField("text", event.target.value)} className={`${inputClass} min-h-24 resize-y`} /></Field>
              </div>
              <div className="mt-5 flex items-center gap-3">
                <button type="submit" disabled={sendingMessage} className="rounded-full bg-fuchsia-400 px-5 py-3 text-sm font-semibold text-stone-950 transition hover:bg-fuchsia-300 disabled:cursor-not-allowed disabled:bg-fuchsia-400/50">
                  {sendingMessage ? "Sending..." : "Send to session"}
                </button>
                <span className="text-sm text-stone-400">POST /api/livechat/messages</span>
              </div>
            </form>
          </div>
        </section>

        <section className="rounded-[1.75rem] border border-white/10 bg-stone-900/80 p-6 shadow-xl shadow-black/20">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300/80">
                Dynamic JSON configs
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Built tenants</h2>
            </div>
            <button type="button" onClick={() => void loadConfigs()} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10">
              Refresh
            </button>
          </div>

          {loadingConfigs ? (
            <p className="mt-6 text-sm text-stone-400">Loading generated tenants...</p>
          ) : configs.length === 0 ? (
            <p className="mt-6 text-sm text-stone-400">No tenant builds yet. Use the form above to create the first one.</p>
          ) : (
            <div className="mt-6 grid gap-4 xl:grid-cols-2">
              {configs.map((config) => (
                <article key={config.uuid} className="rounded-2xl border border-white/10 bg-black/20 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-semibold text-white">{config.tenantName}</h3>
                      <p className="mt-1 text-sm text-stone-400">UUID: {config.uuid}</p>
                    </div>
                    <span className="rounded-full bg-white/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-stone-300">
                      {config.position}
                    </span>
                  </div>
                  <dl className="mt-4 space-y-2 text-sm text-stone-300">
                    <MetaRow label="Tenant UUID" value={config.uuid} />
                    <MetaRow label="Private pocket format" value={`tenant:${config.uuid}:session:{sessionId}`} />
                    <MetaRow label="Script" value={config.scriptUrl} />
                    <MetaRow label="Config delivery" value="Embedded in built widget" />
                    <MetaRow label="Updated" value={new Date(config.updatedAt).toLocaleString()} />
                  </dl>
                  <div className="mt-4 rounded-xl border border-white/10 bg-stone-950/80 p-3 text-xs text-stone-300">
                    <p className="font-semibold uppercase tracking-[0.2em] text-stone-400">Embed snippet</p>
                    <code className="mt-2 block break-all text-emerald-200">{`<script src="${config.scriptUrl}" async></script>`}</code>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default App;

function Pill({ label }: { label: string }) {
  return <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">{label}</span>;
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <span className="mb-2 block text-sm font-medium text-stone-300">{label}</span>
      {children}
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 border-b border-white/5 pb-2 last:border-b-0 last:pb-0">
      <span className="text-xs uppercase tracking-[0.24em] text-stone-500">{label}</span>
      <span className="break-all text-stone-200">{value}</span>
    </div>
  );
}

const inputClass =
  "w-full rounded-2xl border border-white/10 bg-stone-950/70 px-4 py-3 text-sm text-white outline-none ring-0 transition placeholder:text-stone-500 focus:border-teal-400/60";
const colorClass =
  "h-12 w-full rounded-2xl border border-white/10 bg-stone-950/70 p-2";
