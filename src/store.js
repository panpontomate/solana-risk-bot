import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

// Everything the bot remembers, in one JSON file: per chat, its language and what it watches.
// { offset, chats: { [chatId]: { lang, watches: [{ kind, addr, label, state, since }] } } }
export function createStore(path) {
  let data = { offset: 0, chats: {} };
  if (path && existsSync(path)) {
    try { data = Object.assign(data, JSON.parse(readFileSync(path, "utf8"))); } catch (e) { /* a broken file starts empty */ }
  }

  function save() {
    if (!path) return;
    mkdirSync(dirname(path), { recursive: true });
    const tmp = path + ".tmp";
    writeFileSync(tmp, JSON.stringify(data, null, 1));
    renameSync(tmp, path);   // a crash mid-write never leaves a half-written store
  }

  function chat(id) {
    return data.chats[id] || (data.chats[id] = { lang: "es", watches: [] });
  }

  return {
    data,
    save,
    chat,
    get offset() { return data.offset; },
    set offset(v) { data.offset = v; save(); },
    allWatches() {
      const out = [];
      for (const id of Object.keys(data.chats)) for (const w of data.chats[id].watches) out.push({ chatId: id, watch: w });
      return out;
    }
  };
}
