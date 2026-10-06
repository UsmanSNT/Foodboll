import type { AdminPaymentInstructionDto } from '@foodboll/contracts';
import { describe, expect, it } from 'vitest';
import {
  emptyPaymentLanguages,
  isPaymentDirty,
  paymentDraftFrom,
  playerView,
  validatePaymentDraft,
  withPaymentText,
  type PaymentDraft,
} from './payment-form';

const current: AdminPaymentInstructionDto = {
  id: 'p1',
  accountNumber: '110-123-456789',
  accountHolder: 'FOODBOLL',
  translations: { ko: { bankName: '신한은행', instructions: '입금 코드를 적어주세요.' } },
  missingLanguages: ['uz', 'en'],
};

const filled = (): PaymentDraft => paymentDraftFrom(current);

describe('validatePaymentDraft', () => {
  it('sends only the languages that have text, trimmed', () => {
    const draft = withPaymentText(
      withPaymentText(filled(), 'en', 'bankName', '  Shinhan Bank '),
      'en',
      'instructions',
      'Use your code.',
    );
    const result = validatePaymentDraft(draft);
    expect(result.ok && result.input).toEqual({
      accountNumber: '110-123-456789',
      accountHolder: 'FOODBOLL',
      translations: {
        ko: { bankName: '신한은행', instructions: '입금 코드를 적어주세요.' },
        en: { bankName: 'Shinhan Bank', instructions: 'Use your code.' },
      },
    });
  });

  it('reports every blank required field, starting with the account', () => {
    const result = validatePaymentDraft(paymentDraftFrom(null));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors)).toEqual([
      'accountNumber',
      'accountHolder',
      'translations.ko.bankName',
      'translations.ko.instructions',
    ]);
    expect(result.errors.accountNumber).toEqual({ key: 'form.required' });
    expect(result.first).toBe('accountNumber');
  });

  it('tells a short account number from an invalid one', () => {
    const check = (accountNumber: string) => {
      const result = validatePaymentDraft({ ...filled(), accountNumber });
      return result.ok ? null : result.errors.accountNumber;
    };
    expect(check('ab1')).toEqual({ key: 'adminSettings.errors.tooShort', params: { min: 4 } });
    expect(check('1234; DROP')).toEqual({
      key: 'adminSettings.payment.errors.accountNumberFormat',
    });
    expect(check('-1234')).toEqual({ key: 'adminSettings.payment.errors.accountNumberFormat' });
    expect(check('1'.repeat(65))).toEqual({ key: 'form.tooLong', params: { max: 64 } });
  });

  it('asks for both fields of a half-written optional language, but only for the blank one', () => {
    const result = validatePaymentDraft(
      withPaymentText(filled(), 'uz', 'bankName', 'Shinhan Bank'),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual({
      'translations.uz.instructions': { key: 'adminSettings.errors.languagePartial' },
    });
    expect(result.first).toBe('translations.uz.instructions');
  });

  it('requires Korean even when only another language is written', () => {
    const korean = withPaymentText(
      withPaymentText(filled(), 'ko', 'bankName', ''),
      'ko',
      'instructions',
      '',
    );
    const draft = withPaymentText(
      withPaymentText(korean, 'en', 'bankName', 'Bank'),
      'en',
      'instructions',
      'Pay',
    );
    const result = validatePaymentDraft(draft);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors)).toEqual([
      'translations.ko.bankName',
      'translations.ko.instructions',
    ]);
  });

  it('counts the length after trimming, like the API', () => {
    const padded = withPaymentText(filled(), 'ko', 'instructions', `  ${'x'.repeat(2000)}  `);
    expect(validatePaymentDraft(padded).ok).toBe(true);
    expect(
      validatePaymentDraft(withPaymentText(filled(), 'ko', 'instructions', 'x'.repeat(2001))).ok,
    ).toBe(false);
  });
});

describe('drafts', () => {
  it('lists the languages without text, never counting Korean', () => {
    expect(emptyPaymentLanguages(filled())).toEqual(['uz', 'en']);
    expect(emptyPaymentLanguages(paymentDraftFrom(null))).toEqual(['uz', 'en']);
  });

  it('is only dirty after a real change, not after whitespace', () => {
    const baseline = filled();
    expect(isPaymentDirty(baseline, baseline)).toBe(false);
    expect(isPaymentDirty({ ...baseline, accountHolder: ' FOODBOLL ' }, baseline)).toBe(false);
    expect(isPaymentDirty({ ...baseline, accountHolder: 'FOODBOLL FC' }, baseline)).toBe(true);
  });
});

describe('playerView', () => {
  it('falls back to Korean for a language without text, like the API does for players', () => {
    const view = playerView(current, 'uz');
    expect(view?.bankName).toEqual({ text: '신한은행', locale: 'ko', isFallback: true });
    expect(playerView(current, 'ko')?.instructions.isFallback).toBe(false);
  });
});
