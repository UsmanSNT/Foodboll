import { sql, type SQL } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import {
  LEGAL_DOCUMENT_TYPES,
  IDENTITY_PROVIDERS,
  NOTIFICATION_CHANNELS,
  PAYMENT_EVENT_TYPES,
  PAYMENT_REJECT_REASONS,
  PAYMENT_STATUSES,
  REGISTRATION_STATUSES,
  NOTIFICATION_TYPES,
  USER_ROLES,
} from '@foodboll/contracts';

/** `col IN ('A', 'B')` built from compile-time constants (never user input). */
const oneOf = (column: AnyPgColumn, values: readonly string[]): SQL =>
  sql`${column} in (${sql.join(
    values.map((value) => sql.raw(`'${value}'`)),
    sql`, `,
  )})`;

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/**
 * Supported content languages. Every language-bearing column references `languages.code`, so
 * adding a language is an INSERT here (plus a catalog in @foodboll/i18n), never a schema change.
 */
export const languages = pgTable(
  'languages',
  {
    code: text('code').primaryKey(),
    nativeName: text('native_name').notNull(),
    englishName: text('english_name').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [check('languages_code_format', sql`${t.code} ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'`)],
);

/**
 * Where football is played: provinces (level 1) and their cities/districts (level 2). Reference
 * data seeded by migration from `REGION_SEEDS`; admins can add more at runtime.
 */
export const regions = pgTable(
  'regions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Stable URL-safe id, e.g. 'seoul' or 'gyeonggi-ansan'. Never changes. */
    code: text('code').notNull().unique(),
    parentId: uuid('parent_id').references((): AnyPgColumn => regions.id, { onDelete: 'restrict' }),
    level: smallint('level').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    enabled: boolean('enabled').notNull().default(true),
  },
  (t) => [
    check('regions_level_valid', sql`${t.level} in (1, 2)`),
    check('regions_level_matches_parent', sql`(${t.level} = 1) = (${t.parentId} is null)`),
    check('regions_code_format', sql`${t.code} ~ '^[a-z]+(-[a-z]+)*$'`),
    index('regions_parent_idx').on(t.parentId, t.sortOrder),
  ],
);

export const regionTranslations = pgTable(
  'region_translations',
  {
    regionId: uuid('region_id')
      .notNull()
      .references(() => regions.id, { onDelete: 'cascade' }),
    languageCode: text('language_code')
      .notNull()
      .references(() => languages.code, { onUpdate: 'cascade', onDelete: 'restrict' }),
    name: text('name').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.regionId, t.languageCode] }),
    check('region_translations_name_length', sql`char_length(${t.name}) between 1 and 60`),
  ],
);

/**
 * Deliberately has NO nationality column: speaking Uzbek says nothing about nationality, and we
 * only collect it if a legal requirement appears and the user explicitly provides it.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    displayName: text('display_name').notNull(),
    role: text('role').notNull().default('PLAYER'),
    /** The user's explicit language choice. NULL = never chosen (device language is used). */
    preferredLanguage: text('preferred_language').references(() => languages.code, {
      onUpdate: 'cascade',
      onDelete: 'restrict',
    }),
    /** Raw language tag last reported by the user's device; support context only. */
    deviceLocale: text('device_locale'),
    /** Where the user plays; the match feed defaults to it. */
    /** Set when the user pressed Start in the Telegram bot (so the bot may message them). */
    telegramStartedAt: timestamp('telegram_started_at', { withTimezone: true }),
    homeRegionId: uuid('home_region_id').references(() => regions.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('users_role_valid', oneOf(t.role, USER_ROLES)),
    check('users_display_name_length', sql`char_length(${t.displayName}) between 1 and 100`),
    check('users_device_locale_length', sql`char_length(${t.deviceLocale}) <= 35`),
    index('users_preferred_language_idx').on(t.preferredLanguage),
  ],
);

