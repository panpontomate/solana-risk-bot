# solana-risk-bot — @SolFlagBot en Telegram

Bot de Node sin más dependencias que `solana-risk-engine`. Corre 24/7 en Bot-Hosting.

## Mapa
- `src/index.js` — arranque; `bot.js` — comandos; `telegram.js` — API de Telegram (polling).
- `watch.js` — vigilancia de tokens/wallets/creadores; `price.js` — alertas de precio.
- `format.js`, `texts.js` — mensajes es/en; `store.js` — estado en `data/` (fuera de git).
- `.env` (fuera de git) — `TELEGRAM_BOT_TOKEN`. `iniciar-bot.bat` para arrancarlo en local.

## Tests
`npm test` (`node --test test/*.test.js`).

## Publicar
1. Push a `main` (CI en `.github/workflows/tests.yml`).
2. El cambio NO está en vivo hasta que el usuario reinicia el bot en Bot-Hosting: avisarle siempre.
3. Al subir el motor: cambiar la versión de `solana-risk-engine` en `package.json`.

## Trampas
- No usar `getUpdates` desde otro proceso con el mismo token: choca con el polling de Bot-Hosting.
  Los avisos automáticos van por otro bot (`@solflag_avisos_bot`).
- Escapar todo lo que venga de fuera en los mensajes HTML (nombres, direcciones, enlaces).
