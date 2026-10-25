// Starts the bot: long polling for messages and a periodic pass over watched tokens and wallets.
// Configuration comes from environment variables or a .env file next to package.json:
//   TELEGRAM_BOT_TOKEN   required, from @BotFather
//   SOLANA_RPC_URL       optional, your own RPC (Helius, Triton...). Without it, free public RPCs
//   WATCH_INTERVAL_MIN   optional, minutes between watch checks (default 15)
//   MAX_WATCHES          optional, per chat (default 10)
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createScanner } from "solana-risk-engine";
import { createTelegram } from "./telegram.js";
import { createStore } from "./store.js";
import { createBot } from "./bot.js";

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
const log = (...a) => console.log(new Date().toISOString(), ...a);

if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error("Falta TELEGRAM_BOT_TOKEN. Crea el archivo .env (mira .env.example) con el token que te dio @BotFather.");
  process.exit(1);
}

const telegram = createTelegram(process.env.TELEGRAM_BOT_TOKEN);
const store = createStore(join(root, "data", "store.json"));
const scanner = createScanner({ rpcUrl: process.env.SOLANA_RPC_URL });
const bot = createBot({ telegram, store, scanner, intervalMin, maxWatches, log });

const me = await telegram.call("getMe");
log(`bot @${me.username} listo · RPC ${scanner.client.ownRpc() ? "propio" : "gratuito"} · vigilancia cada ${intervalMin} min`);

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

// Message loop. Each message is handled in the background so a slow analysis never blocks the others.
for (;;) {
  try {
    const updates = await telegram.getUpdates(store.offset, 50);
    for (const u of updates) {
      store.offset = u.update_id + 1;
      if (u.message) {
        log("mensaje", u.message.chat.id, JSON.stringify(u.message.text || "").slice(0, 80));
        bot.handleMessage(u.message).catch((e) => log("error", e.message));
      }
    }
  } catch (e) {
    log("telegram", e.message);
    await new Promise((r) => setTimeout(r, e.retryAfter ? e.retryAfter * 1000 : 5000));
  }
}
