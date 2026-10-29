import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

// Everything the bot remembers, in one JSON file: per chat, its language and what it watches.
// { offsets: { [botId]: next update id }, chats: { [chatId]: { lang, watches: [{ kind, addr, label, state, since }], prices: [see price.js] } } }
// Each bot has its own update numbers, so the offset is kept per bot. Starting from 0 is always safe:
// Telegram only returns updates that were never confirmed.
export function createStore(path) {
  let data = { offsets: {}, chats: {} };
  if (path && existsSync(path)) {
    try { data = Object.assign(data, JSON.parse(readFileSync(path, "utf8"))); } catch (e) { /* a broken file starts empty */ }
  }
  delete data.offset;   // single offset from before there were two bots: whose it was is unknown

  function save() {
    if (!path) return;
    mkdirSync(dirname(path), { recursive: true });
    const tmp = path + ".tmp";
    writeFileSync(tmp, JSON.stringify(data, null, 1));
    renameSync(tmp, path);   // a crash mid-write never leaves a half-written store
  }

  function chat(id) {
    const c = data.chats[id] || (data.chats[id] = { lang: "es", watches: [] });
    if (!c.prices) c.prices = [];   // chats saved before price alerts existed
    return c;
  }

  return {
    data,
    save,
    chat,
    offsetOf(botId) { return (data.offsets && data.offsets[botId]) || 0; },
    setOffset(botId, v) { (data.offsets || (data.offsets = {}))[botId] = v; save(); },
    allWatches() {
      const out = [];
      for (const id of Object.keys(data.chats)) for (const w of data.chats[id].watches) out.push({ chatId: id, watch: w });
      return out;
    },
    allPrices() {
      const out = [];
      for (const id of Object.keys(data.chats)) for (const a of chat(id).prices) out.push({ chatId: id, alert: a });
      return out;
    }
  };
}
