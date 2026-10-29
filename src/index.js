// Starts the bot: long polling for messages and a periodic pass over watched tokens and wallets.
// Configuration comes from environment variables or a .env file next to package.json:
//   TELEGRAM_BOT_TOKEN   required, from @BotFather
//   OLD_TELEGRAM_BOT_TOKEN  optional, a previous bot: it only points people to the new one (see moved.js)
//   SOLANA_RPC_URL       optional, your own RPC (Helius, Triton...). Without it, free public RPCs
//   WATCH_INTERVAL_MIN   optional, minutes between watch checks (default 15)
//   MAX_WATCHES          optional, per chat (default 10)
//   PRICE_INTERVAL_MIN   optional, minutes between price alert checks (default 2)
//   MAX_PRICE_ALERTS     optional, per chat (default 10)
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createScanner } from "solana-risk-engine";
import { createTelegram } from "./telegram.js";
import { createStore } from "./store.js";
import { createBot } from "./bot.js";
import { syncProfile } from "./profile.js";
import { createMovedBot, withFallback } from "./moved.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv(join(root, ".env"));

const intervalMin = Number(process.env.WATCH_INTERVAL_MIN) || 15;
const maxWatches = Number(process.env.MAX_WATCHES) || 10;
const priceMin = Number(process.env.PRICE_INTERVAL_MIN) || 2;
const maxPrices = Number(process.env.MAX_PRICE_ALERTS) || 10;
const log = (...a) => console.log(new Date().toISOString(), ...a);

if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error("Falta TELEGRAM_BOT_TOKEN. Crea el archivo .env (mira .env.example) con el token que te dio @BotFather.");
  process.exit(1);
}

const main = createTelegram(process.env.TELEGRAM_BOT_TOKEN);
const store = createStore(join(root, "data", "store.json"));
const scanner = createScanner({ rpcUrl: process.env.SOLANA_RPC_URL });

const me = await main.call("getMe");
// Bot antiguo (si está): solo manda a la gente al nuevo y entrega los avisos que el nuevo no puede
const oldToken = process.env.OLD_TELEGRAM_BOT_TOKEN;
const old = oldToken && oldToken !== process.env.TELEGRAM_BOT_TOKEN ? createTelegram(oldToken) : null;
const oldMe = old ? await old.call("getMe").catch((e) => { log("bot antiguo no disponible:", e.message); return null; }) : null;
const telegram = withFallback(main, oldMe ? old : null, me.username, store);
const bot = createBot({ telegram, store, scanner, intervalMin, maxWatches, priceMin, maxPrices, log });

log(`bot @${me.username} listo · RPC ${scanner.client.ownRpc() ? "propio" : "gratuito"} · vigilancia cada ${intervalMin} min · precios cada ${priceMin} min` +
  (oldMe ? ` · @${oldMe.username} redirige a @${me.username}` : ""));
// Nombre, descripción y menú de comandos de SolFlag en Telegram (solo cambia lo que no coincide)
syncProfile(main, log).catch(() => {});

if (oldMe) {
  const moved = createMovedBot({ telegram: old, store, newUsername: me.username, log });
  moved.syncMovedProfile().catch(() => {});
  moved.announce().then((n) => { if (n) log(`mudanza: avisados ${n} chats con vigilancias o alertas`); }).catch((e) => log("mudanza:", e.message));
  poll(old, oldMe.id, (m) => moved.handleMessage(m));
}

// Watch loop: one pass at a time, never overlapping
let cycleRunning = false;
async function cycle() {
  if (cycleRunning) return;
  cycleRunning = true;
  try {
    const r = await bot.runWatchCycle();
    if (r.checked) log(`vigilancia: ${r.checked} direcciones revisadas, ${r.alerts} avisos`);
  } catch (e) { log("vigilancia falló", e.message); }
  finally { cycleRunning = false; }
}
setInterval(cycle, intervalMin * 60000);
setTimeout(cycle, 20000);

// Price loop: much lighter (one DexScreener request per 30 tokens), so it runs more often
let priceRunning = false;
setInterval(async () => {
  if (priceRunning) return;
  priceRunning = true;
  try {
    const r = await bot.runPriceCycle();
    if (r.alerts) log(`precios: ${r.checked} tokens, ${r.alerts} avisos`);
  } catch (e) { log("precios falló", e.message); }
  finally { priceRunning = false; }
}, priceMin * 60000);

// Message loop of one bot. Each message is handled in the background so a slow analysis never blocks the others.
async function poll(tg, botId, handle) {
  for (;;) {
    try {
      const updates = await tg.getUpdates(store.offsetOf(botId), 50);
      for (const u of updates) {
        store.setOffset(botId, u.update_id + 1);
        if (u.message) {
          log(botId === me.id ? "mensaje" : "mensaje (bot antiguo)", u.message.chat.id, JSON.stringify(u.message.text || "").slice(0, 80));
          handle(u.message).catch((e) => log("error", e.message));
        }
      }
    } catch (e) {
      log("telegram", e.message);
      await new Promise((r) => setTimeout(r, e.retryAfter ? e.retryAfter * 1000 : 5000));
    }
  }
}
poll(main, me.id, (m) => bot.handleMessage(m));
