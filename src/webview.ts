import chatClientSource from "chat-client-source";
import chatCss from "chat-css-source";

export interface ChatViewOptions {
  title: string;
  chat?: { url: string; token: string };
  error?: string;
}

export function chatHtml(options: ChatViewOptions) {
  const config = JSON.stringify(options.chat ?? null);
  const error = JSON.stringify(options.error ?? null);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(options.title)}</title>
  <style>${chatCss}</style>
</head>
<body>
  <header>
    <strong>InLive Codex</strong>
    <span id="status">Starting</span>
    <button id="closeButton" type="button" aria-label="Close InLive Codex chat" title="Close">X</button>
  </header>
  <main id="transcript" aria-live="polite"></main>
  <form id="composer">
    <textarea id="prompt" rows="2" placeholder="Ask Codex"></textarea>
    <button id="sendButton" type="submit">Send</button>
    <button id="stopButton" type="button" disabled>Stop</button>
  </form>
  <script>window.inliveChat = ${config}; window.inliveError = ${error};</script>
  <script>${chatClientSource}</script>
</body>
</html>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]!));
}
