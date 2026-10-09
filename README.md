# Mainz

A Discord moderation, utility, giveaway, and Word Bomb bot.

## Run locally

```bash
pnpm install
PORT=5000 pnpm --filter @workspace/api-server run dev
```

## Railway deployment

Railway uses `railway.json` to build and start the API server. Add these variables to the Railway service:

- `DATABASE_URL` — PostgreSQL connection string used by the bot
- `DISCORD_BOT_TOKEN` — Discord bot token

Railway provides `PORT` automatically.

## Join to Create voice channels

Members who join a designated lobby voice channel get their own temporary voice channel, which is deleted automatically once it is empty. Configure it with:

- `JTC_LOBBY_CHANNEL_ID` — ID of the lobby voice channel (required; the feature is disabled when unset)
- `JTC_CATEGORY_ID` — ID of the category for created channels (optional; defaults to the lobby's category)

Each temporary channel's chat gets a control panel with Lock, Unlock, Hide, Show, Limit (cycles 0/2/5/10), Rename and Claim buttons; all but Claim are owner-only, and ownership passes to another member when the owner leaves.

The bot needs the Manage Channels and Move Members permissions, and the Guild Voice States gateway intent. Temporary channels are tracked in memory, so channels left over from before a restart are not cleaned up automatically.

The bot service must remain running continuously because Discord bots require a long-lived process.