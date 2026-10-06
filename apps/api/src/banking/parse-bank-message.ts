/**
 * Conservative parser for Korean bank "deposit received" notifications (SMS / app alerts).
 *
 * Bank messages have no common format, so this extracts only what matching needs and is built to
 * fail SAFE: anything unclear returns IGNORED (or a deposit without a name), and the matching
 * engine then sends it to a human instead of confirming a payment. It must be validated against
 * real messages from the receiving account's bank before it is trusted (see docs/payments.md).
 */

export interface ParsedDeposit {
  readonly kind: 'DEPOSIT';
  readonly amountKrw: number;
  readonly balanceKrw: number | null;
  /** Date/time printed in the message (Korean time). Banks print no year. */
  readonly occurredAt: {
    readonly month: number;
    readonly day: number;
    readonly hour: number;
    readonly minute: number;
  } | null;
  /**
   * What is left of the message after removing the amount, balance, date/time, masked account
   * numbers, bank tags and filler words. Contains the sender's name and any memo they typed.
   */
  readonly residual: string;
}

export type IgnoredReason =
  'NOT_A_DEPOSIT' | 'WITHDRAWAL' | 'NO_AMOUNT' | 'AMBIGUOUS_AMOUNT' | 'EMPTY';

export type ParseResult =
  ParsedDeposit | { readonly kind: 'IGNORED'; readonly reason: IgnoredReason };

const MAX_AMOUNT_KRW = 100_000_000;

/** Bank names that cannot be a person's name. */
const BANK_WORDS = [
  '국민은행',
  '신한은행',
  '우리은행',
  '하나은행',
  '농협은행',
  'NH농협',
  'KB국민',
  '농협',
  '기업은행',
  '카카오뱅크',
  '토스뱅크',
  '케이뱅크',
  '새마을금고',
  '우체국',
  '수협',
  '신협',
  '부산은행',
  '대구은행',
  '경남은행',
  '광주은행',
  '전북은행',
  '제주은행',
  'SC제일은행',
  '씨티은행',
];
/** Short bank abbreviations that are also common given names (하나) or syllables (우리). */
const AMBIGUOUS_BANK_WORDS = ['국민', '신한', '우리', '하나', 'NH', 'KB', 'IBK'];

/** Whole tokens that carry no identifying information. Matched exactly: Korean names contain
 * the same syllables (이, 원, 하나...), so substring removal would corrupt them. */
const FILLER_TOKEN =
  /^(입금\S*|잔액\S*|계좌\S*|전자금융|알림|Web발신|국외발신|광고|은행|원|이|가|을|를|SMS)$/;
const BANK_TOKEN = new RegExp(`^(${BANK_WORDS.join('|')})$`);

export function normalizeMessage(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[​-‍⁠﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000);
}

const toInt = (digits: string): number => Number(digits.replaceAll(',', ''));

