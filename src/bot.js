import { ADDRESS_RE, isMint, describeError, rugcheckReport } from "solana-risk-engine";
import { escapeHtml as esc } from "./telegram.js";
import { t } from "./texts.js";
import { formatToken, formatWallet, short, tokenLabel } from "./format.js";
import { tokenState, diffToken, formatTokenAlert, walletMoves, formatWalletAlert, formatCreatorAlert } from "./watch.js";

const COMMANDS = {
  start: "help", help: "help", ayuda: "help",
  token: "analyze", wallet: "analyze", analizar: "analyze", scan: "analyze",
  vigilar: "watch", watch: "watch",
  dejar: "unwatch", unwatch: "unwatch",
  lista: "list", list: "list",
  idioma: "lang", lang: "lang", language: "lang"
};

// "/vigilar@MiBot abc" -> { cmd: "watch", arg: "abc" }; plain text -> { cmd: null, arg: text }
export function parse(text) {
  const s = String(text || "").trim();
  const m = s.match(/^\/([a-zA-Z_]+)(?:@\w+)?\s*([\s\S]*)$/);
  if (!m) return { cmd: null, arg: s };
  return { cmd: COMMANDS[m[1].toLowerCase()] || "unknown", arg: m[2].trim() };
}

/**
 * @param deps.telegram   createTelegram(...)
 * @param deps.store      createStore(...)
 * @param deps.scanner    createScanner(...) from solana-risk-engine
 * @param deps.intervalMin  minutes between watch checks (for the texts)
 * @param deps.maxWatches   per chat
 * @param deps.log        optional logger
 */
