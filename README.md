# solana-risk-bot

A Telegram bot built on [solana-risk-engine](https://github.com/panpontomate/solana-risk-engine). Paste a Solana token or wallet address and the bot explains its risk. You can also watch tokens and wallets and get alerts when something changes. It has no dependencies besides the engine.

- **Paste an address:** for a token, you get the four risk lights with their reasons; for a wallet, its riskiest tokens.
- **`/watch <address>` / `/vigilar`:**
  - a token alerts you when its risk level rises, a new risk signal appears (for example, the mint authority moves from a program to a person's wallet, or LP gets unlocked) or liquidity drops 30% or more;
  - a token's **creator** is watched too: the bot finds the creator through RugCheck, alerts you to their moves, and flags 🚨 when they sell the token itself;
  - a wallet alerts you about what it buys or sells.
- **`/list`, `/unwatch <address or number>`, `/lang en|es`**

Noisy signals such as daily volume dips are never alerted. A failed check never raises an alert, so you don't get false "sold everything" or "risk dropped" messages.

## Run it

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy its token.
2. Copy `.env.example` to `.env` and paste the token into `TELEGRAM_BOT_TOKEN`. Optionally, add your own `SOLANA_RPC_URL`.
3. Run:

```sh
npm install
npm start
```

On Windows you can also double-click `iniciar-bot.bat`.

Watched items and each chat's language are kept in `data/store.json`.

## Configuration

| Variable | Default | |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | required | From @BotFather. Keep it secret. |
| `SOLANA_RPC_URL` | free public RPCs | Your own RPC (Helius, Triton…). Faster and more reliable. |
| `WATCH_INTERVAL_MIN` | 15 | Minutes between checks of watched items. |
| `MAX_WATCHES` | 10 | Watched items per chat. |

## Tests

```sh
npm test
```

## Disclaimer

This is a heuristic tool, not financial advice. "Low risk" means none of the signals the engine looks for were found, not that a token is safe.

## License

MIT