export const matches = pgTable(
  'matches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizerId: uuid('organizer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Language the organizer originally wrote in; shown to readers lacking a translation. */
    sourceLanguage: text('source_language')
      .notNull()
      .references(() => languages.code, { onUpdate: 'cascade', onDelete: 'restrict' }),
    regionId: uuid('region_id')
      .notNull()
      .references(() => regions.id, { onDelete: 'restrict' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    /** Proper noun as signed locally (usually Korean); not translated. */
    venueName: text('venue_name').notNull(),
    venueAddress: text('venue_address'),
    playersPerSide: smallint('players_per_side').notNull(),
    /** Registration capacity. */
    maxPlayers: smallint('max_players').notNull().default(10),
    feeKrw: integer('fee_krw').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('matches_players_per_side_range', sql`${t.playersPerSide} between 3 and 11`),
    check('matches_max_players_range', sql`${t.maxPlayers} between 6 and 60`),
    check('matches_ends_after_start', sql`${t.endsAt} > ${t.startsAt}`),
    check(
      'matches_venue_length',
      sql`char_length(${t.venueName}) between 1 and 100 and coalesce(char_length(${t.venueAddress}), 0) <= 200`,
    ),
    index('matches_region_starts_idx').on(t.regionId, t.startsAt),
    check('matches_fee_range', sql`${t.feeKrw} between 0 and 1000000`),
    index('matches_starts_at_idx').on(t.startsAt),
    index('matches_organizer_idx').on(t.organizerId),
  ],
);

/** One row per (match, language). Each text field is independently optional. */
export const matchTranslations = pgTable(
  'match_translations',
  {
    matchId: uuid('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    languageCode: text('language_code')
      .notNull()
      .references(() => languages.code, { onUpdate: 'cascade', onDelete: 'restrict' }),
    title: text('title').notNull(),
    description: text('description'),
    rules: text('rules'),
    locationInstructions: text('location_instructions'),
    equipmentRequirements: text('equipment_requirements'),
    cancellationPolicy: text('cancellation_policy'),
  },
  (t) => [
    primaryKey({ columns: [t.matchId, t.languageCode] }),
    check('match_translations_title_length', sql`char_length(${t.title}) between 1 and 200`),
    check(
      'match_translations_body_length',
      sql`coalesce(char_length(${t.description}), 0) <= 5000
        and coalesce(char_length(${t.rules}), 0) <= 5000
        and coalesce(char_length(${t.locationInstructions}), 0) <= 5000
        and coalesce(char_length(${t.equipmentRequirements}), 0) <= 5000
        and coalesce(char_length(${t.cancellationPolicy}), 0) <= 5000`,
    ),
  ],
);

/**
 * Bank details are append-only history: changing them inserts a new row and deactivates the old
 * one, so past payments can always be traced to the instructions that were shown.
 */
export const paymentInstructions = pgTable(
  'payment_instructions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Bank-registered values are identical in every language and are never translated. */
    accountNumber: text('account_number').notNull(),
    accountHolder: text('account_holder').notNull(),
    isActive: boolean('is_active').notNull().default(false),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'payment_instructions_account_number_length',
      sql`char_length(${t.accountNumber}) between 4 and 64`,
    ),
    // At most one active row, enforced by the database rather than application code.
    uniqueIndex('payment_instructions_single_active_idx')
      .on(t.isActive)
      .where(sql`${t.isActive}`),
  ],
);

export const paymentInstructionTranslations = pgTable(
  'payment_instruction_translations',
  {
    paymentInstructionId: uuid('payment_instruction_id')
      .notNull()
      .references(() => paymentInstructions.id, { onDelete: 'cascade' }),
    languageCode: text('language_code')
      .notNull()
      .references(() => languages.code, { onUpdate: 'cascade', onDelete: 'restrict' }),
    bankName: text('bank_name').notNull(),
    instructions: text('instructions').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.paymentInstructionId, t.languageCode] }),
    check(
      'payment_instruction_translations_length',
      sql`char_length(${t.bankName}) between 1 and 100 and char_length(${t.instructions}) between 1 and 2000`,
    ),
  ],
);

/** Terms, privacy, cancellation and refund documents. Versioned and immutable once published. */
export const legalDocuments = pgTable(
  'legal_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(),
    version: integer('version').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => [
    check('legal_documents_type_valid', oneOf(t.type, LEGAL_DOCUMENT_TYPES)),
    check('legal_documents_version_positive', sql`${t.version} > 0`),
    unique('legal_documents_type_version_key').on(t.type, t.version),
  ],
);

export const legalDocumentTranslations = pgTable(
  'legal_document_translations',
  {
    documentId: uuid('document_id')
      .notNull()
      .references(() => legalDocuments.id, { onDelete: 'cascade' }),
    languageCode: text('language_code')
      .notNull()
      .references(() => languages.code, { onUpdate: 'cascade', onDelete: 'restrict' }),
    title: text('title').notNull(),
    body: text('body').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.documentId, t.languageCode] }),
    check(
      'legal_document_translations_length',
      sql`char_length(${t.title}) between 1 and 200 and char_length(${t.body}) between 1 and 100000`,
    ),
  ],
);

