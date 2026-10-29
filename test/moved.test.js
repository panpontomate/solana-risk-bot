import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store.js";
import { createMovedBot, withFallback, newBotLink } from "../src/moved.js";

const NEW = "SolFlagBot";

function fakeTelegram(fail) {
  const calls = [];
  return {
    calls,
    call: async (method, params) => {
      calls.push({ method, params });
      if (fail && fail(method, params)) { const e = new Error("Forbidden"); e.code = 403; throw e; }
      if (method.startsWith("getMy")) return {};
      return true;
    },
    send: async (chatId, html) => {
      calls.push({ method: "send", params: { chat_id: chatId, text: html } });
      if (fail && fail("send", { chat_id: chatId })) { const e = new Error("Forbidden: bot can't initiate conversation with a user"); e.code = 403; throw e; }
    }
  };
}

test("the /start payload of a web link is passed on to the new bot", () => {
  assert.equal(newBotLink(NEW, "/start p_So11111111111111111111111111111111111111112_a50"), "https://t.me/SolFlagBot?start=p_So11111111111111111111111111111111111111112_a50");
  assert.equal(newBotLink(NEW, "/start"), "https://t.me/SolFlagBot");
  assert.equal(newBotLink(NEW, "hola"), "https://t.me/SolFlagBot");
  assert.equal(newBotLink(NEW, "/start <b>"), "https://t.me/SolFlagBot");   // nothing odd gets into the link
});

test("the old bot answers anything with a button to the new one, in the chat's language", async () => {
  const store = createStore(null), tg = fakeTelegram();
  store.chat("7").lang = "en";
  const moved = createMovedBot({ telegram: tg, store, newUsername: NEW });
  await moved.handleMessage({ chat: { id: 7 }, text: "/start w_ABC" });
  await moved.handleMessage({ chat: { id: 8 }, from: { language_code: "es" }, text: "BONK" });
  const [en, es] = tg.calls;
  assert.match(en.params.text, /SolFlag has moved to @SolFlagBot/);
  assert.equal(en.params.reply_markup.inline_keyboard[0][0].url, "https://t.me/SolFlagBot?start=w_ABC");
  assert.match(es.params.text, /SolFlag se ha mudado a @SolFlagBot/);
  assert.equal(es.params.reply_markup.inline_keyboard[0][0].text, "Abrir @SolFlagBot");
});

test("chats with watches or price alerts are told once; a blocked chat is not retried", async () => {
  const store = createStore(null), tg = fakeTelegram((m, p) => m === "sendMessage" && p.chat_id === "3");
  store.chat("1").watches.push({ kind: "token", addr: "M" });
  store.chat("2");                                  // nothing running: not bothered
  store.chat("3").prices.push({ mint: "M" });       // blocked the old bot
  store.chat("4").prices.push({ mint: "M" });
  const moved = createMovedBot({ telegram: tg, store, newUsername: NEW });
  assert.equal(await moved.announce(0), 2);
  assert.deepEqual(tg.calls.map((c) => c.params.chat_id), ["1", "3", "4"]);
  assert.equal(await moved.announce(0), 0);         // second start: nobody twice
  assert.equal(tg.calls.length, 3);
});

test("an alert the new bot cannot deliver goes through the old one, saying where to go", async () => {
  const store = createStore(null);
  const main = fakeTelegram((m, p) => m === "send" && p.chat_id === "9"), old = fakeTelegram();
  const tg = withFallback(main, old, NEW, store);
  await tg.send("5", "riesgo sube");
  assert.equal(old.calls.length, 0);
  await tg.send("9", "riesgo sube");
  assert.equal(old.calls.length, 1);
  assert.match(old.calls[0].params.text, /^riesgo sube\n\nℹ️ Este aviso te llega por el bot antiguo\. Abre @SolFlagBot/);
  // without an old bot the error is the caller's, as before
  await assert.rejects(withFallback(main, null, NEW, store).send("9", "x"), (e) => e.code === 403);
});

test("each bot keeps its own update offset; the old single offset is dropped", () => {
  const store = createStore(null);
  assert.equal(store.offsetOf(111), 0);
  store.setOffset(111, 50); store.setOffset(222, 7);
  assert.equal(store.offsetOf(111), 50);
  assert.equal(store.offsetOf(222), 7);
});
