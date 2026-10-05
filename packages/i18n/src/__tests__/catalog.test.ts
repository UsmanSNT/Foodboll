import { IntlMessageFormat } from 'intl-messageformat';
import { describe, expect, it } from 'vitest';
import { CATALOGS } from '../catalog';
import { GLOSSARY, GLOSSARY_TERM_IDS } from '../glossary';
import { LOCALE_CODES, LOCALES } from '../locales';
import { createTranslator, hasMessage, rawMessage } from '../messages';

function flatten(node: object, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${name}` : name;
    if (typeof value === 'string') out.set(path, value);
    else for (const [k, v] of flatten(value as object, path)) out.set(k, v);
  }
  return out;
}

const flat = Object.fromEntries(LOCALE_CODES.map((code) => [code, flatten(CATALOGS[code])]));

// ICU AST element types that reference an argument: argument, number, date, time, select, plural.
interface AstElement {
  type: number;
  value?: string;
  options?: Record<string, { value: AstElement[] }>;
}
function collectArguments(elements: AstElement[], out: Set<string>): Set<string> {
  for (const element of elements) {
    if (element.type >= 1 && element.type <= 6 && element.value) out.add(element.value);
    for (const option of Object.values(element.options ?? {})) collectArguments(option.value, out);
  }
  return out;
}
const placeholders = (message: string, code: (typeof LOCALE_CODES)[number]) =>
  [
    ...collectArguments(
      new IntlMessageFormat(message, LOCALES[code].intlTag).getAst() as unknown as AstElement[],
      new Set(),
    ),
  ].sort();

describe('message catalogs', () => {
  it.each(LOCALE_CODES)('%s has exactly the same keys as every other locale', (code) => {
    const reference = [...(flat[LOCALE_CODES[0]]?.keys() ?? [])].sort();
    expect([...(flat[code]?.keys() ?? [])].sort()).toEqual(reference);
  });

  it.each(LOCALE_CODES)(
    '%s: every message is non-empty, valid ICU and has no ASCII apostrophe',
    (code) => {
      for (const [key, message] of flat[code] ?? []) {
        expect(message.trim(), key).not.toBe('');
        expect(message, `${key} contains ASCII apostrophe`).not.toContain("'");
        expect(() => new IntlMessageFormat(message, LOCALES[code].intlTag), key).not.toThrow();
      }
    },
  );

  it('uses the same placeholders in every locale', () => {
    for (const key of flat.ko?.keys() ?? []) {
      const expected = placeholders(flat.ko?.get(key) ?? '', 'ko');
      for (const code of LOCALE_CODES) {
        expect(placeholders(flat[code]?.get(key) ?? '', code), `${code}:${key}`).toEqual(expected);
      }
    }
  });

  it('translates the product examples exactly', () => {
    const ko = createTranslator('ko').t;
    const uz = createTranslator('uz').t;
    expect([ko('language.select'), uz('language.select')]).toEqual(['언어 선택', 'Tilni tanlang']);
    expect([ko('match.apply'), uz('match.apply')]).toEqual(['매치 신청', 'Matchga yozilish']);
    expect([ko('payment.pending'), uz('payment.pending')]).toEqual([
      '입금 확인 중',
      'To‘lov tekshirilmoqda',
    ]);
    expect([ko('payment.uploadReceipt'), uz('payment.uploadReceipt')]).toEqual([
      '입금 영수증 업로드',
      'To‘lov chekini yuklash',
    ]);
    expect([ko('match.confirmed'), uz('match.confirmed')]).toEqual([
      '참가 확정',
      'Ishtirok tasdiqlandi',
    ]);
    expect([
      ko('notification.paymentConfirmed.body'),
      uz('notification.paymentConfirmed.body'),
    ]).toEqual(['입금이 확인되었습니다.', 'To‘lovingiz tasdiqlandi.']);
    expect([
      ko('notification.participationConfirmed.body'),
      uz('notification.participationConfirmed.body'),
    ]).toEqual(['매치 참가가 확정되었습니다.', 'Matchdagi ishtirokingiz tasdiqlandi.']);
  });

  it('keeps shared terms consistent with the glossary', () => {
    for (const code of LOCALE_CODES) {
      const { t } = createTranslator(code);
      expect(t('match.confirmed')).toBe(GLOSSARY.confirmed[code]);
      expect(t('match.cancelled')).toBe(GLOSSARY.cancelled[code]);
      expect(t('stats.rating')).toBe(GLOSSARY.rating[code]);
      expect(t('stats.title')).toBe(GLOSSARY.statistics[code]);
      expect(t('stats.level')).toBe(GLOSSARY.level[code]);
      expect(t('stats.experience')).toBe(GLOSSARY.experience[code]);
      expect(t('stats.achievements')).toBe(GLOSSARY.achievement[code]);
    }
  });
});

describe('glossary', () => {
  it('has a non-empty term for every locale', () => {
    for (const id of GLOSSARY_TERM_IDS) {
      for (const code of LOCALE_CODES) {
        expect(GLOSSARY[id][code].trim(), `${id}:${code}`).not.toBe('');
      }
    }
  });

  it('is exposed through the catalog under glossary.*', () => {
    expect(createTranslator('uz').t('glossary.player')).toBe('Futbolchi');
    expect(createTranslator('ko').t('glossary.paymentReceipt')).toBe('입금 영수증');
  });
});

describe('translator', () => {
  it('interpolates parameters per locale', () => {
    expect(createTranslator('ko').t('match.formatValue', { size: 5 })).toBe('5v5');
    expect(createTranslator('uz').t('match.formatValue', { size: 5 })).toBe('5x5');
    expect(createTranslator('uz').t('stats.levelValue', { level: 3 })).toBe('3-daraja');
  });

  it('does not throw on missing parameters and reports the error', () => {
    const errors: unknown[] = [];
    const { t } = createTranslator('ko', { onError: (e) => errors.push(e) });
    expect(t('form.tooLong')).toBe('{max}자 이하로 입력해주세요.');
    expect(errors).toHaveLength(1);
  });

  it('guards dynamic keys', () => {
    expect(hasMessage('errors.MATCH_NOT_FOUND')).toBe(true);
    expect(hasMessage('errors.NOPE')).toBe(false);
    expect(rawMessage('uz', 'match.apply')).toBe('Matchga yozilish');
  });
});
