# Foodboll

Football community app for Korean users and foreign residents in South Korea.
**One application, one backend, one database, one account, one player profile.** Korean (`ko`),
Uzbek (`uz`) and English (`en`) ship first; more languages are added by configuration, not by
forking the product.

- **Players** pick their city or district and see the matches announced there (by day), join with
  one tap, pay a flat fee by bank transfer that is **confirmed automatically**, and build a public
  player page (matches played, activity, level, achievements).
- **Organizers** are community members approved for a province or district. They announce matches in
  their own languages and mark attendance. They are never asked to check payments.
- **Admins** handle the exceptions: unmatched deposits, receipts, organizer applications, payment
  instructions and legal documents.

```
packages/i18n        message catalogs (ko/uz/en), glossary, locale resolution, content fallback
packages/contracts   zod schemas, enums, DTOs, error codes, regions and progression shared by API and web
apps/api             Fastify + PostgreSQL (Drizzle) REST API
apps/web             React (Vite) mobile-first web client
docs/i18n.md         how localization works, how to add a language, open items
docs/payments.md     bank-transfer payments, automatic confirmation, setup, limits and risks
```

## Quick start

Requires Node 22, pnpm 10 and Docker (for PostgreSQL).

```bash
pnpm install
pnpm db:up                                   # PostgreSQL 16 on :5432
cp apps/api/.env.example apps/api/.env       # set JWT_SECRET (>= 32 chars); uncomment DEV_LOGIN=true for local sign-in
pnpm db:migrate
pnpm --filter @foodboll/api dev              # API on :3000
pnpm --filter @foodboll/web dev              # web on :5173 (proxies /api -> :3000)
```

The API reads `apps/api/.env` from its working directory when it exists (the `pnpm` scripts above
run there); variables already set in the environment win. Production should use real environment
variables only.

Sign-in is **Telegram Login** (set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` and
`TELEGRAM_WEBHOOK_SECRET`, see `docs/payments.md`). For local development only, `DEV_LOGIN=true`
enables a name-only sign-in (commented out in `.env.example`); the API refuses to start with it
unless `NODE_ENV` is explicitly `development` or `test`. Without a role it creates players and
never changes an existing user's role.

### Running in production

Run the API under a restart supervisor (systemd, a Docker restart policy): a lost database
connection fails the requests that were using it but other crash modes remain. Behind a reverse
proxy set `TRUST_PROXY` to a hop count or a list of proxy IPs/CIDRs; `true` trusts every
`X-Forwarded-For` hop, so clients could spoof their address for rate limiting. Logs never contain
SQL parameters, bank messages or authorization headers. Players are notified (in the app and,
once they pressed Start, in Telegram) when the time or place of a match they joined changes;
payment deadlines are not moved by an edit.

### Demo data

With the API running (`NODE_ENV=development`, `DEV_LOGIN=true`), fill an empty database with organizers, players, matches in
several cities, confirmed payments and two past matches with attendance:

```bash
DATABASE_URL=postgres://foodboll:foodboll@localhost:5432/foodboll \
  pnpm --filter @foodboll/api exec tsx scripts/demo-seed.ts
```

Sign in as `Foodboll Admin` (admin), `Minjun Kim` (organizer, Seoul), `Rustam Aliyev` (organizer,
Gyeonggi) or any of the listed players.

## Checks

```bash
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
```

API tests need PostgreSQL. They create and drop a throwaway database; point them elsewhere with
`TEST_DATABASE_ADMIN_URL` (default `postgres://foodboll:foodboll@localhost:5432/postgres`).

`eslint` rejects hard-coded text in web components (`i18next/no-literal-string`): use `t('match.apply')`.

## Status

Implemented: language selection and account language (ko/uz/en), regions (172 cities and districts)
with a per-region match feed, organizer scoping and applications, Telegram sign-in and notifications,
registration with automatic bank-transfer confirmation and a receipt fallback, player profiles with
levels, attendance and achievements, and the player, organizer and admin screens.

Not implemented / needs a decision before launch (details in `docs/payments.md` and
`docs/i18n.md#open-items`): cancelling a match (with refunds), the real bank's message formats for the
parser, native review of Uzbek text, legal text and business registration, object storage for
receipts, retention and purge jobs for bank messages, teams, and a push channel other than Telegram.
