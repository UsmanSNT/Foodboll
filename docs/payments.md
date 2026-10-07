# Payments

There is no payment gateway: players pay a fixed fee (`MATCH_FEE_KRW`, default ₩10,000, the same for
everyone) by bank transfer to one account. The design goal is that **nobody has to check payments by
hand**: not organizers, and admins only for the exceptions.

## What a player sees

1. Joins a match. A seat is held for 24 hours (or until kick-off, whichever is sooner).
2. The registration page shows the amount, the bank account (with copy buttons) and a **4-digit
   payment code**, e.g. `4307`. The player puts the code in the transfer's _sender memo_ (the text the
   receiving account sees next to the sender's name).
3. Players whose bank app has no memo field save the **name their bank shows** on transfers. It can be
   matched instead of the code, but only once the name has been _proven_ (see below); until then such
   a deposit waits for an admin, who is shown the registration it most likely belongs to.
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

### Setting up the channel (pick exactly one)

Use **one** channel for the receiving phone. The source is part of a message's identity, so a phone
that posts every alert to both the webhook and Telegram makes each deposit arrive twice (the second
copy lands in the admin queue as `NO_CANDIDATE`).

**A. HTTP webhook (any forwarder app).** Set `BANK_WEBHOOK_SECRET` (≥ 32 random characters) and
optionally `BANK_SMS_SENDERS` (comma-separated sender numbers/names the bank uses; strongly
recommended). Configure an SMS/notification forwarder on the receiving phone to
`POST https://<api>/v1/integrations/bank-notifications` with header `Authorization: Bearer <secret>` and
JSON `{"text": "...", "sender": "...", "receivedAt": "<ISO 8601>", "messageId": "<optional>"}`.
The forwarder must send a stable `receivedAt` (the time the phone got the alert, not the time of the
retry) or a `messageId`: a retry of an alert that carries neither is told apart from the original only
within the same 10-minute window of the server clock. With the feature off (no secret) the endpoint answers `404`; a
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

A message is a deposit only if it mentions 입금 and has exactly one plausible amount. Messages that do
not mention 입금, or that are withdrawals, notices (입금예정 ...) or empty, are dropped or stored as
`IGNORED`. A message that mentions 입금 but whose amount cannot be read (none, several, a decimal or
malformed number such as `10,000.50`) is stored as `UNMATCHED` / `NOT_PARSED`, so it shows in the admin
queue. The account-type word 입출금 is not a withdrawal, and a parenthesised receiving-account suffix
such as `통장(1234)` or `계좌(1234)` is removed so it can never be read as a payment code.

For a deposit, the engine looks at payments still expected (`AWAITING_PAYMENT`, `PAYMENT_REVIEW`,
`PAYMENT_REJECTED`) whose registration is still `APPLIED` and whose window has not closed, then:

| Situation                                                                                                                | Result                                                        |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Exactly one payment's 4-digit code appears in the message, amount equals fee, no other player's saved name               | **Confirmed** automatically (`REFERENCE`)                     |
| That code matches one payment but another player's saved name (whole token) of an expecting payment is also in the alert | Admin queue (`MULTIPLE_CANDIDATES`)                           |
| No code, one payment with the same amount whose owner's **proven** name is in the alert, name used by one account only   | **Confirmed** automatically (`NAME`)                          |
| Same, but the name is not proven yet                                                                                     | Admin queue (`NAME_UNVERIFIED`), likely registration attached |
| The saved name is also saved by any other account (any state)                                                            | Admin queue (`MULTIPLE_CANDIDATES`)                           |
| Code found but amount differs                                                                                            | Admin queue (`AMOUNT_MISMATCH`)                               |
| Two or more candidates                                                                                                   | Admin queue (`MULTIPLE_CANDIDATES`)                           |
| Nothing fits                                                                                                             | Admin queue (`NO_CANDIDATE`)                                  |
| Amount unreadable                                                                                                        | Admin queue (`NOT_PARSED`)                                    |
| Message older than `BANK_MESSAGE_MAX_AGE_HOURS` (36 h) or from the future                                                | Admin queue (`STALE_MESSAGE`)                                 |
| More than `BANK_AUTO_CONFIRM_LIMIT_PER_10_MIN` (30) automatic confirmations in 10 min                                    | Admin queue (`RATE_GUARD`), a circuit breaker                 |
| The registration changed while matching (cancelled, confirmed by an admin)                                               | Admin queue (`STATE_CHANGED`)                                 |

