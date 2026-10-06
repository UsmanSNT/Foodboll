import { describe, expect, it } from 'vitest';
import {
  containsName,
  containsReference,
  normalizeName,
  parseBankMessage,
  type ParsedDeposit,
} from '../parse-bank-message';

/**
 * These samples are MODELLED on common Korean bank alerts, not copied from any bank: formats
 * differ by bank and change over time. Replace/extend them with real messages from your own
 * receiving account before relying on automatic confirmation.
 */
const deposit = (text: string) => {
  const result = parseBankMessage(text);
  if (result.kind !== 'DEPOSIT')
    throw new Error(`expected a deposit, got ${JSON.stringify(result)}`);
  return result as ParsedDeposit;
};

describe('parseBankMessage: deposits', () => {
  it('amount before and after the keyword, with balance, date and masked account', () => {
    const a = deposit('[KB]04/12 15:30 123456**789 홍길동 입금 10,000 잔액 1,234,567');
    expect(a).toMatchObject({
      amountKrw: 10_000,
      balanceKrw: 1_234_567,
      occurredAt: { month: 4, day: 12, hour: 15, minute: 30 },
    });
    expect(a.residual).toBe('홍길동');

    const b = deposit('신한 04/12 15:30 110-***-123456 입금 10,000 잔액 1,234,567 KARIMOV AZIZ');
    expect(b).toMatchObject({ amountKrw: 10_000, balanceKrw: 1_234_567 });
    expect(b.residual).toBe('KARIMOV AZIZ');

    const c = deposit('NH농협 입금10,000원 04/12 15:30 351-****-1234-** 박지성 잔액1,234,567원');
    expect(c).toMatchObject({ amountKrw: 10_000, balanceKrw: 1_234_567 });
    expect(c.residual).toBe('박지성');
  });

  it('sentence style ("10,000원을 입금했어요") and year-qualified dates', () => {
    const d = deposit('[카카오뱅크] 홍길동님이 3333-**-1234567 계좌로 10,000원을 입금했어요.');
    expect(d.amountKrw).toBe(10_000);
    expect(d.residual).toContain('홍길동');
    const e = deposit('[하나은행] 2026.12.11 22:05 입금 10,000원 홍길동1234 잔액 55,000원');
    expect(e).toMatchObject({
      amountKrw: 10_000,
      occurredAt: { month: 12, day: 11, hour: 22, minute: 5 },
    });
    expect(e.residual).toBe('홍길동1234');
  });

  it('keeps a typed memo with the reference code in the residual', () => {
    const d = deposit('[우리]04/12 15:30 1002*****123 입금 10,000원 AZIZ4821 잔액 99,000원');
    expect(containsReference(d.residual, '4821')).toBe(true);
    expect(containsReference(d.residual, '482')).toBe(false);
    expect(containsReference(d.residual, '8210')).toBe(false);
  });

  it('is robust to odd spacing, full-width digits and zero-width characters', () => {
    const d = deposit('입금​ １０，０００원\n04/12   15:30  홍길동');
    expect(d.amountKrw).toBe(10_000);
    expect(d.residual).toBe('홍길동');
  });

  it('does not mistake the balance, account number or time for the amount', () => {
    const d = deposit('입금 10,000원 잔액 9,999,999원 110-123-456789 15:30');
    expect(d.amountKrw).toBe(10_000);
    expect(d.balanceKrw).toBe(9_999_999);
  });
});

describe('parseBankMessage: names that look like filler words', () => {
  it.each(['이영희', '원빈', '김하나', '박우리', '가은', '한국인'])('keeps %s intact', (name) => {
    expect(deposit(`[하나은행] 04/12 15:30 입금 10,000원 ${name} 잔액 50,000원`).residual).toBe(
      name,
    );
  });

  it('removes a bank name only when it is a whole word', () => {
    expect(deposit('하나은행 04/12 15:30 입금 10,000원 하나 잔액 5,000').residual).toBe('하나');
    expect(deposit('[국민] 입금 10,000원 국민영 15:30').residual).toBe('국민영');
  });
});

describe('parseBankMessage: things that must NOT be confirmed', () => {
  it.each([
    ['withdrawal', '[KB]04/12 15:30 출금 10,000 잔액 1,224,567', 'WITHDRAWAL'],
    ['card payment', '[신한카드] 승인 10,000원 일시불 스타벅스', 'WITHDRAWAL'],
    [
      'transfer out mentioning the deposit account',
      '출금 10,000원 입금계좌 123-456 홍길동',
      'WITHDRAWAL',
    ],
    ['deposit notice, not a deposit', '[농협] 입금 예정 안내 10,000원', 'NOT_A_DEPOSIT'],
    ['unrelated text', '택배가 도착했습니다. 문 앞에 두었습니다.', 'NOT_A_DEPOSIT'],
    ['marketing', '(광고) 입금하면 이자 3% 혜택! 지금 가입하세요', 'NO_AMOUNT'],
    ['two different amounts', '입금 10,000원 입금 20,000원 홍길동', 'AMBIGUOUS_AMOUNT'],
    ['empty', '   ', 'EMPTY'],
  ])('%s', (_name, text, reason) => {
    expect(parseBankMessage(text)).toEqual({ kind: 'IGNORED', reason });
  });

  it('rejects absurd amounts', () => {
    expect(parseBankMessage('입금 999,999,999,999원 홍길동')).toEqual({
      kind: 'IGNORED',
      reason: 'NO_AMOUNT',
    });
    expect(parseBankMessage('입금 0원 홍길동')).toEqual({ kind: 'IGNORED', reason: 'NO_AMOUNT' });
  });

  it('copes with hostile input without throwing or hanging', () => {
    const nasty = '입금 ' + '1,'.repeat(5000) + '000원 ' + '*'.repeat(5000);
    const started = Date.now();
    expect(() => parseBankMessage(nasty)).not.toThrow();
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe('name matching', () => {
  it('ignores case, spacing, punctuation and honorifics', () => {
    expect(normalizeName(' Karimov  Aziz ')).toBe('KARIMOVAZIZ');
    expect(normalizeName('홍길동님')).toBe('홍길동');
    expect(normalizeName('Karimov-Aziz.')).toBe('KARIMOVAZIZ');
  });

  it('finds a declared name inside the residual, but not very short names', () => {
    expect(containsName('KARIMOV AZIZ', 'karimov aziz')).toBe(true);
    expect(containsName('홍길동 메모', '홍길동')).toBe(true);
    expect(containsName('김', '김')).toBe(false);
    expect(containsName('이영', '이영')).toBe(false);
    expect(containsName('홍길동', '박지성')).toBe(false);
  });
});
