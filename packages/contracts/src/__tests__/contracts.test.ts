import { hasMessage, LOCALE_CODES } from '@foodboll/i18n';
import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  errorMessageKey,
  LEGAL_DOCUMENT_LABEL_KEY,
  LEGAL_DOCUMENT_TYPES,
  matchInputSchema,
  NOTIFICATION_MESSAGE_KEYS,
  NOTIFICATION_TYPES,
  PAYMENT_REJECT_REASON_LABEL_KEY,
  PAYMENT_REJECT_REASONS,
  paymentInstructionInputSchema,
  PAYMENT_STATUS_LABEL_KEY,
  PAYMENT_STATUSES,
  REGISTRATION_STATUS_LABEL_KEY,
  REGISTRATION_STATUSES,
  updateLanguageInputSchema,
} from '../index';

describe('enum label keys', () => {
  it('map every technical value to an existing catalog key', () => {
    for (const status of PAYMENT_STATUSES)
      expect(hasMessage(PAYMENT_STATUS_LABEL_KEY[status])).toBe(true);
    for (const s of REGISTRATION_STATUSES)
      expect(hasMessage(REGISTRATION_STATUS_LABEL_KEY[s])).toBe(true);
    for (const t of LEGAL_DOCUMENT_TYPES)
      expect(hasMessage(LEGAL_DOCUMENT_LABEL_KEY[t])).toBe(true);
    for (const r of PAYMENT_REJECT_REASONS)
      expect(hasMessage(PAYMENT_REJECT_REASON_LABEL_KEY[r])).toBe(true);
    for (const t of NOTIFICATION_TYPES) {
      expect(hasMessage(NOTIFICATION_MESSAGE_KEYS[t].title)).toBe(true);
      expect(hasMessage(NOTIFICATION_MESSAGE_KEYS[t].body)).toBe(true);
    }
  });

  it('keeps the database value out of user-facing labels', () => {
    expect(PAYMENT_STATUS_LABEL_KEY.PAYMENT_REVIEW).toBe('payment.pending');
  });

  it('has a localized message for every error code', () => {
    for (const code of ERROR_CODES) expect(hasMessage(errorMessageKey(code))).toBe(true);
  });
});

describe('matchInputSchema', () => {
  const base = {
    sourceLanguage: 'ko',
    startsAt: '2026-11-01T10:00:00+09:00',
    playersPerSide: 5,
    feeKrw: 10000,
  };

  it('accepts a Korean-only match and nulls blank optional fields', () => {
    const parsed = matchInputSchema.parse({
      ...base,
      translations: { ko: { title: '  서울 풋살장 5v5 매치 ', description: '   ' } },
    });
    expect(parsed.translations.ko).toEqual({
      title: '서울 풋살장 5v5 매치',
      description: null,
      rules: null,
      locationInstructions: null,
      equipmentRequirements: null,
      cancellationPolicy: null,
    });
  });

  it('normalizes decomposed Hangul to NFC', () => {
    const decomposed = '매치'.normalize('NFD');
    expect(decomposed).not.toBe('매치');
    const parsed = matchInputSchema.parse({ ...base, translations: { ko: { title: decomposed } } });
    expect(parsed.translations.ko?.title).toBe('매치');
  });

  it.each([
    ['unknown language', { translations: { en: { title: 'x' } } }],
    ['no translations', { translations: {} }],
    ['empty title', { translations: { ko: { title: '  ' } } }],
    ['NUL byte', { translations: { ko: { title: 'a\u0000b' } } }],
    ['unknown field', { translations: { ko: { title: 'x', nationality: 'UZ' } } }],
    ['bad team size', { playersPerSide: 2, translations: { ko: { title: 'x' } } }],
  ])('rejects %s', (_name, patch) => {
    expect(matchInputSchema.safeParse({ ...base, ...patch }).success).toBe(false);
  });
});

describe('paymentInstructionInputSchema', () => {
  it('accepts the Korean and Uzbek example', () => {
    const parsed = paymentInstructionInputSchema.parse({
      accountNumber: '123-456-789012',
      accountHolder: 'FOOTBALL TEAM',
      translations: {
        ko: { bankName: '국민은행', instructions: '입금 후 영수증을 업로드해주세요.' },
        uz: {
          bankName: 'Kookmin Bank',
          instructions: 'To‘lovni amalga oshirgandan so‘ng chekni yuklang.',
        },
      },
    });
    expect(Object.keys(parsed.translations).sort()).toEqual([...LOCALE_CODES].sort());
  });

  it('rejects account numbers with unexpected characters', () => {
    const result = paymentInstructionInputSchema.safeParse({
      accountNumber: '123; DROP TABLE',
      accountHolder: 'X',
      translations: { ko: { bankName: 'a', instructions: 'b' } },
    });
    expect(result.success).toBe(false);
  });
});

describe('updateLanguageInputSchema', () => {
  it('requires at least one field and validates values', () => {
    expect(updateLanguageInputSchema.safeParse({}).success).toBe(false);
    expect(updateLanguageInputSchema.safeParse({ preferredLanguage: 'en' }).success).toBe(false);
    expect(updateLanguageInputSchema.safeParse({ deviceLocale: 'uz-Latn-UZ' }).success).toBe(true);
    expect(updateLanguageInputSchema.safeParse({ deviceLocale: '<script>' }).success).toBe(false);
    expect(
      updateLanguageInputSchema.safeParse({ preferredLanguage: 'uz', nationality: 'UZ' }).success,
    ).toBe(false);
  });
});
