import { ADDRESS_RE, isMint, describeError, rugcheckReport } from "solana-risk-engine";
import { escapeHtml as esc } from "./telegram.js";
import { t } from "./texts.js";
import { formatToken, formatWallet, short, tokenLabel } from "./format.js";
import { tokenState, diffToken, formatTokenAlert, walletMoves, formatWalletAlert, formatCreatorAlert } from "./watch.js";
import { parseCondition, checkAlert, getPrices, priceText } from "./price.js";

const COMMANDS = {
  start: "help", help: "help", ayuda: "help",
  token: "analyze", wallet: "analyze", analizar: "analyze", scan: "analyze",
  vigilar: "watch", watch: "watch",
  precio: "price", price: "price", alerta: "price", alert: "price",
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
 * @param deps.priceMin   minutes between price checks (for the texts)
 * @param deps.maxPrices  price alerts per chat
 * @param deps.log        optional logger
 */
export function createBot(deps) {
  const { telegram, store, scanner } = deps;
  const intervalMin = deps.intervalMin || 15, maxWatches = deps.maxWatches || 10;
  const priceMin = deps.priceMin || 2, maxPrices = deps.maxPrices || 10;
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
        // Watches skip the serial-creator check: its 24 h count fades on its own and a RugCheck timeout
        // would hide it, so it would only bring "risk dropped" alerts. A direct analysis still shows it
        const r = await scanner.analyzeToken(addr, { skipCreator: true });
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

  function condText(a, lang) {
    const C = t(lang).cond;
    return a.kind === "move" ? C.move(a.value) : C[a.kind](priceText(a.value, lang));
  }

  function priceLines(chat, lang) {
    const T = t(lang);
    return [T.priceListHead, ...chat.prices.map((a) => "• " + T.priceListRow(esc(a.label), condText(a, lang)))];
  }

  // /precio <token> <condition> | /precio <token> quitar | /precio <token> | /precio
  async function price(chatId, arg, lang) {
    const T = t(lang), chat = store.chat(chatId);
    const [addr = "", ...rest] = arg.split(/\s+/).filter(Boolean);
    const cond = rest.join("");
    if (!addr) return reply(chatId, chat.prices.length ? priceLines(chat, lang).join("\n") : T.priceUsage);
    if (!ADDRESS_RE.test(addr)) return reply(chatId, T.invalid);
    if (/^(quitar|borrar|off|stop|remove|delete)$/i.test(cond)) {
      const mine = chat.prices.filter((a) => a.mint === addr);
      if (!mine.length) return reply(chatId, T.priceNone);
      chat.prices = chat.prices.filter((a) => a.mint !== addr);
      store.save();
      return reply(chatId, T.priceOff(esc(mine[0].label), mine.length));
    }
    let now;
    try { now = (await getPrices(scanner.client, [addr]))[addr]; }
    catch (e) { return reply(chatId, "❌ " + esc(describeError(e, lang, { ownRpc: ownRpc() }))); }
    if (!now) return reply(chatId, T.priceNoMarket);
    const b = now.pair.baseToken || {};
    const label = b.symbol ? "$" + b.symbol : short(addr);
    const p = priceText(now.price, lang);
    if (!cond) return reply(chatId, T.priceNow(esc(label), p) + "\n\n" + T.priceUsage);
    const c = parseCondition(cond, now.price);
    if (!c) return reply(chatId, T.priceBadCond);
    if (chat.prices.some((a) => a.mint === addr && a.kind === c.kind && Math.abs(a.value - c.value) <= c.value * 1e-9)) return reply(chatId, T.priceExists);
    if (chat.prices.length >= maxPrices) return reply(chatId, T.priceLimit(maxPrices));
    const a = { mint: addr, label, kind: c.kind, value: c.value, ref: now.price, since: Date.now() };
    chat.prices.push(a);
    store.save();
    return reply(chatId, T.priceSet(esc(label), condText(a, lang), p));
  }

  function list(chatId, lang) {
    const T = t(lang), chat = store.chat(chatId);
    if (!chat.watches.length && !chat.prices.length) return reply(chatId, T.listEmpty);
    const d = (ts) => new Date(ts).toLocaleDateString(lang === "es" ? "es-ES" : "en-GB");
    const lines = chat.watches.length ? [T.listHead, ...chat.watches.map((w, i) =>
      `${i + 1}. <b>${esc(w.label)}</b> (${w.kind === "token" ? T.kindToken : T.kindWallet}) · ${T.since} ${d(w.since)}\n<code>${w.addr}</code>` +
      (w.creator ? "\n" + T.listCreator(short(w.creator.addr)) : ""))] : [];
    if (chat.prices.length) lines.push(...(lines.length ? [""] : []), ...priceLines(chat, lang));
    return reply(chatId, lines.join("\n"));
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
        {
          // the scanner's "💲 Alerta de precio" menu: p_<mint>, p_<mint>_a50 (up 50%), _b30 (down 30%), _m20 (every 20%)
          const p = first.match(/^p_([1-9A-HJ-NP-Za-km-z]{32,44})(?:_([abm])(\d{1,4}))?$/);
          if (p) return price(chatId, p[1] + (p[2] ? " " + { a: ">", b: "<", m: "" }[p[2]] + p[3] + "%" : ""), lang);
        }
        return reply(chatId, t(lang).help(intervalMin, maxWatches, priceMin));
      case "analyze": return first ? analyze(chatId, first, lang) : reply(chatId, t(lang).needAddr);
      case "watch": return watch(chatId, first, lang);
      case "price": return price(chatId, arg, lang);
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
        return reply(chatId, t(lang).help(intervalMin, maxWatches, priceMin));
    }
  }

  /**
   * One pass over every price alert: one DexScreener request per 30 tokens, whatever the number of
   * chats. A price that can't be read this time is skipped, never alerted.
   */
  async function runPriceCycle() {
    const all = store.allPrices();
    if (!all.length) return { checked: 0, alerts: 0 };
    const mints = [...new Set(all.map((x) => x.alert.mint))];
    let prices;
    try { prices = await getPrices(scanner.client, mints); }
    catch (e) { log("price check failed", e.code || e.message); return { checked: 0, alerts: 0 }; }
    let alerts = 0;
    const done = new Set();
    for (const { chatId, alert: a } of all) {
      const now = prices[a.mint], ev = now && checkAlert(a, now.price);
      if (!ev) continue;
      const lang = store.chat(chatId).lang, T = t(lang), P = (v) => priceText(v, lang), L = esc(a.label);
      const lines = [];
      if (ev.kind === "above") lines.push(T.alertAbove(L, P(a.value), P(ev.to)), T.priceDone);
      else if (ev.kind === "below") lines.push(T.alertBelow(L, P(a.value), P(ev.to)), T.priceDone);
      else lines.push((ev.kind === "up" ? T.alertUp : T.alertDown)(L, ev.pct, P(ev.from), P(ev.to)), T.priceNext(a.value));
      if (now.pair.pairAddress) lines.push(`<a href="https://dexscreener.com/solana/${now.pair.pairAddress}">DexScreener</a>`);
      await reply(chatId, lines.join("\n"));
      alerts++;
      if (a.kind === "move") a.ref = ev.to; else done.add(a);
    }
    if (done.size) for (const id of Object.keys(store.data.chats)) store.chat(id).prices = store.chat(id).prices.filter((a) => !done.has(a));
    if (alerts) store.save();
    return { checked: Object.keys(prices).length, alerts };
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
          const r = await once("token:" + w.addr, () => scanner.analyzeToken(w.addr, { skipCreator: true }));
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

  return { handleMessage, runWatchCycle, runPriceCycle, parse };
}
