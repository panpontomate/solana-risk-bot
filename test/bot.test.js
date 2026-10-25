import test from "node:test";
import assert from "node:assert/strict";
import { createBot, parse } from "../src/bot.js";
import { createStore } from "../src/store.js";
import { splitMessage, escapeHtml } from "../src/telegram.js";
import { tokenState, diffToken, walletMoves } from "../src/watch.js";
import { formatToken, formatWallet } from "../src/format.js";
import { parseCondition, checkAlert, priceText } from "../src/price.js";

const MINT = "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE";
const WALLET = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

function fakeTelegram() {
  const sent = [];
  return { sent, send: async (chatId, html) => { sent.push({ chatId, html }); }, last: () => sent[sent.length - 1].html };
}

function light(k, s, code, data) { return { k, s, items: [{ code, s, data }] }; }

function tokenResult(o) {
  return Object.assign({
    mint: MINT, sym: "ORCA", name: "Orca", lvl: "LOW", sev: 0, pts: 0, type: "OPEN",
    lights: [light("control", "ok", "CTL_NONE"), light("concentration", "ok", "CON_OK", { w1: 5 }), light("market", "ok", "MKT_OK", { liq: 500000, vol: 90000 }), light("dependency", "ok", "DEP_NONE")],
    reasons: [], pair: { pairAddress: "PAIR1", liquidity: { usd: 500000 } }
  }, o);
}

