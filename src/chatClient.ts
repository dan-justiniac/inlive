declare global {
  interface Window {
    inliveChat?: { url: string; token: string } | null;
    inliveError?: string | null;
    webkit?: { messageHandlers?: { live?: { postMessage(message: unknown): void } } };
    chrome?: { webview?: { postMessage(message: unknown): void } };
  }
}

interface ChatSnapshot {
  status: string;
  messages: Array<{ id: string; role: string; text: string; status?: string }>;
  pendingRequests: Array<{ id: string | number; title: string; body: string; method: string }>;
  error: string | null;
}

const statusEl = document.getElementById("status")!;
const transcript = document.getElementById("transcript")!;
const form = document.getElementById("composer") as HTMLFormElement;
const input = document.getElementById("prompt") as HTMLTextAreaElement;
const sendButton = document.getElementById("sendButton") as HTMLButtonElement;
const stopButton = document.getElementById("stopButton") as HTMLButtonElement;
const closeButton = document.getElementById("closeButton") as HTMLButtonElement;
let socket: WebSocket | null = null;
let reconnects = 0;

closeButton.addEventListener("click", closeModal);
stopButton.addEventListener("click", () => send({ type: "interrupt" }));
form.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  send({ type: "send", text });
  input.value = "";
});
input.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey) return;
  event.preventDefault();
  form.requestSubmit();
});

const query = new URLSearchParams(window.location.search);
if (!window.inliveChat && query.has("bridgeUrl") && query.has("token")) {
  window.inliveChat = { url: query.get("bridgeUrl")!, token: query.get("token")! };
}
if (!window.inliveError && query.has("error")) window.inliveError = query.get("error");

if (window.inliveError) {
  renderSnapshot({ status: "error", messages: [{ id: "error", role: "system", text: window.inliveError }], pendingRequests: [], error: window.inliveError });
} else if (!window.inliveChat) {
  renderSnapshot({ status: "error", messages: [{ id: "missing", role: "system", text: "InLive chat bridge configuration is missing." }], pendingRequests: [], error: "Missing bridge configuration." });
} else {
  connect(window.inliveChat);
}

function connect(chat: { url: string; token: string }) {
  setStatus("Connecting");
  socket = new WebSocket(`${chat.url}?token=${encodeURIComponent(chat.token)}`);
  socket.addEventListener("open", () => {
    reconnects = 0;
    setStatus("Connected");
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.type === "snapshot") renderSnapshot(message.snapshot);
  });
  socket.addEventListener("close", (event) => {
    if (reconnects < 20) {
      reconnects += 1;
      setStatus(`Reconnecting ${reconnects}`);
      window.setTimeout(() => connect(chat), 250);
      return;
    }

    setStatus("Disconnected");
    renderSnapshot({
      status: "disconnected",
      messages: [{ id: "disconnect", role: "system", text: `WebSocket disconnected. code=${event.code} reason=${event.reason || "(none)"}` }],
      pendingRequests: [],
      error: "Disconnected",
    });
  });
  socket.addEventListener("error", () => {
    setStatus("Error");
    renderSnapshot({
      status: "error",
      messages: [{ id: "socket-error", role: "system", text: "WebSocket error before the chat bridge connected." }],
      pendingRequests: [],
      error: "WebSocket error",
    });
  });
}

function renderSnapshot(snapshot: ChatSnapshot) {
  setStatus(label(snapshot.status));
  input.disabled = snapshot.status !== "ready";
  sendButton.disabled = input.disabled;
  stopButton.disabled = !(snapshot.status === "thinking" || snapshot.status === "streaming");
  transcript.replaceChildren(
    ...snapshot.messages.map(renderMessage),
    ...snapshot.pendingRequests.map(renderRequest),
  );
  transcript.scrollTop = transcript.scrollHeight;
}

function renderMessage(message: ChatSnapshot["messages"][number]) {
  const article = document.createElement("article");
  article.className = `message ${message.role}`;
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = message.status ? `${message.role} · ${message.status}` : message.role;
  const body = document.createElement("pre");
  body.textContent = message.text;
  article.append(meta, body);
  return article;
}

function renderRequest(request: ChatSnapshot["pendingRequests"][number]) {
  const article = document.createElement("article");
  article.className = "request";
  const title = document.createElement("div");
  title.className = "meta";
  title.textContent = request.title;
  const body = document.createElement("pre");
  body.textContent = request.body;
  const actions = document.createElement("div");
  actions.className = "requestActions";
  const approve = button("Approve", () => send({ type: "approve", requestId: request.id, decision: "accept" }));
  const deny = button("Deny", () => send({ type: "approve", requestId: request.id, decision: "decline" }));
  actions.append(approve, deny);
  article.append(title, body, actions);
  return article;
}

function button(text: string, onClick: () => void) {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = text;
  element.addEventListener("click", onClick);
  return element;
}

function send(message: unknown) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function setStatus(value: string) {
  statusEl.textContent = value;
}

function label(status: string) {
  return status[0]!.toUpperCase() + status.slice(1);
}

function closeModal() {
  const message = { method: "close_and_send", params: [JSON.stringify({ action: "closed" })] };
  if (window.webkit?.messageHandlers?.live) return window.webkit.messageHandlers.live.postMessage(message);
  if (window.chrome?.webview) return window.chrome.webview.postMessage(message);
  window.close();
}
