# Mainz

A Discord moderation, utility, giveaway, and Word Bomb bot.

## Run locally

```bash
pnpm install
PORT=5000 pnpm --filter @workspace/api-server run dev
```

## Railway deployment

Railway uses `railway.json` to build and start the API server. The start command pushes the Drizzle schema before starting the bot, so database tables are created or updated on deployment. Add these variables to the Railway service:

- `DATABASE_URL` — PostgreSQL connection string used by the bot
- `DISCORD_BOT_TOKEN` — Discord bot token

Railway provides `PORT` automatically.

## Join to Create voice channels

Members who join a designated lobby voice channel get their own temporary voice channel, which is deleted automatically once it is empty. Configure it with:

- `JTC_LOBBY_CHANNEL_ID` — ID of the lobby voice channel (required; the feature is disabled when unset)
- `JTC_CATEGORY_ID` — ID of the category for created channels (optional; defaults to the lobby's category)

Each created channel is explicitly visible and joinable, even when its parent category denies those permissions. Its chat welcomes and pings the owner with a single **Commands** button. Clicking it opens a private control panel with action buttons and the full command list; parameterized actions prompt for their values. Owners can also use `!voice` (aliases `!v` and `!vc`) or `/voice help`. Bumping moves a channel to the top of its category with a one-hour cooldown; bitrate is limited by the server's boost tier. Ownership passes to another member when the owner leaves.

The bot needs the Manage Channels and Move Members permissions, and the Guild Voice States gateway intent. Temporary channels are tracked in memory, so channels left over from before a restart are not cleaned up automatically.

The bot service must remain running continuously because Discord bots require a long-lived process.

## Server XP and levels

Members earn 15–25 random XP from chat, at most once per minute, and 10 XP per minute while in a voice channel with at least two active, non-bot members. AFK-channel and self/server-deafened voice sessions do not earn XP. Every 100 XP grants a level; progress is stored per server and user.

Server managers can configure level-up announcements with `!levelup channel #channel` (or `reset` to announce where XP was earned), `!levelup title <text>`, `!levelup description <text>`, and `!levelup color #RRGGBB`. Use `reset` after title, description, or color to restore its default, and `!levelup status` to inspect the settings. Embed templates support `{user}`, `{username}`, `{level}`, `{levels_gained}`, `{xp}`, `{total_xp}`, `{progress}`, and `{next_level_xp}`. Chat XP can be restricted to selected text channels with `!levelup allow #channel` and `!levelup disallow #channel`; `!levelup allowed` lists the configuration and `!levelup clearallowed` returns to all text channels. These settings do not affect voice XP. Configure level role rewards with `!levelup role set <level> @role`, remove a mapping with `!levelup role remove <level>`, and inspect mappings with `!levelup role list`. When members reach a configured level, they receive its role; earlier level reward roles are kept. The bot needs Manage Roles and its highest role above each reward role.

Members can view their profile, credits, active boosters, and the server XP leaderboard with `!lvl`. The profile buttons also toggle that member's server and DM level-up notifications.

Vote rewards can be configured for one server with `!vote setup #channel <top.gg-vote-url> <discadia-vote-url>`. Each accepted vote from a member of that server adds a 20% XP boost for 12 hours, applicable to chat and voice XP in the configured server. Re-votes from the same provider are accepted at most once per 12 hours; votes on both sites can extend the active boost. Set strong, private `TOPGG_WEBHOOK_AUTH` and `DISCADIA_WEBHOOK_AUTH` secrets on the bot host, then configure `https://<your-service-domain>/api/webhooks/topgg` and `https://<your-service-domain>/api/webhooks/discadia` with the matching authorization header in each provider's webhook dashboard. On Railway, use the service's public domain for `<your-service-domain>`. Use `!vote status` and `!vote disable` to inspect or turn off vote rewards.

Server managers can restrict all economy commands—including mining, gathering, coins, trading, and role shop—to one text channel with `!economy set #channel`. Check the current setting using `!economy status` or remove the restriction with `!economy remove`.

Mysterious Crate reaction events can be configured with `!crate setup #channel [30m]`. The default interval is 30 minutes and each crate expires after 10 minutes; the first 🦉 reaction from a non-bot member wins a 25% XP boost for one hour. Active vote and crate boosts stack and can be checked with `!boosters`. Server managers can change the interval from 10 minutes to 24 hours with `!crate interval 1h`, pause/resume with `!crate pause` and `!crate resume`, and inspect settings using `!crate status`. The claimed crate embed is edited to show the winner and the server's total crates claimed.

Configure server boost announcements with `!boostmessage set #channel`; when a member starts boosting, the bot posts the perk embed there. Customize the title with `!boostmessage title <text>` and the description with `!boostmessage edit <description>`. The description supports `{user}`, `{username}`, and `{server}` placeholders. Use `!boostmessage reset` to restore the default title and perks, `!boostmessage status` to check settings, or `!boostmessage remove` to disable announcements.

Server managers can create reusable custom embeds with `!embed new <name>`, set content with `!embed edit <name> <title|description|color|image|thumbnail|footer> <value>`, add fields with `!embed field <name> add <field name>|<value>|[inline]`, preview with `!embed show <name>`, and send with `!embed send <name> #channel`. Use `!embed list` to see saved embeds; `!embed clear <name> <field>` clears one setting. Hex colors must use `#RRGGBB`; image and thumbnail values must be HTTP(S) URLs. Existing command-response embeds can be customized by command, for example `!embed override ban color #5865F2`, then previewed with `!embed override-show ban`. Use `!embed override-clear ban color` to clear one override or `!embed override-reset ban` to restore that command's defaults. `!embed` lists the full syntax.