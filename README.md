# Foodboll

Football community app for Korean users and foreign residents in South Korea.
**One application, one backend, one database, one account, one player profile.** Korean (`ko`) and
Uzbek (`uz`) ship first; more languages are added by configuration, not by forking the product.

```
packages/i18n        shared message catalogs, glossary, locale resolution, content fallback
packages/contracts   zod schemas, enums, DTOs and error codes shared by API and web
apps/api             Fastify + PostgreSQL (Drizzle) REST API
apps/web             React (Vite) mobile-first web client
docs/i18n.md         how localization works, how to add a language, open items
```

## Quick start

Requires Node 22, pnpm 10 and Docker (for PostgreSQL).

```bash
pnpm install
pnpm db:up                                   # PostgreSQL 16 on :5432
cp apps/api/.env.example apps/api/.env       # set JWT_SECRET (>= 32 chars)
pnpm db:migrate
pnpm --filter @foodboll/api dev              # API on :3000
pnpm --filter @foodboll/web dev              # web on :5173 (proxies /api -> :3000)
```

## Checks

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

API tests need PostgreSQL. They create and drop a throwaway database; point them elsewhere with
`TEST_DATABASE_ADMIN_URL` (default `postgres://foodboll:foodboll@localhost:5432/postgres`).

`eslint` rejects hard-coded text in web components (`i18next/no-literal-string`): use `t('match.apply')`.

## Status

Implemented: the localization foundation end to end (language selection, account language,
multilingual matches, registration with bank-transfer payment and receipt upload, admin payment review, payment instructions, legal documents, localized notifications and errors,
admin visibility). **Not implemented yet:** sign-in/token issuing, admin screens for payment review (the API exists), teams/player profiles/statistics screens, notification delivery workers, admin UI.
See `docs/i18n.md#open-items`.