export function parseBankMessage(raw: string): ParseResult {
  let text = normalizeMessage(raw);
  if (!text) return { kind: 'IGNORED', reason: 'EMPTY' };

  // Withdrawals, card payments and cancellations are never deposits. When in doubt, ignore:
  // a missed deposit costs a human a click; a wrong confirmation costs money.
  if (/(출금|지출|결제|승인|취소|환불)/.test(text))
    return { kind: 'IGNORED', reason: 'WITHDRAWAL' };
  if (!text.includes('입금') || /입금\s*(예정|요청|안내|대기|기한|마감)/.test(text)) {
    return { kind: 'IGNORED', reason: 'NOT_A_DEPOSIT' };
  }

  // Date and time ("04/12 15:30", "2026.04.12 15:30:10", "15:30").
  let occurredAt: ParsedDeposit['occurredAt'] = null;
  const dateTime =
    /(?:\d{4}[./-])?(\d{1,2})[./-](\d{1,2})\s*(\d{1,2}):(\d{2})(?::\d{2})?/.exec(text) ?? null;
  if (dateTime) {
    const [, month, day, hour, minute] = dateTime.map(Number) as [
      number,
      number,
      number,
      number,
      number,
    ];
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && hour <= 23 && minute <= 59) {
      occurredAt = { month, day, hour, minute };
    }
    text = text.replace(dateTime[0], ' ');
  }
  text = text
    .replace(/\d{4}[./-]\d{1,2}[./-]\d{1,2}/g, ' ')
    .replace(/\d{1,2}[./]\d{1,2}(?!\d)/g, ' ')
    .replace(/\d{1,2}:\d{2}(?::\d{2})?/g, ' ');

  // Balance ("잔액 1,234,567원"): removed so it is never mistaken for the amount.
  let balanceKrw: number | null = null;
  const balance = /잔액\s*:?\s*([\d,]+)\s*원?/.exec(text);
  if (balance?.[1]) {
    balanceKrw = toInt(balance[1]);
    text = text.replace(balance[0], ' ');
  }

  // Masked / hyphenated account numbers ("110-***-123456", "123456**789", "3333-**-1234567").
  text = text
    .replace(/[\d*]+(?:-[\d*]+)+/g, ' ')
    .replace(/\d*\*+\d*/g, ' ')
    .replace(/(?<!\d)\d{10,}(?!\d)/g, ' ');

  // The amount is the number tied to the word 입금 ("입금 10,000원", "10,000원 입금", "입금액 10,000").
  const patterns = [
    /입금\s*(?:금액|액)?\s*:?\s*([\d,]+)\s*원?/g,
    /([\d,]+)\s*원\s*(?:을|이|가)?\s*입금/g,
  ];
  const found = new Map<number, string>();
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const digits = match[1] ?? '';
      if (!/\d/.test(digits)) continue;
      const amount = toInt(digits);
      if (Number.isSafeInteger(amount) && amount > 0 && amount <= MAX_AMOUNT_KRW) {
        found.set(amount, match[0]);
      }
    }
  }
  if (found.size === 0) return { kind: 'IGNORED', reason: 'NO_AMOUNT' };
  if (found.size > 1) return { kind: 'IGNORED', reason: 'AMBIGUOUS_AMOUNT' };
  const [[amountKrw, matched]] = [...found.entries()] as [[number, string]];
  text = text.replace(matched, ' ');

  const tokens = text
    .replace(/\[[^\]]*\]|【[^】]*】/g, ' ')
    .replace(/[,:;()→▶>*]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    // "홍길동님이" -> "홍길동": strip the honorific + particle, never the name's own syllables.
    .map((token) => (token.length > 2 ? token.replace(/님(이|은|께서)?$/u, '') : token))
    .filter((token) => token && !FILLER_TOKEN.test(token) && !BANK_TOKEN.test(token));
  // "하나" may be the bank or a person; drop it only when something else remains to be the name.
  const isAmbiguousBank = (token: string) => AMBIGUOUS_BANK_WORDS.includes(token);
  const residual = (
    tokens.some((t) => !isAmbiguousBank(t)) ? tokens.filter((t) => !isAmbiguousBank(t)) : tokens
  ).join(' ');

  return { kind: 'DEPOSIT', amountKrw, balanceKrw, occurredAt, residual };
}

/** Name comparison ignores case, spacing, punctuation and a trailing honorific. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKC')
    .toUpperCase()
    .replace(/님$/u, '')
    .replace(/[\s.,·_\-()[\]]/g, '');
}

/** True when the 4-digit reference code appears as its own number (not inside a longer number). */
export function containsReference(residual: string, code: string): boolean {
  return new RegExp(`(?<!\\d)${code}(?!\\d)`).test(residual);
}

/** True when the declared depositor name appears in the message (names under 3 chars are too weak). */
export function containsName(residual: string, depositorName: string): boolean {
  const name = normalizeName(depositorName);
  return name.length >= 3 && normalizeName(residual).includes(name);
}
