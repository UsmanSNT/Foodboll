/** Mirror the limits of the shared schemas (limits.test.ts keeps them in step). */
export const PAYMENT_LIMITS = {
  accountNumber: 64,
  accountHolder: 100,
  bankName: 100,
  instructions: 2000,
} as const;

export const LEGAL_LIMITS = {
  title: 200,
  body: 100_000,
} as const;
