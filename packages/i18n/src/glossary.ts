import { LOCALE_CODES, type LocaleCode } from './locales';

export interface GlossaryEntry extends Readonly<Record<LocaleCode, string>> {
  /** Guidance for translators; never shown to users. */
  readonly note?: string;
}

/**
 * Shared football terminology. Every translator and every UI string must use these terms so the
 * product speaks one vocabulary. These are natural-language choices, not word-for-word
 * translations: Korean and Uzbek football communities each have established wording.
 *
 * Because the type is `Record<LocaleCode, string>`, adding a locale fails to compile until every
 * term has a translation.
 */
export const GLOSSARY = {
  match: { ko: '매치', uz: 'Match', note: 'Uzbek players use the loanword “match”.' },
  player: { ko: '선수', uz: 'Futbolchi' },
  team: { ko: '팀', uz: 'Jamoa' },
  manager: { ko: '매니저', uz: 'Menejer' },
  rating: { ko: '평점', uz: 'Reyting' },
  statistics: { ko: '기록', uz: 'Statistika' },
  level: { ko: '레벨', uz: 'Daraja' },
  experience: { ko: '경험치', uz: 'Tajriba balli' },
  achievement: { ko: '업적', uz: 'Yutuqlar' },
  payment: { ko: '입금', uz: 'To‘lov' },
  paymentVerification: { ko: '입금 확인', uz: 'To‘lovni tekshirish' },
  paymentReceipt: { ko: '입금 영수증', uz: 'To‘lov cheki' },
  confirmed: { ko: '참가 확정', uz: 'Ishtirok tasdiqlandi' },
  cancelled: { ko: '취소됨', uz: 'Bekor qilindi' },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryTermId = keyof typeof GLOSSARY;

export const GLOSSARY_TERM_IDS = Object.keys(GLOSSARY) as readonly GlossaryTermId[];

export function glossaryTerm(id: GlossaryTermId, locale: LocaleCode): string {
  return GLOSSARY[id][locale];
}

/** Flat `termId -> text` map for one locale; mounted in the catalog under `glossary.*`. */
export function glossaryMessages(locale: LocaleCode): Record<GlossaryTermId, string> {
  const entries = GLOSSARY_TERM_IDS.map((id) => [id, GLOSSARY[id][locale]] as const);
  return Object.fromEntries(entries) as Record<GlossaryTermId, string>;
}

/** Re-exported so tests can assert every glossary entry covers every locale. */
export const GLOSSARY_LOCALES = LOCALE_CODES;
