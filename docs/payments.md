# Payments

There is no payment gateway: players pay a fixed fee (`MATCH_FEE_KRW`, default ₩10,000, the same for
everyone) by bank transfer to one account. The design goal is that **nobody has to check payments by
hand**: not organizers, and admins only for the exceptions.

## What a player sees

1. Joins a match. A seat is held for 24 hours (or until kick-off, whichever is sooner).
2. The registration page shows the amount, the bank account (with copy buttons) and a **4-digit
   payment code**, e.g. `4307`. The player puts the code in the transfer's _sender memo_ (the text the
   receiving account sees next to the sender's name).
3. Players whose bank app has no memo field save the **name their bank shows** on transfers. It is
   matched instead of the code.
4. The registration turns `CONFIRMED` by itself, usually within a minute of the money arriving, and the
   player is notified in their language (in-app, and in Telegram if they enabled it).
5. Fallback: _Paid but not confirmed yet?_ → upload a receipt screenshot. An admin reviews it
   (`PAYMENT_REVIEW`) and confirms or rejects with a reason code.

## How automatic confirmation works

```
receiving account's phone                             Foodboll API
 ┌──────────────────────────┐   HTTPS POST (secret)   ┌───────────────────────────────┐
 │ bank SMS / app alert     │ ──────────────────────▶ │ POST /v1/integrations/        │
 │ forwarder app            │                         │      bank-notifications       │
 └──────────────────────────┘                         │                               │
 ┌──────────────────────────┐   channel_post          │ POST /v1/integrations/        │
 │ same alert posted into a │ ──────────────────────▶ │      telegram/webhook         │
 │ private Telegram channel │   (bot is channel admin)│                               │
 └──────────────────────────┘                         └──────────────┬────────────────┘
                                                                     ▼
                                              parse → match → confirm → notify → audit
                                              (one database transaction per message)
```

Foodboll never connects to the bank and holds no bank credentials. The owner of the receiving account
forwards **their own** notifications from **their own** phone. Open Banking / PG integration would be
the "proper" way and can replace the ingestion step later without touching anything else
(`ingestBankMessage` takes text, source and time).

### Setting up the channel (pick one or both)

**A. HTTP webhook (any forwarder app).** Set `BANK_WEBHOOK_SECRET` (≥ 32 random characters) and
optionally `BANK_SMS_SENDERS` (comma-separated sender numbers/names the bank uses; strongly
recommended). Configure an SMS/notification forwarder on the receiving phone to
`POST https://<api>/v1/integrations/bank-notifications` with header `Authorization: Bearer <secret>` and
JSON `{"text": "...", "sender": "...", "receivedAt": "<ISO 8601>", "messageId": "<optional>"}`.
`messageId` makes retries idempotent. With the feature off (no secret) the endpoint answers `404`; a
wrong secret answers `401`.

**B. Private Telegram channel.** Create a bot with @BotFather and set `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_BOT_USERNAME` and `TELEGRAM_WEBHOOK_SECRET` (all three or none). Create a **private channel**,
add the bot as an administrator, and set `TELEGRAM_BANK_CHAT_ID` to the channel id (negative number).
Register the webhook once:

```bash
curl -sS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d url="https://<api>/v1/integrations/telegram/webhook" \
  -d secret_token="$TELEGRAM_WEBHOOK_SECRET" \
  -d 'allowed_updates=["message","channel_post"]'
```

Then make the receiving phone post each bank alert into that channel (an Android automation or
notification-forwarding app that can call the Telegram Bot API `sendMessage`). Only `channel_post`
events from exactly that channel are treated as bank messages; messages in groups and edited posts
are ignored.

**Platform limits.** Reading SMS/notifications is possible on **Android** (forwarder apps need the
SMS or Notification Access permission). **iOS does not allow apps to read SMS or other apps'
notifications**, so the receiving phone must be Android (an old spare phone is fine), or the bank must
offer an email/Telegram alert that can be forwarded. Keep the phone charged, online and exempt from
battery optimization, and check that it is still forwarding (see _Operations_).

### Matching rules

A message is a deposit only if it mentions 입금 and has exactly one plausible amount; anything else is
dropped (unrelated texts are not stored) or stored as `IGNORED`. For a deposit, the engine looks at
payments still expected (`AWAITING_PAYMENT`, `PAYMENT_REVIEW`, `PAYMENT_REJECTED`) whose registration is
still `APPLIED` and whose window has not closed, then:

| Situation                                                                       | Result                                                |
| ------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Exactly one payment's 4-digit code appears in the message, amount equals fee    | **Confirmed** automatically (`REFERENCE`)             |
| No code, exactly one payment with the same amount and the depositor's saved name | **Confirmed** automatically (`NAME`)                  |
| Code found but amount differs                                                   | Admin queue (`AMOUNT_MISMATCH`)                       |
| Two or more candidates                                                          | Admin queue (`MULTIPLE_CANDIDATES`)                   |
| Nothing fits                                                                    | Admin queue (`NO_CANDIDATE`)                          |
| Message older than `BANK_MESSAGE_MAX_AGE_HOURS` (36 h) or from the future       | Admin queue (`STALE_MESSAGE`)                         |
| More than `BANK_AUTO_CONFIRM_LIMIT_PER_10_MIN` (30) automatic confirmations in 10 min | Admin queue (`RATE_GUARD`), a circuit breaker   |
| The registration changed while matching (cancelled, confirmed by an admin)      | Admin queue (`STATE_CHANGED`)                         |

