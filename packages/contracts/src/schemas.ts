import { LOCALE_CODES } from '@foodboll/i18n';
import { z } from 'zod';
import {
  BANK_DEPOSIT_STATUSES,
  ORGANIZER_APPLICATION_STATUSES,
  PAYMENT_REJECT_REASONS,
  PAYMENT_STATUSES,
  USER_ROLES,
} from './enums';

export const localeCodeSchema = z.enum(LOCALE_CODES);

/**
 * User-authored text: NFC-normalized (macOS keyboards emit decomposed Hangul), trimmed, and free
 * of NUL bytes (PostgreSQL text cannot store them).
 */
const text = (min: number, max: number) =>
  z
    .string()
    .transform((value) => value.normalize('NFC').trim())
    .pipe(
      z
        .string()
        .min(min)
        .max(max)
        .refine((value) => !value.includes('\u0000'), 'NUL byte not allowed'),
    );

/** Optional long-form text; blank means "no translation for this field" and is stored as null. */
const optionalText = (max: number) =>
  text(0, max)
    .transform((value) => (value === '' ? null : value))
    .nullish()
    .transform((value) => value ?? null);

const atLeastOne = <T extends z.ZodType>(value: T) =>
  z.partialRecord(localeCodeSchema, value).refine((record) => Object.keys(record).length > 0, {
    message: 'At least one translation is required',
  });

export const matchTranslationSchema = z.strictObject({
  title: text(1, 200),
  description: optionalText(5000),
  rules: optionalText(5000),
  locationInstructions: optionalText(5000),
  equipmentRequirements: optionalText(5000),
  cancellationPolicy: optionalText(5000),
});
export type MatchTranslationInput = z.output<typeof matchTranslationSchema>;

export const regionCodeSchema = z
  .string()
  .max(60)
  .regex(/^[a-z]+(-[a-z]+)*$/);

const MAX_MATCH_HOURS = 12;

export const matchInputSchema = z
  .strictObject({
    /** Language the organizer wrote the original in; its translation is mandatory. */
    sourceLanguage: localeCodeSchema,
    /** Region (province or district) the match is played in; decides who sees it. */
    regionCode: regionCodeSchema,
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    /** Proper noun, written as the venue is signed locally (usually Korean). Not translated. */
    venueName: text(1, 100),
    venueAddress: optionalText(200),
    playersPerSide: z.number().int().min(3).max(11),
    /** Registration capacity. Defaults to two full sides. */
    maxPlayers: z.number().int().min(6).max(60).optional(),
    translations: atLeastOne(matchTranslationSchema),
  })
  .refine(
    (match) => match.maxPlayers === undefined || match.maxPlayers >= match.playersPerSide * 2,
    {
      message: 'maxPlayers must fit two full sides',
      path: ['maxPlayers'],
    },
  )
  .refine(
    (match) => {
      const span = Date.parse(match.endsAt) - Date.parse(match.startsAt);
      return span > 0 && span <= MAX_MATCH_HOURS * 3600 * 1000;
    },
    { message: `endsAt must be after startsAt, within ${MAX_MATCH_HOURS} hours`, path: ['endsAt'] },
  );
export type MatchInput = z.output<typeof matchInputSchema>;

export const paymentInstructionTranslationSchema = z.strictObject({
  bankName: text(1, 100),
  instructions: text(1, 2000),
});

export const paymentInstructionInputSchema = z.strictObject({
  /** Bank-registered values: identical in every language, so stored once, never translated. */
  accountNumber: text(4, 64).refine((value) => /^[0-9A-Za-z][0-9A-Za-z -]*$/.test(value), {
    message: 'Invalid account number',
  }),
  accountHolder: text(1, 100),
  translations: atLeastOne(paymentInstructionTranslationSchema),
});
export type PaymentInstructionInput = z.output<typeof paymentInstructionInputSchema>;

export const legalDocumentTranslationSchema = z.strictObject({
  title: text(1, 200),
  /** Plain text. Clients must render it as text, never as HTML. */
  body: text(1, 100_000),
});

export const legalDocumentInputSchema = z.strictObject({
  translations: atLeastOne(legalDocumentTranslationSchema),
});
export type LegalDocumentInput = z.output<typeof legalDocumentInputSchema>;

/** BCP 47-ish tag as reported by the device, e.g. `uz-Latn-UZ`. Stored for admin visibility only. */
export const deviceLocaleSchema = z
  .string()
  .max(35)
  .regex(/^[A-Za-z]{2,8}([-_][A-Za-z0-9]{1,8})*$/);

