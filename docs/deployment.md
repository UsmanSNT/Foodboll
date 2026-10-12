# Deployment

One server, Docker Compose, and Caddy for HTTPS. The browser talks to one origin: `https://DOMAIN`
serves the web app, and `https://DOMAIN/api/...` is the API. No CORS is involved.

| Service   | Image          | Role                                                           |
| --------- | -------------- | -------------------------------------------------------------- |
| `db`      | `postgres:16`  | Data in the `db-data` volume. Not published to the host.       |
| `migrate` | `foodboll-api` | Applies the Drizzle migrations on each `up`, then exits.       |
| `api`     | `foodboll-api` | Fastify on port 3000 inside the network. Non-root user.        |
| `web`     | `foodboll-web` | Caddy: static web app, automatic TLS, proxies `/api` to `api`. |

Files: `docker-compose.prod.yml`, `deploy/api.Dockerfile`, `deploy/web.Dockerfile`,
`deploy/Caddyfile`, `deploy/production.env.example`.

Every command below uses this alias (run it from the repository root):

```bash
COMPOSE="docker compose --env-file .env.production -f docker-compose.prod.yml"
```

## Requirements

- A Linux server with Docker Engine and the Compose v2 plugin, and enough disk for the `receipts`
  and `db-data` volumes.
- A DNS `A` record for `DOMAIN` that points at the server. Caddy cannot obtain a certificate before
  DNS resolves.
- Inbound TCP 80 and 443 open (Caddy needs 80 for the ACME challenge and redirects to 443).
  Nothing else should be reachable from the internet; PostgreSQL is not published.

## First deployment

1. Get the code and create the production env file. It is git-ignored and must stay private.

   ```bash
   git clone <repository-url> foodboll && cd foodboll
   cp deploy/production.env.example .env.production
   chmod 600 .env.production
   ```

2. Fill in `.env.production`. The required values are:

   - `DOMAIN`: the public hostname.
   - `POSTGRES_PASSWORD`: URL-safe, because it is embedded in `DATABASE_URL`. `openssl rand -hex 24`.
   - `JWT_SECRET`: at least 32 characters. `openssl rand -base64 48`.

   Leave optional settings commented out. An empty value such as `TELEGRAM_BOT_TOKEN=` counts as
   set and fails validation at start-up.

3. Build and start. `migrate` runs first; `api` starts only after it succeeds.

   ```bash
   $COMPOSE up -d --build
   $COMPOSE ps                      # db, api: healthy; web: running
   $COMPOSE logs migrate            # "Migrations applied."
   curl -fsS https://DOMAIN/api/health   # {"status":"ok"}
   ```

If `migrate` fails, `api` never starts, which is the intended behaviour. Read its log
(`$COMPOSE logs migrate`), fix the cause, and run `$COMPOSE up -d` again.

## Telegram

Telegram sign-in, notifications and the bank channel all depend on the bot. Set the three
`TELEGRAM_*` variables together, then reload the stack with `$COMPOSE up -d`.

1. In BotFather, run `/setdomain` and give `DOMAIN`. The Login Widget only works on whitelisted
   domains.
2. Register the webhook. Telegram sends `X-Telegram-Bot-Api-Secret-Token` with every update, and the
   API rejects updates without the right value. Run this from a shell that does not record history,
   so the token is not stored.

   ```bash
   curl -fsS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
     --data-urlencode "url=https://${DOMAIN}/api/v1/integrations/telegram/webhook" \
     --data-urlencode "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
     --data-urlencode 'allowed_updates=["message","channel_post"]'
   curl -fsS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
   ```

   `getWebhookInfo` must show no `last_error_message`. Delivery problems are visible there.

3. Bank channel (only if automatic payment confirmation is used): create a private channel, add the
   bot as an administrator (bots receive channel posts only as administrators), set
   `TELEGRAM_BANK_CHAT_ID` to the channel's id (negative), and reload. The message format and the
   SMS-forwarding setup are in `docs/payments.md`.

## Verify

- `https://DOMAIN/` loads the web app, and the certificate is valid.
- `https://DOMAIN/api/health` returns `{"status":"ok"}`. A `503` means the database is unreachable.
- Sign in with Telegram from a phone. The Login Widget must render and complete.
- Look at `$COMPOSE logs api` after a sign-in. Logs must not contain tokens, SQL parameters or bank
  message text.

The development shortcut (`DEV_LOGIN`) must never be set on the server. The API refuses to start
with it unless `NODE_ENV` is `development` or `test`, and compose sets `NODE_ENV=production`.

## Updates

Migrations are forward-only: there are no down migrations. Take a database backup before every
update.

```bash
$COMPOSE exec -T db pg_dump -U foodboll -d foodboll -Fc > "backup-$(date +%F-%H%M).dump"
git pull
$COMPOSE up -d --build
```

Changed env values take effect with the same `up -d`. Compose recreates only the containers whose
configuration changed.

## Backups and restore

Back up both the database and the receipt files. Receipts are personal data: store the backups
encrypted, with restricted access.

```bash
# Database
$COMPOSE exec -T db pg_dump -U foodboll -d foodboll -Fc > "db-$(date +%F).dump"

# Receipts (the volume is named <project>_receipts; the project name is `foodboll`)
docker run --rm -v foodboll_receipts:/data:ro -v "$PWD":/backup alpine \
  tar czf "/backup/receipts-$(date +%F).tgz" -C /data .
```

Restore the database into a running `db` container:

```bash
$COMPOSE exec -T db pg_restore -U foodboll -d foodboll --clean --if-exists < db-YYYY-MM-DD.dump
```

Test a restore on a separate machine before relying on the backups.

## Operations

- Logs: `$COMPOSE logs -f api`. Each service keeps 5 files of 10 MB.
- Health: `$COMPOSE ps` shows the `api` and `db` health status. An external uptime monitor should
  poll `https://DOMAIN/api/health`; the stack has no alerting of its own.
- Restarts: every service uses `restart: unless-stopped`, so containers come back after a crash or
  a server reboot. Enable Docker at boot (`systemctl enable docker`).
- Rollback: the previous image is replaced on update. To roll back, restore the backup taken before
  the update and check out the previous commit before `up -d --build`.

## Security checklist

- Firewall: allow SSH (from trusted addresses where possible), 80 and 443. Deny everything else.
- SSH: key-based login only. Keep the OS updated.
- `.env.production` is mode 600 and never committed. `.dockerignore` keeps it out of images.
- `TRUST_PROXY` is set to `1` by compose, because exactly one proxy (Caddy) is in front of the API.
  Do not set it to `true`: clients could then spoof their IP for rate limiting.
- Rotate `JWT_SECRET`, `TELEGRAM_WEBHOOK_SECRET` and `BANK_WEBHOOK_SECRET` if any of them leaks.
  Rotating `JWT_SECRET` signs every user out.
- The Content-Security-Policy is `Report-Only` (see `deploy/Caddyfile`). Enforce it only after the
  Telegram login has been checked on the real domain in a browser.

## Known limits

- One host, no failover. A deploy restarts the API and causes a short outage.
- Receipts are stored on the local `receipts` volume. Object storage is not implemented.
- No monitoring or alerting beyond the health endpoint and container status.
- The web app is not packaged as an installable PWA or a store app.
- Bank message retention and purge jobs are not implemented (see `docs/payments.md`).
