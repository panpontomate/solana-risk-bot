import test from "node:test";
import assert from "node:assert/strict";
import { createBot, parse } from "../src/bot.js";
import { createStore } from "../src/store.js";
import { splitMessage, escapeHtml } from "../src/telegram.js";
import { tokenState, diffToken, walletMoves } from "../src/watch.js";
import { formatToken, formatWallet } from "../src/format.js";

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
    client: { ownRpc: () => false, rpc: async (method, params) => {
      if (method === "getAccountInfo") return params[0] === MINT ? { value: { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", data: { parsed: { type: "mint" } } } } : { value: null };
      throw new Error("unexpected " + method);
    } },
    analyzeToken: async () => { state.calls = (state.calls || 0) + 1; return state.token; },
    analyzeAddress: async (a) => a === MINT ? { kind: "token", token: state.token } : { kind: "wallet", wallet: state.wallet },
    takeSnapshots: async (ws) => { state.snapCalls = (state.snapCalls || 0) + 1; return { ts: 1, snapshots: { [ws[0]]: state.snap }, failed: 0 }; }
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

test("errors from the engine become friendly messages", async () => {
  const scannerFail = { client: { ownRpc: () => false }, analyzeAddress: async () => { const e = new Error("x"); e.code = "DEX_UNREACHABLE"; throw e; } };
  const tg = fakeTelegram();
  const b = createBot({ telegram: tg, store: createStore(null), scanner: scannerFail });
  await b.handleMessage({ chat: { id: 1 }, text: MINT });
  assert.match(tg.last(), /❌ No se pudo conectar con DexScreener/);
});

/* ---------- pure helpers ---------- */

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