export const updateLanguageInputSchema = z
  .strictObject({
    preferredLanguage: localeCodeSchema.optional(),
    deviceLocale: deviceLocaleSchema.optional(),
  })
  .refine((value) => value.preferredLanguage !== undefined || value.deviceLocale !== undefined, {
    message: 'Provide preferredLanguage and/or deviceLocale',
  });
export type UpdateLanguageInput = z.output<typeof updateLanguageInputSchema>;

export const uuidSchema = z.uuid();

/** A player asks to organize matches in a region. */
export const organizerApplicationInputSchema = z.strictObject({
  regionCode: regionCodeSchema,
  /** Who they are and where they play; helps the reviewer. */
  message: optionalText(500),
});

export const decideApplicationInputSchema = z.strictObject({});

/** Replaces the regions an organizer may publish matches in (empty = no longer an organizer). */
export const setOrganizerRegionsInputSchema = z.strictObject({
  regionCodes: z.array(regionCodeSchema).max(50),
});

/** Organizer's attendance sheet: who actually showed up. Idempotent; can be corrected later. */
export const attendanceInputSchema = z.strictObject({
  marks: z
    .array(z.strictObject({ registrationId: z.uuid(), attended: z.boolean() }))
    .min(1)
    .max(100),
});

/** A bank notification forwarded from the receiving account's phone. */
export const bankNotificationInputSchema = z.strictObject({
  text: z.string().min(1).max(2000),
  /** When the phone received it. Defaults to now. */
  receivedAt: z.iso.datetime({ offset: true }).optional(),
  /** Sending number/name, used to drop messages that are not from the bank. */
  sender: z.string().max(64).optional(),
  /** Id from the forwarding app, makes retries idempotent. */
  messageId: z.string().max(128).optional(),
});
export type BankNotificationInput = z.output<typeof bankNotificationInputSchema>;

export const assignDepositInputSchema = z.strictObject({ registrationId: z.uuid() });

export const depositStatusFilterSchema = z.enum(BANK_DEPOSIT_STATUSES);

/** The name the player's bank shows on a transfer (used when they cannot type a reference). */
export const depositorNameInputSchema = z.strictObject({
  depositorName: text(1, 60).nullable(),
});

/**
 * Payload of the Telegram Login Widget. Fields are exactly those Telegram signs; the widget sends
 * numbers from its JS callback and strings through a redirect, so both are accepted.
 */
const numeric = z.union([z.number().int().nonnegative(), z.string().regex(/^\d{1,20}$/)]);
export const telegramLoginInputSchema = z.strictObject({
  id: numeric,
  first_name: z.string().max(256).optional(),
  last_name: z.string().max(256).optional(),
  username: z.string().max(64).optional(),
  photo_url: z.string().max(512).optional(),
  auth_date: numeric,
  hash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type TelegramLoginInput = z.output<typeof telegramLoginInputSchema>;

/** Development-only sign-in (disabled in production by configuration). */
export const devLoginInputSchema = z.strictObject({
  name: text(1, 60),
  role: z.enum(USER_ROLES).default('PLAYER'),
});

export const markNotificationsReadInputSchema = z.union([
  z.strictObject({ all: z.literal(true) }),
  z.strictObject({ ids: z.array(z.uuid()).min(1).max(100) }),
]);

export const rejectPaymentInputSchema = z.strictObject({
  reason: z.enum(PAYMENT_REJECT_REASONS),
});

export const paymentStatusFilterSchema = z.enum(PAYMENT_STATUSES);

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const regionInputSchema = z.strictObject({
  code: regionCodeSchema,
  /** Parent region code, or null to create a province-level region. */
  parent: regionCodeSchema.nullable(),
  sortOrder: z.number().int().min(0).max(100_000).default(1000),
  names: z.strictObject({
    ko: text(1, 60),
    uz: text(1, 60).optional(),
    en: text(1, 60).optional(),
  }),
});
export type RegionInput = z.output<typeof regionInputSchema>;

export const setHomeRegionInputSchema = z.strictObject({
  regionCode: regionCodeSchema.nullable(),
});

/** `YYYY-MM-DD`, interpreted in Korean time. */
export const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const matchFeedQuerySchema = paginationSchema.extend({
  region: regionCodeSchema.optional(),
  date: dateOnlySchema.optional(),
});

export const playerSearchQuerySchema = paginationSchema.extend({
  /** Matches the start of a display name. */
  q: z
    .string()
    .max(60)
    .transform((value) => value.normalize('NFC').trim())
    .optional(),
  region: regionCodeSchema.optional(),
});

export const applicationStatusFilterSchema = z.enum(ORGANIZER_APPLICATION_STATUSES);
