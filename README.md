# HangoutSaiBot

A Discord moderation, utility, giveaway, and Word Bomb bot.

## Run locally

```bash
pnpm install
PORT=5000 pnpm --filter @workspace/api-server run dev
```

## Railway deployment

Railway uses `railway.json` to build and start the API server. Add these variables to the Railway service:

- `DISCORD_BOT_TOKEN` — Discord bot token

Railway provides `PORT` automatically.

The bot service must remain running continuously because Discord bots require a long-lived process.