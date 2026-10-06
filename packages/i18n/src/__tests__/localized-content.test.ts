import { describe, expect, it } from 'vitest';
import { formatDateTime, formatKrw } from '../format';
import { missingLocales, pickLocalized } from '../localized-content';

describe('pickLocalized', () => {
  it('returns the reader language when present', () => {
    expect(
      pickLocalized({ ko: '서울 풋살장 5v5 매치', uz: 'Seul futzal maydonida 5x5 match' }, 'uz'),
    ).toEqual({
      text: 'Seul futzal maydonida 5x5 match',
      locale: 'uz',
      isFallback: false,
    });
  });

  it('shows the Korean original to Uzbek readers when only Korean exists', () => {
    expect(pickLocalized({ ko: '서울 풋살장 5v5 매치' }, 'uz')).toEqual({
      text: '서울 풋살장 5v5 매치',
      locale: 'ko',
      isFallback: true,
    });
  });

  it('prefers the source language over the product default', () => {
    const content = { ko: '한국어', uz: 'Uzbekcha' };
    expect(pickLocalized({ uz: content.uz }, 'ko', 'uz')?.locale).toBe('uz');
    expect(pickLocalized({ ko: content.ko, uz: content.uz }, 'ko', 'uz')?.locale).toBe('ko');
  });

  it('treats blank translations as missing', () => {
    expect(pickLocalized({ ko: '원문', uz: '   ' }, 'uz')?.locale).toBe('ko');
    expect(pickLocalized({ ko: '', uz: null }, 'uz')).toBeNull();
  });

  it('falls back to any available language as a last resort', () => {
    expect(pickLocalized({ uz: 'Faqat o‘zbekcha' }, 'ko')).toEqual({
      text: 'Faqat o‘zbekcha',
      locale: 'uz',
      isFallback: true,
    });
  });
});

describe('missingLocales', () => {
  it('lists locales without usable text', () => {
    expect(missingLocales({ ko: '입금 계좌' })).toEqual(['uz', 'en']);
    expect(missingLocales({ ko: 'a', uz: 'b' })).toEqual(['en']);
    expect(missingLocales({ ko: 'a', uz: 'b', en: 'c' })).toEqual([]);
    expect(missingLocales({ ko: ' ', uz: 'b', en: 'c' })).toEqual(['ko']);
  });
});

describe('formatting', () => {
  it('has a name for every weekday and month in every language', () => {
    const words = { ko: new Set<string>(), uz: new Set<string>(), en: new Set<string>() };
    for (let day = 0; day < 366; day++) {
      for (const code of ['ko', 'uz', 'en'] as const) {
        const text = formatDateTime(code, Date.UTC(2026, 0, 1 + day, 12));
        expect(text, `${code} day ${day}`).not.toMatch(/\(\)|, ,|undefined|NaN/);
        const found =
          code === 'ko'
            ? text.match(/\((.)\)/g)
            : code === 'uz'
              ? text.match(/[a-z]+/g)
              : text.match(/[A-Za-z]+/g);
        for (const word of found ?? []) words[code].add(word);
      }
    }
    expect(words.ko.size).toBe(7);
    expect(words.uz.size).toBe(12 + 7);
    expect(words.en.size).toBe(12 + 7);
  });

  it('renders dates in Korean time regardless of the host time zone', () => {
    // 2026-03-01T15:00:00Z is 2026-03-02 00:00 in Seoul (UTC+9, no DST); 2 March 2026 is a Monday.
    expect(formatDateTime('ko', '2026-03-01T15:00:00Z')).toBe('2026년 3월 2일(월) 00:00');
    expect(formatDateTime('uz', '2026-03-01T15:00:00Z')).toBe('2-mart 2026, dushanba, 00:00');
    expect(formatDateTime('en', '2026-03-01T15:00:00Z')).toBe('Mon, Mar 2, 2026 · 00:00');
  });

  it('uses a 24-hour clock in English', () => {
    // 2026-12-31T14:05:00Z is 2026-12-31 23:05 in Seoul; 31 December 2026 is a Thursday.
    expect(formatDateTime('en', '2026-12-31T14:05:00Z')).toBe('Thu, Dec 31, 2026 · 23:05');
  });

  it('formats KRW without decimals', () => {
    expect(formatKrw('ko', 10000)).toBe('10,000원');
    expect(formatKrw('uz', 10000)).toBe('₩10,000');
    expect(formatKrw('en', 10000)).toBe('₩10,000');
  });
});
