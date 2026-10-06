import { legalDocumentInputSchema, paymentInstructionInputSchema } from '@foodboll/contracts';
import { describe, expect, it } from 'vitest';
import { LEGAL_LIMITS, PAYMENT_LIMITS } from './limits';

const payment = (patch: {
  accountNumber?: string;
  accountHolder?: string;
  bankName?: string;
  instructions?: string;
}) => ({
  accountNumber: patch.accountNumber ?? '1234',
  accountHolder: patch.accountHolder ?? 'FOODBOLL',
  translations: {
    ko: { bankName: patch.bankName ?? 'Bank', instructions: patch.instructions ?? 'Pay' },
  },
});

describe('limits mirrored from the shared schemas', () => {
  it.each(Object.keys(PAYMENT_LIMITS) as (keyof typeof PAYMENT_LIMITS)[])(
    'payment %s accepts its limit and rejects one more',
    (field) => {
      const max = PAYMENT_LIMITS[field];
      const at = field === 'accountNumber' ? '1'.repeat(max) : 'x'.repeat(max);
      expect(paymentInstructionInputSchema.safeParse(payment({ [field]: at })).success).toBe(true);
      expect(paymentInstructionInputSchema.safeParse(payment({ [field]: `${at}1` })).success).toBe(
        false,
      );
    },
  );

  it.each(Object.keys(LEGAL_LIMITS) as (keyof typeof LEGAL_LIMITS)[])(
    'legal %s accepts its limit and rejects one more',
    (field) => {
      const max = LEGAL_LIMITS[field];
      const input = (length: number) => ({
        translations: { ko: { title: 'T', body: 'B', [field]: 'x'.repeat(length) } },
      });
      expect(legalDocumentInputSchema.safeParse(input(max)).success).toBe(true);
      expect(legalDocumentInputSchema.safeParse(input(max + 1)).success).toBe(false);
    },
  );
});