/**
 * Outbox of user-facing messages, rendered in the recipient's language at enqueue time. Delivery
 * workers (FCM / email / SMS providers) read PENDING rows; `language_code` records what was sent.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    channel: text('channel').notNull(),
    languageCode: text('language_code')
      .notNull()
      .references(() => languages.code, { onUpdate: 'cascade', onDelete: 'restrict' }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    params: jsonb('params')
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: text('status').notNull().default('PENDING'),
    createdAt: createdAt(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    /** In-app inbox only: when the user opened it. */
    readAt: timestamp('read_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    lastError: text('last_error'),
  },
  (t) => [
    check('notifications_type_valid', oneOf(t.type, NOTIFICATION_TYPES)),
    check('notifications_channel_valid', oneOf(t.channel, NOTIFICATION_CHANNELS)),
    check('notifications_status_valid', oneOf(t.status, ['PENDING', 'SENT', 'FAILED'])),
    index('notifications_pending_idx')
      .on(t.channel, t.createdAt)
      .where(sql`${t.status} = 'PENDING'`),
    index('notifications_user_idx').on(t.userId, t.createdAt),
  ],
);

/** A player's place in a match. One row per (match, user); re-applying reactivates it. */
export const matchRegistrations = pgTable(
  'match_registrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    matchId: uuid('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('APPLIED'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('match_registrations_status_valid', oneOf(t.status, REGISTRATION_STATUSES)),
    unique('match_registrations_match_user_key').on(t.matchId, t.userId),
    index('match_registrations_user_idx').on(t.userId, t.createdAt),
    index('match_registrations_match_status_idx').on(t.matchId, t.status),
  ],
);

/**
 * Bank-transfer payment for a registration (absent for free matches). Receipts are stored outside
 * the database; only an opaque key is kept here.
 */
export const registrationPayments = pgTable(
  'registration_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    registrationId: uuid('registration_id')
      .notNull()
      .unique()
      .references(() => matchRegistrations.id, { onDelete: 'cascade' }),
    amountKrw: integer('amount_krw').notNull(),
    status: text('status').notNull().default('AWAITING_PAYMENT'),
    /** An unpaid seat is released after this time. */
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    receiptKey: text('receipt_key'),
    receiptContentType: text('receipt_content_type'),
    receiptUploadedAt: timestamp('receipt_uploaded_at', { withTimezone: true }),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    rejectReason: text('reject_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('registration_payments_status_valid', oneOf(t.status, PAYMENT_STATUSES)),
    check(
      'registration_payments_reason_valid',
      sql`${t.rejectReason} is null or ${oneOf(t.rejectReason, PAYMENT_REJECT_REASONS)}`,
    ),
    check('registration_payments_amount_positive', sql`${t.amountKrw} > 0`),
    index('registration_payments_status_idx').on(t.status, t.createdAt),
  ],
);

/**
 * Append-only financial audit trail. Rows are never updated or deleted, and deliberately have no
 * foreign key to registrations so the history survives cleanup of the registration itself.
 */
export const paymentEvents = pgTable(
  'payment_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    registrationId: uuid('registration_id').notNull(),
    /** Who acted. NULL for system actions (expiry, automatic bank matching). */
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    event: text('event').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    amountKrw: integer('amount_krw'),
    detail: jsonb('detail')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    check('payment_events_event_valid', oneOf(t.event, PAYMENT_EVENT_TYPES)),
    index('payment_events_registration_idx').on(t.registrationId, t.createdAt),
  ],
);

/**
 * How a user proves who they are. One row per (provider, subject); a user may have several, so a
 * second sign-in method (Kakao, phone) can be added without touching `users`.
 */
export const userIdentities = pgTable(
  'user_identities',
  {
    provider: text('provider').notNull(),
    /** Provider-side id, e.g. the Telegram user id. */
    subject: text('subject').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.subject] }),
    check('user_identities_provider_valid', oneOf(t.provider, IDENTITY_PROVIDERS)),
    index('user_identities_user_idx').on(t.userId),
  ],
);

/** Server-side sessions: a token is only valid while its session exists and is not revoked. */
export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('auth_sessions_user_idx').on(t.userId)],
);

/** Telegram login payloads already accepted; a replayed payload is rejected. */
export const telegramLoginReplays = pgTable(
  'telegram_login_replays',
  {
    telegramUserId: text('telegram_user_id').notNull(),
    authDate: integer('auth_date').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.telegramUserId, t.authDate] })],
);
