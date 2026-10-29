// The old bot (@panpontomate_escaner_bot) after the move to @SolFlagBot. It runs in the same process
// with OLD_TELEGRAM_BOT_TOKEN: it answers every message with a button to the new bot (keeping the /start
// payload, so the web's "watch" and "price alert" links still work), tells each chat with watches or price
// alerts once, and delivers alerts the new bot cannot (Telegram does not let a bot write first to someone
// who never opened it). Watches and alerts live in the same store, so nothing has to be copied.

export const MOVED = {
  es: {
    text: (u) => `🚩 <b>SolFlag se ha mudado a @${u}</b>\n\nEste bot ya no analiza. Abre el nuevo: tus vigilancias y alertas de precio siguen ahí, no tienes que volver a crearlas.`,
    button: (u) => `Abrir @${u}`,
    note: (u) => `ℹ️ Este aviso te llega por el bot antiguo. Abre @${u} para recibirlos allí.`,
    short: (u) => `SolFlag se ha mudado a @${u}. Ábrelo para seguir con tus vigilancias.`,
    description: (u) => `🚩 SolFlag se ha mudado a @${u}.\n\nAbre el nuevo bot: tus vigilancias y alertas de precio siguen allí. Web: solflag.com`
  },
  en: {
    text: (u) => `🚩 <b>SolFlag has moved to @${u}</b>\n\nThis bot no longer analyses. Open the new one: your watches and price alerts are still there, no need to set them up again.`,
    button: (u) => `Open @${u}`,
    note: (u) => `ℹ️ This alert came through the old bot. Open @${u} to get them there.`,
    short: (u) => `SolFlag has moved to @${u}. Open it to keep your watches.`,
    description: (u) => `🚩 SolFlag has moved to @${u}.\n\nOpen the new bot: your watches and price alerts are still there. Web: solflag.com`
  }
};

// Language of a chat: what it chose in the bot, else its Telegram app language
function langOf(store, chatId, from) {
  const c = store.data.chats[chatId];
  if (c && c.lang) return c.lang === "en" ? "en" : "es";
  return from && /^en/i.test(from.language_code || "") ? "en" : "es";
}

// t.me link to the new bot; a /start payload from a web link is passed on unchanged
export function newBotLink(username, text) {
  const m = /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{1,64})$/.exec((text || "").trim());
  return "https://t.me/" + username + (m ? "?start=" + m[1] : "");
}

export function createMovedBot({ telegram, store, newUsername, log = () => {} }) {
  async function tell(chatId, lang, start) {
    const T = MOVED[lang];
    await telegram.call("sendMessage", {
      chat_id: chatId, text: T.text(newUsername), parse_mode: "HTML", link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[{ text: T.button(newUsername), url: newBotLink(newUsername, start) }]] }
    });
  }

  async function handleMessage(msg) {
    const chatId = String(msg.chat.id);
    await tell(chatId, langOf(store, chatId, msg.from), msg.text);
  }

  // Once per chat with something running: they would otherwise never know where their alerts went
  async function announce(pause = 60) {
    let sent = 0;
    for (const id of Object.keys(store.data.chats)) {
      const c = store.data.chats[id];
      if (c.movedNotice || (!(c.watches || []).length && !(c.prices || []).length)) continue;
      try { await tell(id, langOf(store, id), ""); sent++; }
      catch (e) { log("mudanza: aviso a", id, "falló:", e.message); }   // blocked the bot: never retried
      c.movedNotice = true;
      store.save();
      if (pause) await new Promise((r) => setTimeout(r, pause));
    }
    return sent;
  }

  // Profile of the old bot: name kept, descriptions point to the new one, no command menu
  async function syncMovedProfile() {
    for (const lang of ["es", "en"]) {
      const lc = lang === "es" ? {} : { language_code: lang }, T = MOVED[lang];
      for (const [get, set, key, want] of [
        ["getMyShortDescription", "setMyShortDescription", "short_description", T.short(newUsername)],
        ["getMyDescription", "setMyDescription", "description", T.description(newUsername)]
      ]) {
        try {
          const now = await telegram.call(get, lc);
          if ((now && now[key]) !== want) await telegram.call(set, { ...lc, [key]: want });
        } catch (e) { log(`mudanza: ${key} (${lang}) no se pudo poner: ${e.message}`); }
      }
      try { await telegram.call("deleteMyCommands", lc); } catch (e) { /* not important */ }
    }
  }

  return { handleMessage, announce, syncMovedProfile };
}

// send() of the new bot that falls back to the old one for chats that never opened the new bot (403),
// adding a line that tells them where to go
export function withFallback(main, old, newUsername, store) {
  return {
    call: main.call,
    getUpdates: main.getUpdates,
    async send(chatId, html) {
      try { return await main.send(chatId, html); }
      catch (e) {
        if (!old || e.code !== 403) throw e;
        return old.send(chatId, html + "\n\n" + MOVED[langOf(store, String(chatId))].note(newUsername));
      }
    }
  };
}
