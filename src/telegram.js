// Minimal Telegram Bot API client: long polling and sending messages. No dependencies.

export function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

// Telegram rejects messages over 4096 characters: split on line breaks
export function splitMessage(text, max = 4000) {
  if (text.length <= max) return [text];
  const parts = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur && cur.length + line.length + 1 > max) { parts.push(cur); cur = ""; }
    cur += (cur ? "\n" : "") + (line.length > max ? line.slice(0, max - 1) + "…" : line);
  }
  if (cur) parts.push(cur);
  return parts;
}

export function createTelegram(token, opts = {}) {
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is missing");
  const fetchImpl = opts.fetch || globalThis.fetch;
  const base = (opts.apiBase || "https://api.telegram.org") + "/bot" + token + "/";

  async function call(method, params) {
    const r = await fetchImpl(base + method, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params || {}),
      signal: opts.signal
    });
    const j = await r.json().catch(() => ({ ok: false, description: "HTTP " + r.status }));
    if (!j.ok) {
      const e = new Error("Telegram " + method + ": " + (j.description || "error"));
      e.code = j.error_code;
      e.retryAfter = j.parameters && j.parameters.retry_after;
      throw e;
    }
    return j.result;
  }

  async function send(chatId, html) {
    for (const part of splitMessage(html)) {
      await call("sendMessage", { chat_id: chatId, text: part, parse_mode: "HTML", link_preview_options: { is_disabled: true } });
    }
  }

  // Long polling: waits up to `timeout` seconds for new messages
  async function getUpdates(offset, timeout = 50) {
    return call("getUpdates", { offset: offset, timeout: timeout, allowed_updates: ["message"] });
  }

  return { call, send, getUpdates };
}