export function createBot(deps) {
  const { telegram, store, scanner } = deps;
  const intervalMin = deps.intervalMin || 15, maxWatches = deps.maxWatches || 10;
  const log = deps.log || (() => {});
  const ownRpc = () => scanner.client.ownRpc();

  async function reply(chatId, html) {
    try { await telegram.send(chatId, html); } catch (e) { log("send failed", chatId, e.message); }
  }

  // Who created the token, according to RugCheck (null when it doesn't know)
  async function findCreator(mint) {
    try {
      const rc = await rugcheckReport(scanner.client, mint);
      const c = rc && rc.creator;
      return c && ADDRESS_RE.test(c) && c !== mint ? c : null;
    } catch (e) { return null; }
  }

  async function snapshotOf(addr) {
    const snap = await scanner.takeSnapshots([addr]);
    return snap.snapshots[addr] ? { ts: snap.ts, h: snap.snapshots[addr] } : null;
  }

  async function analyze(chatId, addr, lang) {
    if (!ADDRESS_RE.test(addr)) return reply(chatId, t(lang).invalid);
    await reply(chatId, t(lang).analyzing);
    try {
      const r = await scanner.analyzeAddress(addr);
      await reply(chatId, r.kind === "token" ? formatToken(r.token, lang) : formatWallet(r.wallet, lang));
    } catch (e) {
      await reply(chatId, "❌ " + esc(describeError(e, lang, { ownRpc: ownRpc() })));
    }
  }

  async function watch(chatId, addr, lang) {
    const T = t(lang), chat = store.chat(chatId);
    if (!addr) return reply(chatId, T.needAddr);
    if (!ADDRESS_RE.test(addr)) return reply(chatId, T.invalid);
    if (chat.watches.some((w) => w.addr === addr)) return reply(chatId, T.watchExists);
    if (chat.watches.length >= maxWatches) return reply(chatId, T.watchLimit(maxWatches));
    await reply(chatId, T.analyzing);
    try {
      if (await isMint(scanner.client, addr)) {
        const r = await scanner.analyzeToken(addr);
        const label = tokenLabel(r);
        const creatorAddr = await findCreator(addr);
        let creator = null;
        if (creatorAddr) {
          // without a first snapshot the first check only records one: never an alert out of nothing
          let state = null;
          try { state = await snapshotOf(creatorAddr); } catch (e) { log("creator snapshot failed", creatorAddr, e.code || e.message); }
          creator = { addr: creatorAddr, state };
        }
        chat.watches.push({ kind: "token", addr, label, since: Date.now(), state: tokenState(r), creator });
        store.save();
        await reply(chatId, formatToken(r, lang) + "\n\n" + T.watchToken(esc(label), intervalMin) + "\n" +
          (creator ? T.creatorFound(short(creator.addr)) : T.creatorUnknown));
      } else {
        const snap = await scanner.takeSnapshots([addr]);
        const label = short(addr);
        chat.watches.push({ kind: "wallet", addr, label, since: Date.now(), state: { ts: snap.ts, h: snap.snapshots[addr] } });
        store.save();
        await reply(chatId, T.watchWallet(esc(label), intervalMin));
      }
    } catch (e) {
      await reply(chatId, "❌ " + esc(describeError(e, lang, { ownRpc: ownRpc() })));
    }
  }

  async function unwatch(chatId, arg, lang) {
    const T = t(lang), chat = store.chat(chatId);
    if (!arg) return reply(chatId, T.needAddr);
    const n = Number(arg);
    const i = Number.isInteger(n) && n >= 1 && n <= chat.watches.length ? n - 1 : chat.watches.findIndex((w) => w.addr === arg);
    if (i < 0) return reply(chatId, T.notWatched);
    const [w] = chat.watches.splice(i, 1);
    store.save();
    return reply(chatId, T.unwatched(esc(w.label)));
  }

  function list(chatId, lang) {
    const T = t(lang), chat = store.chat(chatId);
    if (!chat.watches.length) return reply(chatId, T.listEmpty);
    const d = (ts) => new Date(ts).toLocaleDateString(lang === "es" ? "es-ES" : "en-GB");
    return reply(chatId, [T.listHead, ...chat.watches.map((w, i) =>
      `${i + 1}. <b>${esc(w.label)}</b> (${w.kind === "token" ? T.kindToken : T.kindWallet}) · ${T.since} ${d(w.since)}\n<code>${w.addr}</code>` +
      (w.creator ? "\n" + T.listCreator(short(w.creator.addr)) : ""))].join("\n"));
  }

  async function handleMessage(msg) {
    if (!msg || !msg.chat || typeof msg.text !== "string") return;
    const chatId = String(msg.chat.id), chat = store.chat(chatId), lang = chat.lang;
    const { cmd, arg } = parse(msg.text);
    const first = arg.split(/\s+/)[0] || "";
    switch (cmd) {
      case "help":
        // t.me/<bot>?start=<address> (the scanner's "Vigilar en Telegram" button) arrives as "/start <address>"
        if (ADDRESS_RE.test(first)) return watch(chatId, first, lang);
        return reply(chatId, t(lang).help(intervalMin, maxWatches));
      case "analyze": return first ? analyze(chatId, first, lang) : reply(chatId, t(lang).needAddr);
      case "watch": return watch(chatId, first, lang);
      case "unwatch": return unwatch(chatId, first, lang);
      case "list": return list(chatId, lang);
      case "lang": {
        chat.lang = /^en/i.test(first) ? "en" : /^es/i.test(first) ? "es" : (lang === "es" ? "en" : "es");
        store.save();
        return reply(chatId, t(chat.lang).lang);
      }
      case "unknown": return reply(chatId, t(lang).unknown);
      default:
        // plain text: analyse it if it looks like an address, otherwise show the help
        if (ADDRESS_RE.test(first)) return analyze(chatId, first, lang);
        return reply(chatId, t(lang).help(intervalMin, maxWatches));
    }
  }

  /**
   * One pass over everything watched. Each address is analysed once per pass even if several chats
   * watch it. Failed checks keep the previous state (no false "sold everything" or "risk dropped").
   */
  async function runWatchCycle() {
    const cache = new Map();
    const once = async (key, fn) => { if (!cache.has(key)) cache.set(key, await fn()); return cache.get(key); };
    let alerts = 0;

    // Moves of a wallet since its stored snapshot; null when the wallet could not be read this time
    async function movesOf(holder, addr) {
      const snap = await once("wallet:" + addr, () => scanner.takeSnapshots([addr]));
      const h = snap.snapshots[addr];
      if (!h) return null;
      const first = !holder.state;
      const moves = first ? [] : walletMoves(holder.state.h, h);   // first snapshot: just record it
      holder.state = { ts: snap.ts, h: h };
      return moves;
    }

    for (const { chatId, watch: w } of store.allWatches()) {
      const lang = store.chat(chatId).lang;
      if (w.kind === "token") {
        try {
          const r = await once("token:" + w.addr, () => scanner.analyzeToken(w.addr));
          if (r.lvl !== "NO_DATA") {   // DexScreener failed this time: unknown, not a change
            const now = tokenState(r), d = diffToken(w.state, now);
            if (d.worse || d.better) { await reply(chatId, formatTokenAlert(w.label, d, lang)); alerts++; }
            w.state = now;
          }
        } catch (e) { log("token check failed", w.addr, e.code || e.message); }
        try {
          // watches from before creator tracking: look the creator up once
          if (w.creator === undefined) {
            const c = await findCreator(w.addr);
            w.creator = c ? { addr: c, state: null } : null;
          }
          if (w.creator) {
            const moves = await movesOf(w.creator, w.creator.addr);
            if (moves && moves.length) { await reply(chatId, formatCreatorAlert(w.label, w.addr, short(w.creator.addr), moves, lang)); alerts++; }
          }
        } catch (e) { log("creator check failed", w.addr, e.code || e.message); }
      } else {
        try {
          const moves = await movesOf(w, w.addr);
          if (moves && moves.length) { await reply(chatId, formatWalletAlert(w.label, moves, lang)); alerts++; }
        } catch (e) { log("wallet check failed", w.addr, e.code || e.message); }
      }
    }
    store.save();
    return { checked: cache.size, alerts };
  }

  return { handleMessage, runWatchCycle, parse };
}
