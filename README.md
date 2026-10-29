# solana-risk-bot

**SolFlag** on Telegram, the companion of [solflag.com](https://solflag.com). A Telegram bot built on [solana-risk-engine](https://github.com/panpontomate/solana-risk-engine). Paste a Solana token or wallet address and the bot explains its risk. You can also watch tokens and wallets and get alerts when something changes. It has no dependencies besides the engine.

- **Paste an address:** for a token, you get the four risk lights with their reasons; for a wallet, its riskiest tokens.
- **`/watch <address>` / `/vigilar`:**
  - a token alerts you when its risk level rises, a new risk signal appears (for example, the mint authority moves from a program to a person's wallet, or LP gets unlocked) or liquidity drops 30% or more;
  - a token's **creator** is watched too: the bot finds the creator through RugCheck, alerts you to their moves, and flags 🚨 when they sell the token itself;
  - a wallet alerts you about what it buys or sells.
- **`/price <token> <condition>` / `/precio`:** price alerts, checked every 2 minutes with one DexScreener request per 30 tokens:
  - `>1.5` or `<0.8`: once, when the price goes above or below that (then the alert is removed);
  - `>50%` or `<30%`: the same, as a percentage from the current price;
  - `20%`: every time the price moves 20% up or down, counting again from the new price;
  - `off`: remove the token's alerts. `/price <token>` alone shows the current price.
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
| `OLD_TELEGRAM_BOT_TOKEN` | — | A previous bot after a move (SolFlag moved from @panpontomate_escaner_bot to @SolFlagBot). It answers every message with a button to the new bot, tells chats with watches or alerts once, and delivers alerts to people who have not opened the new bot yet. Watches and alerts are shared. |
| `SOLANA_RPC_URL` | free public RPCs | Your own RPC (Helius, Triton…). Faster and more reliable. |
| `WATCH_INTERVAL_MIN` | 15 | Minutes between checks of watched items. |
| `MAX_WATCHES` | 10 | Watched items per chat. |
| `PRICE_INTERVAL_MIN` | 2 | Minutes between price alert checks. |
| `MAX_PRICE_ALERTS` | 10 | Price alerts per chat. |

## Tests

```sh
npm test
```

## Disclaimer

This is a heuristic tool, not financial advice. "Low risk" means none of the signals the engine looks for were found, not that a token is safe.

## License

MIT