Confirmation, the player's notification, the audit event and the deposit record are written in **one
transaction**: a deposit is `MATCHED` if and only if its payment really was confirmed. The same message
delivered twice is processed once (a hash of source + text + message id, or a 10-minute bucket).

Admins resolve the rest on **Admin → Bank deposits**: assign a deposit to a registration (only if the
amount equals what is due) or ignore it. Every status change is an append-only `payment_events` row
(a database trigger forbids updates and deletes).

## Threat model and honest limits

- **Spoofed messages.** Anyone can send an SMS that _looks_ like a bank alert to the receiving phone,
  and the forwarder cannot tell. The defenses: `BANK_SMS_SENDERS` (drops other senders; sender ids can
  still be spoofed on some networks), exact amount, a code that must be present or a unique name,
  single-candidate matching, the staleness window and the rate guard. The residual risk is a forged
  alert for a payment that never happened. **Reconcile against the bank statement** regularly (see
  below). If this risk is not acceptable, keep admin review and use the code only to pre-sort.
- **Parser coverage.** Korean banks do not share a format. `apps/api/src/banking/parse-bank-message.ts`
  is conservative and fails safe (unclear → human), but it was developed against **synthetic samples**.
  Before trusting it, collect ~20 real deposit alerts from the receiving account's bank (including a
  memo case and a masked-name case), redact them, add them to `apps/api/test/bank.test.ts` and adjust
  the parser until they all behave as expected. Until then expect many messages in the admin queue.
- **Memo handling differs per bank.** Banks differ in whether a sender memo exists, how long it may
  be, and whether the alert shows it at all; that is why the code is only 4 digits and why the saved
  depositor name and the receipt upload exist. Verify with the real alerts of your bank (see above).
- **Phone is a single point of failure.** If it is offline, payments simply stay `AWAITING_PAYMENT`
  until a receipt is uploaded or the phone reconnects; nothing is lost or confirmed wrongly.
- **Personal data.** Raw bank messages contain names and partial account numbers. They are stored in
  `bank_deposits.raw_text`, shown to admins only, never logged and never sent to clients except the
  admin API. There is no purge job yet: decide a retention period (and implement the purge) with your
  legal adviser. Receipts are stored outside the database (`RECEIPT_DIR`); keep them at least as long
  as the accounting retention you are subject to (Korean commercial/tax law generally requires
  transaction records for years; verify the exact period with an accountant).
- **Regulatory.** Collecting money for organized activities may require business registration
  (e.g. 통신판매업 / 사업자등록) and, if you hold or settle funds for organizers, financial-services
  rules. This document is not legal advice: confirm with a Korean accountant or lawyer before launch.

## Operations

- Daily (or weekly while volume is low): compare the bank statement with `payment_events` /
  `bank_deposits` for the period; every credit should be `MATCHED` or visibly queued.
- Watch **Admin → Bank deposits → needs a decision**; an empty queue is the normal state.
- Heartbeat: if no deposit has been received for longer than a quiet weekend would explain, test the
  forwarder by sending a ₩1 transfer from another account (it will land in the queue as `NO_CANDIDATE`).
- Rotating secrets: change `BANK_WEBHOOK_SECRET` and the forwarder together; change
  `TELEGRAM_WEBHOOK_SECRET` and call `setWebhook` again.

## Configuration

| Variable                            | Default            | Meaning                                                                 |
| ----------------------------------- | ------------------ | ----------------------------------------------------------------------- |
| `MATCH_FEE_KRW`                     | `10000`            | The one price, snapshotted on each match when it is announced           |
| `RECEIPT_DIR`                       | `./data/receipts`  | Private, persistent, backed-up directory for receipt files              |
| `BANK_WEBHOOK_SECRET`               | unset (feature off)| Bearer secret for `POST /v1/integrations/bank-notifications` (≥ 32 chars) |
| `BANK_SMS_SENDERS`                  | empty (any sender) | Comma-separated allowed sender numbers/names                            |
| `TELEGRAM_BANK_CHAT_ID`             | unset              | Private channel whose posts are bank notifications                      |
| `BANK_AUTO_CONFIRM_LIMIT_PER_10_MIN`| `30`               | Circuit breaker for automatic confirmations                             |
| `BANK_MESSAGE_MAX_AGE_HOURS`        | `36`               | Older messages are never confirmed automatically                        |
| `TELEGRAM_BOT_TOKEN` / `_USERNAME` / `TELEGRAM_WEBHOOK_SECRET` | unset | Telegram login, notifications and the bank channel (all or none) |
| `UPLOAD_RATE_LIMIT_PER_MINUTE`      | `10`               | Per-client cap on receipt uploads                                       |

## Where things live

- Payment states and rules: `apps/api/src/services/registrations.ts` (`confirmPaymentInTx`,
  `allocateReferenceCode`, `releaseLapsedSeats`).
- Parsing and matching: `apps/api/src/banking/parse-bank-message.ts`,
  `apps/api/src/services/bank-deposits.ts`.
- Audit trail: `apps/api/src/services/payment-audit.ts` and the `payment_events` table.
- Player UI: `apps/web/src/features/registrations/`. Admin UI: `apps/web/src/features/admin/money/`.