// A scanner whose answers the test controls
function fakeScanner(state) {
  return {
    client: {
      ownRpc: () => false,
      rpc: async (method, params) => {
        if (method === "getAccountInfo") return params[0] === MINT ? { value: { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", data: { parsed: { type: "mint" } } } } : { value: null };
        throw new Error("unexpected " + method);
      },
      // DexScreener, which is where prices come from: state.prices = { mint: priceUsd }, or "down"
      jfetch: async (url) => {
        state.dexCalls = (state.dexCalls || 0) + 1;
        if (state.prices === "down") { const e = new Error("x"); e.code = "HTTP"; throw e; }
        const mints = url.split("/").pop().split(",");
        return mints.filter((m) => state.prices && state.prices[m]).map((m) => ({
          baseToken: { address: m, symbol: m === MINT ? "ORCA" : "OTHER" }, priceUsd: String(state.prices[m]), pairAddress: "PAIR1", liquidity: { usd: 500000 }
        }));
      },
      // RugCheck's full report, which is where the creator comes from
      softJson: async (url) => { state.rcCalls = (state.rcCalls || 0) + 1; return url.endsWith(MINT + "/report") && state.creator ? { creator: state.creator } : null; }
    },
    analyzeToken: async () => { state.calls = (state.calls || 0) + 1; return state.token; },
    analyzeAddress: async (a) => a === MINT ? { kind: "token", token: state.token } : { kind: "wallet", wallet: state.wallet },
    takeSnapshots: async (ws) => {
      state.snapCalls = (state.snapCalls || 0) + 1;
      const h = state.snaps && ws[0] in state.snaps ? state.snaps[ws[0]] : state.snap;
      return { ts: 1, snapshots: h ? { [ws[0]]: h } : {}, failed: 0 };
    }
  };
}

function setup(state) {
  const telegram = fakeTelegram(), store = createStore(null), scanner = fakeScanner(state);
  const bot = createBot({ telegram, store, scanner, intervalMin: 15, maxWatches: 2 });
  const msg = (text, chat = 1) => bot.handleMessage({ chat: { id: chat }, text });
  return { telegram, store, bot, msg };
}

test("parse commands, bot mentions and plain text", () => {
  assert.deepEqual(parse("/vigilar@MiBot  abc def"), { cmd: "watch", arg: "abc def" });
  assert.deepEqual(parse("/WATCH x"), { cmd: "watch", arg: "x" });
  assert.deepEqual(parse("/nope"), { cmd: "unknown", arg: "" });
  assert.deepEqual(parse("  " + MINT + " "), { cmd: null, arg: MINT });
});

test("pasting a token address replies with the analysis", async () => {
  const { telegram, msg } = setup({ token: tokenResult() });
  await msg(MINT);
  assert.equal(telegram.sent.length, 2);   // "analysing…" + result
  const html = telegram.last();
  assert.match(html, /\$ORCA/);
  assert.match(html, /Riesgo bajo/);
  assert.match(html, /Control del creador/);
  assert.match(html, /dexscreener\.com\/solana\/PAIR1/);
});

test("a t.me/<bot>?start=<address> link starts watching that address", async () => {
  const { telegram, msg, store } = setup({ token: tokenResult(), snap: {} });
  await msg("/start " + MINT);   // what Telegram sends when the scanner's button is tapped
  assert.match(telegram.last(), /Vigilando el token <b>\$ORCA<\/b>/);
  assert.equal(store.chat("1").watches[0].addr, MINT);
  await msg("/start " + WALLET);
  assert.match(telegram.last(), /Vigilando la wallet/);
  // a plain /start (or a payload that is not an address) still shows the help
  await msg("/start");
  assert.match(telegram.last(), /Escáner de riesgo/);
  await msg("/start hola");
  assert.match(telegram.last(), /Escáner de riesgo/);
});

test("invalid address, unknown command and help", async () => {
  const { telegram, msg } = setup({});
  await msg("/vigilar 0xdeadbeef");
  assert.match(telegram.last(), /no parece una dirección/);
  await msg("/foo");
  assert.match(telegram.last(), /No conozco ese comando/);
  await msg("hola");
  assert.match(telegram.last(), /Escáner de riesgo/);
});

test("language switch changes every following reply", async () => {
  const { telegram, msg, store } = setup({ token: tokenResult() });
  await msg("/lang en");
  assert.equal(store.chat("1").lang, "en");
  assert.equal(telegram.last(), "Language: English.");
  await msg(MINT);
  assert.match(telegram.last(), /Low risk/);
  assert.match(telegram.last(), /Creator control/);
});

test("watch, list, limit and unwatch", async () => {
  const state = { token: tokenResult(), snap: {} };
  const { telegram, msg, store } = setup(state);
  await msg("/vigilar " + MINT);
  assert.match(telegram.last(), /Vigilando el token <b>\$ORCA<\/b>/);
  await msg("/vigilar " + MINT);
  assert.equal(telegram.last(), "Ya lo estabas vigilando.");
  await msg("/vigilar " + WALLET);
  assert.match(telegram.last(), /Vigilando la wallet/);
  assert.equal(store.chat("1").watches.length, 2);
  await msg("/vigilar So11111111111111111111111111111111111111112");
  assert.match(telegram.last(), /máximo/);
  await msg("/lista");
  assert.match(telegram.last(), /1\. <b>\$ORCA<\/b> \(token\)/);
  assert.match(telegram.last(), /2\. <b>9WzD…AWWM<\/b> \(wallet\)/);
  await msg("/dejar 1");
  assert.match(telegram.last(), /Ya no vigilo <b>\$ORCA<\/b>/);
  await msg("/dejar " + WALLET);
  assert.equal(store.chat("1").watches.length, 0);
  await msg("/dejar 5");
  assert.match(telegram.last(), /No estabas vigilando/);
});

test("watch cycle alerts on worse risk, new signals and liquidity drops, once per address", async () => {
  const state = { token: tokenResult(), snap: {} };
  const { telegram, msg, bot } = setup(state);
  await msg("/vigilar " + MINT, 1);
  await msg("/vigilar " + MINT, 2);
  telegram.sent.length = 0;
  state.calls = 0;

  // nothing changed: no alert
  assert.deepEqual(await bot.runWatchCycle(), { checked: 1, alerts: 0 });
  assert.equal(state.calls, 1);   // two chats, one analysis

  // the creator regains mint authority and liquidity is pulled
  state.token = tokenResult({
    lvl: "HIGH",
    lights: [light("control", "bad", "CTL_MINT_ACTIVE"), light("concentration", "ok", "CON_OK", { w1: 5 }), light("market", "bad", "MKT_LIQ_VERY_LOW", { liq: 2000 }), light("dependency", "ok", "DEP_NONE")],
    reasons: [{ k: "control", code: "CTL_MINT_ACTIVE", s: "bad" }, { k: "market", code: "MKT_LIQ_VERY_LOW", s: "bad", data: { liq: 2000 } }],
    pair: { pairAddress: "PAIR1", liquidity: { usd: 2000 } }
  });
  const r = await bot.runWatchCycle();
  assert.equal(r.alerts, 2);
  const html = telegram.sent[0].html;
  assert.match(html, /Cambio en \$ORCA/);
  assert.match(html, /Riesgo bajo → <b>Riesgo alto<\/b>/);
  assert.match(html, /Nueva señal: El creador puede crear más tokens/);
  assert.match(html, /La liquidez ha caído un 100%|La liquidez ha caído un 99%/);

  // DexScreener unreachable this time: no alert and the state is kept
  telegram.sent.length = 0;
  state.token = tokenResult({ lvl: "NO_DATA", lights: null, reasons: [] });
  assert.equal((await bot.runWatchCycle()).alerts, 0);
});

test("watch cycle reports wallet buys and sells", async () => {
  const state = { snap: { A: { q: 100, v: 200, s: "AAA" } } };
  const { telegram, msg, bot } = setup(state);
  await msg("/vigilar " + WALLET);
  telegram.sent.length = 0;
  state.snap = { B: { q: 30, v: 300, s: "BBB" } };
  assert.equal((await bot.runWatchCycle()).alerts, 1);
  const html = telegram.last();
  assert.match(html, /Movimientos de 9WzD…AWWM/);
  assert.match(html, /Nuevo: <b>\$BBB<\/b>/);
  assert.match(html, /Ha vendido todo: <b>\$AAA<\/b>/);
  // no changes next time
  assert.equal((await bot.runWatchCycle()).alerts, 0);
});

const CREATOR = "DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy";

test("watching a token also watches its creator, and flags them selling it", async () => {
  const state = { token: tokenResult(), creator: CREATOR, snaps: { [CREATOR]: { [MINT]: { q: 1000, v: 5000, s: "ORCA" }, X: { q: 1, v: 30, s: "XXX" } } } };
  const { telegram, msg, bot, store } = setup(state);
  await msg("/vigilar " + MINT);
  assert.match(telegram.last(), /También vigilo al <b>creador<\/b> \(DRpb…21hy\)/);
  const w = store.chat("1").watches[0];
  assert.equal(w.creator.addr, CREATOR);
  assert.ok(w.creator.state.h[MINT]);
  await msg("/lista");
  assert.match(telegram.last(), /\+ creador DRpb…21hy/);

  // nothing moved: no alert
  telegram.sent.length = 0;
  assert.equal((await bot.runWatchCycle()).alerts, 0);

  // the creator dumps the token and buys something new
  state.snaps[CREATOR] = { Y: { q: 5, v: 900, s: "NEW" }, X: { q: 1, v: 30, s: "XXX" } };
  assert.equal((await bot.runWatchCycle()).alerts, 1);
  const html = telegram.last();
  assert.match(html, /El creador de \$ORCA se ha movido/);
  assert.match(html, /🚨 <b>Está vendiendo el propio \$ORCA<\/b>/);
  // the sale of the token itself comes first, before the other moves
  assert.ok(html.indexOf("Ha vendido todo: <b>$ORCA</b>") < html.indexOf("Nuevo: <b>$NEW</b>"));
});

test("creator buying more of the token is reported without the dump warning", async () => {
  const state = { token: tokenResult(), creator: CREATOR, snaps: { [CREATOR]: { [MINT]: { q: 100, v: 500, s: "ORCA" } } } };
  const { telegram, msg, bot } = setup(state);
  await msg("/vigilar " + MINT);
  state.snaps[CREATOR] = { [MINT]: { q: 300, v: 1500, s: "ORCA" } };
  await bot.runWatchCycle();
  assert.match(telegram.last(), /Ha comprado más: <b>\$ORCA<\/b>/);
  assert.doesNotMatch(telegram.last(), /🚨/);
});

test("token without a known creator, and old watches that predate creator tracking", async () => {
  const state = { token: tokenResult(), snaps: {} };
  const { telegram, msg, bot, store } = setup(state);
  await msg("/vigilar " + MINT);
  assert.match(telegram.last(), /No he encontrado quién creó este token/);
  assert.equal(store.chat("1").watches[0].creator, null);

  // a watch saved before this feature has no `creator` field: the next cycle looks it up once,
  // records a first snapshot and does not alert out of nothing
  delete store.chat("1").watches[0].creator;
  state.creator = CREATOR;
  state.snaps[CREATOR] = { [MINT]: { q: 10, v: 100, s: "ORCA" } };
  telegram.sent.length = 0;
  assert.equal((await bot.runWatchCycle()).alerts, 0);
  assert.equal(store.chat("1").watches[0].creator.addr, CREATOR);
  const calls = state.rcCalls;
  await bot.runWatchCycle();
  assert.equal(state.rcCalls, calls);   // not looked up again
});

test("a creator whose wallet can't be read is skipped without alerts", async () => {
  const state = { token: tokenResult(), creator: CREATOR, snaps: { [CREATOR]: { [MINT]: { q: 10, v: 100, s: "ORCA" } } } };
  const { telegram, msg, bot } = setup(state);
  await msg("/vigilar " + MINT);
  telegram.sent.length = 0;
  state.snaps[CREATOR] = null;   // RPC failure this time
  assert.equal((await bot.runWatchCycle()).alerts, 0);
  state.snaps[CREATOR] = { [MINT]: { q: 10, v: 100, s: "ORCA" } };
  assert.equal((await bot.runWatchCycle()).alerts, 0);   // and no fake "sold" afterwards
});

test("errors from the engine become friendly messages", async () => {
  const scannerFail = { client: { ownRpc: () => false }, analyzeAddress: async () => { const e = new Error("x"); e.code = "DEX_UNREACHABLE"; throw e; } };
  const tg = fakeTelegram();
  const b = createBot({ telegram: tg, store: createStore(null), scanner: scannerFail });
  await b.handleMessage({ chat: { id: 1 }, text: MINT });
  assert.match(tg.last(), /❌ No se pudo conectar con DexScreener/);
});

test("price alerts: set, list, cross a target once and remove", async () => {
  const state = { prices: { [MINT]: 1.2 } };
  const { telegram, msg, bot, store } = setup(state);
  await msg("/precio");
  assert.match(telegram.last(), /Alertas de precio/);
  await msg("/precio " + MINT);
  assert.match(telegram.last(), /\$ORCA<\/b> vale ahora <b>1,20 \$/);
  await msg("/precio " + MINT + " > 1,5");
  assert.match(telegram.last(), /Te aviso cuando <b>\$ORCA<\/b> suba de <b>1,50 \$<\/b>\. Ahora vale 1,20 \$/);
  await msg("/precio " + MINT + " >1.5");
  assert.equal(telegram.last(), "Ya tenías esa alerta.");
  await msg("/precio " + MINT + " 1");   // a bare number below the price is a "goes below" target
  assert.match(telegram.last(), /baje de <b>1,00 \$/);
  await msg("/lista");
  assert.match(telegram.last(), /^💲 <b>Alertas de precio<\/b>/);
  assert.match(telegram.last(), /\$ORCA<\/b>: cuando suba de <b>1,50 \$/);

  telegram.sent.length = 0;
  assert.equal((await bot.runPriceCycle()).alerts, 0);
  state.prices[MINT] = 1.6;
  assert.equal((await bot.runPriceCycle()).alerts, 1);
  assert.match(telegram.last(), /🚀 <b>\$ORCA ha subido de 1,50 \$<\/b>: ahora 1,60 \$/);
  assert.match(telegram.last(), /Alerta cumplida/);
  assert.match(telegram.last(), /dexscreener\.com\/solana\/PAIR1/);
  // fired once: removed, the "below" one stays
  assert.deepEqual(store.chat("1").prices.map((a) => a.kind), ["below"]);
  assert.equal((await bot.runPriceCycle()).alerts, 0);

  await msg("/precio " + MINT + " quitar");
  assert.match(telegram.last(), /Quitadas 1 alertas de precio de <b>\$ORCA/);
  assert.equal(store.chat("1").prices.length, 0);
  await msg("/precio " + MINT + " quitar");
  assert.match(telegram.last(), /No tenías alertas/);
});

test("price alerts: percentage moves re-arm from the new price", async () => {
  const state = { prices: { [MINT]: 0.00001 } };
  const { telegram, msg, bot, store } = setup(state);
  await msg("/lang en");
  await msg("/price " + MINT + " 20%");
  assert.match(telegram.last(), /moves <b>20%<\/b>/);
  assert.match(telegram.last(), /It is now \$0\.00001\./);
  state.prices[MINT] = 0.0000115;   // +15%: not yet
  assert.equal((await bot.runPriceCycle()).alerts, 0);
  state.prices[MINT] = 0.0000125;   // +25%
  assert.equal((await bot.runPriceCycle()).alerts, 1);
  assert.match(telegram.last(), /📈 <b>\$ORCA is up 25%<\/b> \(\$0\.00001 → \$0\.0000125\)/);
  assert.equal(store.chat("1").prices[0].ref, 0.0000125);
  state.prices[MINT] = 0.0000095;   // -24% from the new reference
  assert.equal((await bot.runPriceCycle()).alerts, 1);
  assert.match(telegram.last(), /📉 <b>\$ORCA is down 24%<\/b>/);
  assert.equal(store.chat("1").prices.length, 1);   // a move alert keeps running
});

test("price alerts: one request for many chats, failures and bad input", async () => {
  const state = { prices: { [MINT]: 2 } };
  const { telegram, msg, bot, store } = setup(state);
  await msg("/precio " + MINT + " <1", 1);
  await msg("/precio " + MINT + " >10%", 2);   // 10% up from now
  assert.match(telegram.last(), /suba de <b>2,20 \$/);
  state.dexCalls = 0;
  assert.equal((await bot.runPriceCycle()).alerts, 0);
  assert.equal(state.dexCalls, 1);
  // DexScreener down or the token missing this time: no alerts, alerts kept
  state.prices = "down";
  assert.equal((await bot.runPriceCycle()).alerts, 0);
  state.prices = {};
  assert.equal((await bot.runPriceCycle()).alerts, 0);
  assert.equal(store.chat("1").prices.length + store.chat("2").prices.length, 2);
  // no market, bad condition, invalid address
  await msg("/precio " + WALLET + " >1");
  assert.match(telegram.last(), /No encuentro mercado/);
  state.prices = { [MINT]: 2 };
  await msg("/precio " + MINT + " mucho");
  assert.match(telegram.last(), /No entiendo ese precio/);
  await msg("/precio 0xabc >1");
  assert.match(telegram.last(), /no parece una dirección/);
});

/* ---------- pure helpers ---------- */

test("parseCondition reads targets and percentages", () => {
  assert.deepEqual(parseCondition(">1,5", 1), { kind: "above", value: 1.5 });
  assert.deepEqual(parseCondition("<0.8", 1), { kind: "below", value: 0.8 });
  assert.deepEqual(parseCondition("$2", 1), { kind: "above", value: 2 });
  assert.deepEqual(parseCondition("0.5", 1), { kind: "below", value: 0.5 });
  assert.deepEqual(parseCondition("1.234,5", 1), { kind: "above", value: 1234.5 });
  assert.deepEqual(parseCondition("20%", 1), { kind: "move", value: 20 });
  assert.deepEqual(parseCondition("<50%", 2), { kind: "below", value: 1 });
  assert.equal(parseCondition("<100%", 2), null);
  assert.equal(parseCondition("0%", 2), null);
  assert.equal(parseCondition("abc", 2), null);
  assert.equal(parseCondition("", 2), null);
});

test("checkAlert and priceText", () => {
  assert.equal(checkAlert({ kind: "above", value: 2 }, 1.9), null);
  assert.deepEqual(checkAlert({ kind: "above", value: 2 }, 2), { kind: "above", to: 2 });
  assert.equal(checkAlert({ kind: "below", value: 2 }, 0), null);   // no price is not a crash
  assert.equal(checkAlert({ kind: "move", value: 10, ref: 1 }, 1.09), null);
  assert.equal(checkAlert({ kind: "move", value: 10, ref: 1 }, 0.9).kind, "down");
  assert.equal(priceText(64250.7, "en"), "$64,251");
  assert.equal(priceText(1.5, "es"), "1,50 $");
  assert.equal(priceText(0.00001234567, "en"), "$0.00001235");
});

test("diffToken ignores noise and reports improvements", () => {
  const base = { lvl: "MEDIUM", liq: 100000, signals: [{ code: "MKT_LIQ_LOW", s: "warn" }] };
  assert.deepEqual(diffToken(base, base), { worse: false, better: false, level: null, newSignals: [], liqDrop: null });
  const better = diffToken(base, { lvl: "LOW", liq: 100000, signals: [] });
  assert.equal(better.better, true);
  assert.equal(better.worse, false);
  // small liquidity moves and tiny pools are not alerts
  assert.equal(diffToken(base, Object.assign({}, base, { liq: 80000 })).liqDrop, null);
  assert.equal(diffToken({ lvl: "LOW", liq: 500, signals: [] }, { lvl: "LOW", liq: 10, signals: [] }).liqDrop, null);
  // noisy signals never become "new signal" alerts
  const st = tokenState(tokenResult({ reasons: [{ code: "MKT_VOLUME_LOW", s: "warn" }, { code: "MKT_NEW", s: "warn" }, { code: "MKT_LIQ_LOW", s: "warn" }] }));
  assert.deepEqual(st.signals.map((x) => x.code), ["MKT_LIQ_LOW"]);
});

test("walletMoves sorts by value and handles a first snapshot", () => {
  assert.deepEqual(walletMoves(null, {}), []);
  const m = walletMoves({ A: { q: 1, v: 30, s: "A" } }, { B: { q: 1, v: 500, s: "B" } });
  assert.deepEqual(m.map((x) => x.k), ["new", "sold"]);
});

test("formatting escapes HTML from token names", () => {
  const html = formatToken(tokenResult({ sym: "<b>X", name: "A & B" }), "es");
  assert.match(html, /\$&lt;b&gt;X/);
  assert.match(html, /A &amp; B/);
  assert.equal(escapeHtml("<a>&"), "&lt;a&gt;&amp;");
});

test("wallet formatting lists risky tokens and only counts spam", () => {
  const w = { wallet: WALLET, sol: 1.5, total: 4, hidden: 2, results: [
    Object.assign(tokenResult({ lvl: "HIGH", sym: "BAD", reasons: [{ code: "CTL_MINT_ACTIVE", s: "bad" }] }), { value: 12 }),
    Object.assign(tokenResult({ sym: "GOOD" }), { value: 900 }),
    { mint: "x", sym: "SP", lvl: "SPAM", reasons: [] }, { mint: "y", sym: "NM", lvl: "NO_MARKET", reasons: [] }
  ] };
  const html = formatWallet(w, "es");
  assert.match(html, /🔴 <b>\$BAD<\/b> 12,00 \$ — Riesgo alto: El creador puede crear más tokens/);
  assert.match(html, /🟢 <b>\$GOOD<\/b>/);
  assert.match(html, /1 parecen spam y 1 no tienen mercado/);
  assert.match(html, /2 con menos de 1 \$ ocultos/);
});

test("long messages are split under Telegram's limit", () => {
  const parts = splitMessage(Array.from({ length: 500 }, (_, i) => "line " + i).join("\n"), 1000);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= 1000));
  assert.equal(parts.join("\n").split("\n").length, 500);
});
