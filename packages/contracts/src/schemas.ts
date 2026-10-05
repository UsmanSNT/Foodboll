import { LOCALE_CODES } from '@foodboll/i18n';
import { z } from 'zod';
import { PAYMENT_REJECT_REASONS, PAYMENT_STATUSES } from './enums';

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

export const matchInputSchema = z
  .strictObject({
    /** Language the organizer wrote the original in; its translation is mandatory. */
    sourceLanguage: localeCodeSchema,
    startsAt: z.iso.datetime({ offset: true }),
    playersPerSide: z.number().int().min(3).max(11),
    /** Registration capacity. Defaults to two full sides. */
    maxPlayers: z.number().int().min(6).max(60).optional(),
    feeKrw: z.number().int().min(0).max(1_000_000),
    translations: atLeastOne(matchTranslationSchema),
  })
  .refine(
    (match) => match.maxPlayers === undefined || match.maxPlayers >= match.playersPerSide * 2,
    {
      message: 'maxPlayers must fit two full sides',
      path: ['maxPlayers'],
    },
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

export const rejectPaymentInputSchema = z.strictObject({
  reason: z.enum(PAYMENT_REJECT_REASONS),
});

export const paymentStatusFilterSchema = z.enum(PAYMENT_STATUSES);

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