**Names.** A saved name matches only as whole token(s) of the alert's remaining text (`KARIMOV AZIZ`
or `KARIMOVAZIZ`, never part of a longer word or number), and must be at least 3 characters for Hangul
names and 4 for any other script. A name counts as **proven** (`users.depositor_name_verified`) once a
deposit was matched to that user by code, or assigned by an admin, and that deposit's text contained
the saved name as whole token(s). Changing the saved name clears the proof, and revoking a confirmed
payment (below) clears it too. The code stays the primary mechanism; the name is a convenience for
people whose bank app has no memo field, and their first payment is confirmed by an admin in one click.

Confirmation, the player's notification, the audit event and the deposit record are written in **one
transaction**: a deposit is `MATCHED` if and only if its payment really was confirmed. The same message
delivered twice is processed once. The identity of a message is its `messageId` if sent; otherwise the
hash of source + text (+ the year of receipt) when the alert prints its own date and time; otherwise
the hash plus the 10-minute window of `receivedAt`. A genuine second transfer with identical text and
no printed time and no `messageId` cannot be told apart from a retry within that window.

Admins resolve the rest on **Admin → Bank deposits**: assign a deposit to a registration (only if the
amount equals what is due) or ignore it. A `NAME_UNVERIFIED` row names the registration it probably
belongs to; assigning it proves the player's name for next time. Every status change is an append-only `payment_events` row
(a database trigger forbids updates and deletes).

### Correcting a wrong confirmation (revoke)

If a payment was confirmed for the wrong person (a forged or misread alert, a stolen name), an admin
rejects it: `POST /v1/admin/registrations/:id/payment/reject` with `{"reason": "<one of
AMOUNT_MISMATCH | RECEIPT_UNREADABLE | PAYMENT_NOT_FOUND | OTHER>"}` (`PAYMENT_NOT_FOUND` fits best).
It works only while the payment is `PAYMENT_CONFIRMED`, the registration is `CONFIRMED`, the match has
not started and no attendance mark exists; otherwise `409`. The response is the usual admin payment.
In one transaction it sets the payment to `PAYMENT_REJECTED` with a **new** reference code and a new
due date (a full window, but never later than kick-off), the registration back to `APPLIED`, writes a
`REJECTED` audit event with `detail.revoked = true` and the linked deposit ids, and sends the player
the normal localized `PAYMENT_REJECTED` notification. A bank deposit that had confirmed it returns to
`UNMATCHED` (reason `STATE_CHANGED`, no registration) and the player's name proof is cleared.

Runbook afterwards: (1) open **Admin → Bank deposits → needs a decision**, the freed deposit is
there; (2) assign it to the registration it really belongs to, or ignore it; (3) the wronged player
who really paid either has their payment found by that assign or uploads a receipt; (4) reconcile the
statement. Closing a cancelled payment (`REFUND_PENDING`) _without refund_ is refused when a bank
deposit settled it: the money is in the account, use **refund**.

### Player cancellation cutoff

A player can cancel their own registration (`POST /v1/registrations/:id/cancel`) only while MORE
than `PLAYER_CANCELLATION_CUTOFF_HOURS` (5, in `@foodboll/contracts`) remain before kick-off,
compared at the exact instant: 5 h 1 min is allowed, exactly 5 h or less is refused with
`409 CANCELLATION_CLOSED`; a started match still answers `409 MATCH_STARTED`. A paid registration
cancelled in time goes to `REFUND_PENDING` and the team refunds it. Inside the cutoff the web app
hides the cancel button and tells the player to contact the organizer. This does not affect
cancelling the whole match below, nor the automatic release of lapsed unpaid seats.

### Cancelling a match (refunds)

An organizer (of that match) or an admin cancels with `POST /v1/matches/:id/cancel`. It works only
before kick-off and only once (`409 MATCH_STARTED` / `409 MATCH_CANCELLED`). In one transaction,
under the match lock that also serializes applications, edits and attendance:

