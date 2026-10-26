// The bot's public profile in Telegram (name, descriptions and command menu), in Spanish and English.
// Set on every start, but only what differs: Telegram rate-limits setMyName to a few changes a day.

export const PROFILE = {
  es: {
    name: "SolFlag",
    short: "Red flags de cualquier token o wallet de Solana, explicadas. Y avisos si algo cambia. solflag.com",
    description: "🚩 SolFlag revisa tokens y wallets de Solana con 5 banderas: control del creador, concentración, liquidez, dependencias y lanzamiento.\n\nPégame una dirección y te digo su riesgo con el motivo de cada aviso. Con /vigilar te aviso si sube el riesgo, cae la liquidez o el creador vende, y con /precio de los movimientos de precio.\n\nWeb: solflag.com · Herramienta orientativa, no es consejo financiero.",
    commands: [
      ["vigilar", "Avisarte si un token o wallet cambia"],
      ["precio", "Alerta de precio de un token"],
      ["lista", "Lo que vigilas y tus alertas"],
      ["dejar", "Dejar de vigilar algo"],
      ["idioma", "Cambiar de idioma"],
      ["ayuda", "Cómo funciona"]
    ]
  },
  en: {
    name: "SolFlag",
    short: "Red flags of any Solana token or wallet, explained. Plus alerts when something changes. solflag.com",
    description: "🚩 SolFlag checks Solana tokens and wallets with 5 flags: creator control, concentration, liquidity, dependencies and launch.\n\nPaste an address and I'll tell you its risk, with the reason behind every warning. /watch alerts you when risk rises, liquidity drops or the creator sells, and /price follows price moves.\n\nWeb: solflag.com · A guide, not financial advice.",
    commands: [
      ["watch", "Alert me when a token or wallet changes"],
      ["price", "Price alert for a token"],
      ["list", "What you watch and your alerts"],
      ["unwatch", "Stop watching something"],
      ["lang", "Change language"],
      ["help", "How it works"]
    ]
  }
};

// Spanish is the default (no language_code); English for Telegram apps set to English
export async function syncProfile(telegram, log = () => {}) {
  for (const [lang, p] of Object.entries(PROFILE)) {
    const lc = lang === "es" ? {} : { language_code: lang };
    const steps = [
      ["getMyName", "setMyName", "name", p.name],
      ["getMyShortDescription", "setMyShortDescription", "short_description", p.short],
      ["getMyDescription", "setMyDescription", "description", p.description]
    ];
    for (const [get, set, key, want] of steps) {
      try {
        const now = await telegram.call(get, lc);
        if ((now && now[key]) !== want) { await telegram.call(set, { ...lc, [key]: want }); log(`perfil: ${key} (${lang}) actualizado`); }
      } catch (e) { log(`perfil: ${key} (${lang}) no se pudo poner: ${e.message}`); }
    }
    try {
      await telegram.call("setMyCommands", { ...lc, commands: p.commands.map(([command, description]) => ({ command, description })) });
    } catch (e) { log(`perfil: comandos (${lang}) no se pudieron poner: ${e.message}`); }
  }
}
