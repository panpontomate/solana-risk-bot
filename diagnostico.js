// Checks the bot's connection to Telegram without printing the token: node diagnostico.js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(root, ".env"), "utf8");
const m = env.match(/^\s*TELEGRAM_BOT_TOKEN\s*=\s*(\S+)/m);
if (!m) { console.log("No hay token en .env"); process.exit(1); }
const api = (method) => fetch("https://api.telegram.org/bot" + m[1] + "/" + method).then((r) => r.json());

const me = await api("getMe");
console.log("getMe:", me.ok ? "OK, bot @" + me.result.username : "FALLA: " + me.description);
const wh = await api("getWebhookInfo");
if (wh.ok) console.log("webhook:", wh.result.url ? "ACTIVO (" + wh.result.url + ") — impide recibir mensajes por polling" : "ninguno (bien)", "· mensajes pendientes:", wh.result.pending_update_count);
else console.log("getWebhookInfo FALLA:", wh.description);