| Registration / payment before                                      | After                                                                                                                                            |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CONFIRMED` + `PAYMENT_CONFIRMED`, or `APPLIED` + `PAYMENT_REVIEW` | registration `CANCELLED`, payment **`REFUND_PENDING`**, reference code freed, a `REFUND_PENDING` audit event (`detail.reason = MATCH_CANCELLED`) |
| `APPLIED` + `AWAITING_PAYMENT` / `PAYMENT_REJECTED`                | registration `CANCELLED`, receipt dropped and reference code freed, as when a player cancels (nothing was paid)                                  |
| `CONFIRMED` in a free match (no payment row)                       | registration `CANCELLED`                                                                                                                         |

Every affected player gets a `MATCH_CANCELLED` notification in their own language (in-app, and in
Telegram if they pressed Start): the match was cancelled, a payment will be refunded and the team
will contact them. A hold whose payment window had already lapsed is closed silently. The match
stays readable (`cancelledAt` is set on `MatchDto` / `MatchSummaryDto`) and shows a banner and the
refund message in the app, but it leaves the feed and the region counts, refuses applications,
edits and attendance, and no longer counts towards anyone's statistics or XP.

**The app does not move money and holds no phone numbers.** `REFUND_PENDING` is a to-do list: the
payments appear on the **Refunds to process** tab of the admin payments screen. Admins and organizers contact those
players by phone (outside the app, for example through the community's own channels), send the
money back from the receiving account, and then press **refund** on the admin screen, which marks the
payment `REFUNDED` and tells the player. Reconcile these returns against the bank statement like any
other transaction.

## Threat model and honest limits

- **Spoofed messages.** Anyone can send an SMS that _looks_ like a bank alert to the receiving phone,
  and the forwarder cannot tell. The defenses: `BANK_SMS_SENDERS` (drops other senders; sender ids can
  still be spoofed on some networks), exact amount, a code that must be present or a unique _proven_
  name, single-candidate matching, the staleness window and the rate guard. The residual risk is a forged
  alert for a payment that never happened. **Reconcile against the bank statement** regularly (see
  below). If this risk is not acceptable, keep admin review and use the code only to pre-sort.
- **Name squatting.** Anyone can save someone else's name as theirs. A saved name never confirms on
  its own until a deposit under it was matched by code or by an admin, a name saved by two accounts
  never confirms, and a code that matches one payment is overruled when another player's saved name is
  in the same alert. What remains: a person who learns a victim's code _and_ the victim's name, or an
  admin who assigns a wrong deposit; both leave an audit trail and can be revoked.
- **Reference codes** are 4 digits (9,799 usable) and are freed with the seat. Lapsed holds release
  their codes when someone applies to that match, and, if the pool ever runs dry, when any applicant
  needs a code (up to 500 lapsed holds are released at once). A closed `REFUND_PENDING` payment frees
  its code. `No free payment reference code` in the log means roughly 9,800 holds are genuinely live.
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

| Variable                                                       | Default             | Meaning                                                                   |
| -------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------- |
| `MATCH_FEE_KRW`                                                | `10000`             | The one price, snapshotted on each match when it is announced             |
| `RECEIPT_DIR`                                                  | `./data/receipts`   | Private, persistent, backed-up directory for receipt files                |
| `BANK_WEBHOOK_SECRET`                                          | unset (feature off) | Bearer secret for `POST /v1/integrations/bank-notifications` (≥ 32 chars) |
| `BANK_SMS_SENDERS`                                             | empty (any sender)  | Comma-separated allowed sender numbers/names                              |
| `TELEGRAM_BANK_CHAT_ID`                                        | unset               | Private channel whose posts are bank notifications                        |
| `BANK_AUTO_CONFIRM_LIMIT_PER_10_MIN`                           | `30`                | Circuit breaker for automatic confirmations                               |
| `BANK_MESSAGE_MAX_AGE_HOURS`                                   | `36`                | Older messages are never confirmed automatically                          |
| `TELEGRAM_BOT_TOKEN` / `_USERNAME` / `TELEGRAM_WEBHOOK_SECRET` | unset               | Telegram login, notifications and the bank channel (all or none)          |
| `UPLOAD_RATE_LIMIT_PER_MINUTE`                                 | `10`                | Per-client cap on receipt uploads                                         |

## Where things live

- Payment states and rules: `apps/api/src/services/registrations.ts` (`confirmPaymentInTx`,
  `allocateReferenceCode`, `releaseLapsedSeats`).
- Parsing and matching: `apps/api/src/banking/parse-bank-message.ts`,
  `apps/api/src/services/bank-deposits.ts`.
- Audit trail: `apps/api/src/services/payment-audit.ts` and the `payment_events` table.
- Player UI: `apps/web/src/features/registrations/`. Admin UI: `apps/web/src/features/admin/money/`.
