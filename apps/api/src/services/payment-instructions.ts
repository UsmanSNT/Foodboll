import type {
  AdminPaymentInstructionDto,
  PaymentInstructionDto,
  PaymentInstructionInput,
} from '@foodboll/contracts';
import {
  DEFAULT_LOCALE,
  isLocaleCode,
  LOCALE_CODES,
  missingLocales,
  pickLocalized,
  type LocaleCode,
} from '@foodboll/i18n';
import { desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { paymentInstructions, paymentInstructionTranslations } from '../db/schema';
import { notFound } from '../errors';
import { listEnabledLanguages } from './languages';
import { assertLanguagesEnabled, assertSourceTranslation } from './translations';

/**
 * Publishes new bank details as the active instructions. The previous row is kept (inactive) as
 * history. The advisory lock serializes concurrent admins; the partial unique index is the
 * backstop that guarantees a single active row.
 */
export async function replacePaymentInstructions(
  db: Db,
  adminId: string,
  input: PaymentInstructionInput,
): Promise<string> {
  assertSourceTranslation(input.translations, DEFAULT_LOCALE);
  await assertLanguagesEnabled(db, Object.keys(input.translations));
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('payment_instructions'))`);
    await tx
      .update(paymentInstructions)
      .set({ isActive: false })
      .where(eq(paymentInstructions.isActive, true));
    const [row] = await tx
      .insert(paymentInstructions)
      .values({
        accountNumber: input.accountNumber,
        accountHolder: input.accountHolder,
        isActive: true,
        createdBy: adminId,
      })
      .returning({ id: paymentInstructions.id });
    if (!row) throw new Error('Payment instruction insert returned no row');
    await tx.insert(paymentInstructionTranslations).values(
      LOCALE_CODES.flatMap((code) => {
        const t = input.translations[code];
        return t ? [{ paymentInstructionId: row.id, languageCode: code, ...t }] : [];
      }),
    );
    return row.id;
  });
}

async function loadActive(db: Db) {
  const [row] = await db
    .select()
    .from(paymentInstructions)
    .where(eq(paymentInstructions.isActive, true))
    .orderBy(desc(paymentInstructions.createdAt))
    .limit(1);
  if (!row) throw notFound('PAYMENT_INSTRUCTIONS_NOT_FOUND');
  const translations = await db
    .select()
    .from(paymentInstructionTranslations)
    .where(eq(paymentInstructionTranslations.paymentInstructionId, row.id));
  return { row, translations };
}

export async function getActivePaymentInstruction(
  db: Db,
  locale: LocaleCode,
): Promise<PaymentInstructionDto> {
  const { row, translations } = await loadActive(db);
  const field = (name: 'bankName' | 'instructions') => {
    const text: Partial<Record<LocaleCode, string>> = {};
    for (const t of translations) if (isLocaleCode(t.languageCode)) text[t.languageCode] = t[name];
    const picked = pickLocalized(text, locale, DEFAULT_LOCALE);
    if (!picked) throw new Error(`Payment instruction ${row.id} has no ${name}`);
    return picked;
  };
  return {
    id: row.id,
    bankName: field('bankName'),
    accountNumber: row.accountNumber,
    accountHolder: row.accountHolder,
    instructions: field('instructions'),
  };
}

export async function getActivePaymentInstructionForAdmin(
  db: Db,
): Promise<AdminPaymentInstructionDto> {
  const { row, translations } = await loadActive(db);
  const byLanguage: Partial<Record<LocaleCode, { bankName: string; instructions: string }>> = {};
  for (const t of translations) {
    if (isLocaleCode(t.languageCode)) {
      byLanguage[t.languageCode] = { bankName: t.bankName, instructions: t.instructions };
    }
  }
  const enabled = (await listEnabledLanguages(db)).map((l) => l.code);
  const present: Partial<Record<LocaleCode, string>> = {};
  for (const code of enabled) if (byLanguage[code]) present[code] = byLanguage[code].instructions;
  return {
    id: row.id,
    accountNumber: row.accountNumber,
    accountHolder: row.accountHolder,
    translations: byLanguage,
    missingLanguages: missingLocales(present, enabled),
  };
}
