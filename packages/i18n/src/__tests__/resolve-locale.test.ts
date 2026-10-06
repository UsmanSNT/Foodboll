import { describe, expect, it } from 'vitest';
import {
  detectLocale,
  matchLocale,
  parseAcceptLanguage,
  planLanguageSync,
  resolveLocale,
} from '../resolve-locale';

describe('matchLocale', () => {
  it.each([
    ['ko', 'ko'],
    ['ko-KR', 'ko'],
    ['ko_KR', 'ko'],
    ['KO', 'ko'],
    ['uz', 'uz'],
    ['uz-UZ', 'uz'],
    ['uz-Latn-UZ', 'uz'],
    ['uz-Cyrl-UZ', 'uz'],
    ['en', 'en'],
    ['en-US', 'en'],
    ['en_GB', 'en'],
    ['EN-au', 'en'],
  ])('%s -> %s', (tag, expected) => expect(matchLocale(tag)).toBe(expected));

  it.each(['ru', 'zh-Hans', 'vi-VN', '', '*', 'kok', 'eng'])('%j is unsupported', (tag) =>
    expect(matchLocale(tag)).toBeNull(),
  );
});

describe('detectLocale', () => {
  it('returns the first supported language in preference order', () => {
    expect(detectLocale(['ru-RU', 'uz-UZ', 'ko-KR'])).toBe('uz');
    expect(detectLocale(['ko-KR', 'uz-UZ'])).toBe('ko');
    expect(detectLocale(['en-US', 'uz-UZ', 'ko-KR'])).toBe('en');
  });
  it('returns null when nothing is supported', () => {
    expect(detectLocale(['ru-RU', 'vi-VN'])).toBeNull();
    expect(detectLocale([])).toBeNull();
  });
});

describe('parseAcceptLanguage', () => {
  it('orders by quality and keeps header order for ties', () => {
    expect(parseAcceptLanguage('en;q=0.5, uz-UZ, ko;q=0.9, ru')).toEqual([
      'uz-UZ',
      'ru',
      'ko',
      'en',
    ]);
  });
  it('drops q=0, malformed tags and invalid q values', () => {
    expect(parseAcceptLanguage('ko;q=0, <script>, uz;q=abc, ko-KR')).toEqual(['ko-KR']);
  });
  it('handles empty input', () => {
    expect(parseAcceptLanguage(undefined)).toEqual([]);
    expect(parseAcceptLanguage('')).toEqual([]);
  });
  it('bounds work on hostile input', () => {
    const header = Array.from({ length: 5000 }, (_, i) => `x${i}`).join(',');
    expect(parseAcceptLanguage(header).length).toBeLessThanOrEqual(32);
  });
});

describe('resolveLocale', () => {
  it('prefers the account language and does not require selection', () => {
    expect(resolveLocale({ account: 'uz', stored: 'ko', deviceLanguages: ['ko-KR'] })).toEqual({
      locale: 'uz',
      source: 'account',
      requiresSelection: false,
    });
    expect(resolveLocale({ account: 'en', stored: 'ko', deviceLanguages: ['ko-KR'] })).toEqual({
      locale: 'en',
      source: 'account',
      requiresSelection: false,
    });
  });
  it('uses the stored choice when signed out', () => {
    expect(resolveLocale({ stored: 'uz', deviceLanguages: ['ko-KR'] })).toEqual({
      locale: 'uz',
      source: 'stored',
      requiresSelection: false,
    });
  });
  it('detects the device language but still requires an explicit selection', () => {
    expect(resolveLocale({ deviceLanguages: ['uz-UZ'] })).toEqual({
      locale: 'uz',
      source: 'device',
      requiresSelection: true,
    });
    expect(resolveLocale({ deviceLanguages: ['ko-KR'] }).locale).toBe('ko');
    expect(resolveLocale({ deviceLanguages: ['en-US'] })).toEqual({
      locale: 'en',
      source: 'device',
      requiresSelection: true,
    });
  });
  it('falls back to Korean and requires selection for other languages', () => {
    expect(resolveLocale({ deviceLanguages: ['ru-RU'] })).toEqual({
      locale: 'ko',
      source: 'default',
      requiresSelection: true,
    });
  });
  it('ignores invalid stored values', () => {
    expect(resolveLocale({ account: 'xx', stored: 'yy', deviceLanguages: [] }).source).toBe(
      'default',
    );
  });
});

describe('planLanguageSync', () => {
  it('pushes the device choice to an account with no preference', () => {
    expect(planLanguageSync({ account: null, stored: 'uz' })).toEqual({
      type: 'pushToAccount',
      locale: 'uz',
    });
  });
  it('lets the account win on conflict', () => {
    expect(planLanguageSync({ account: 'ko', stored: 'uz' })).toEqual({
      type: 'adoptAccount',
      locale: 'ko',
    });
    expect(planLanguageSync({ account: 'en', stored: 'ko' })).toEqual({
      type: 'adoptAccount',
      locale: 'en',
    });
  });
  it('does nothing when already in sync or when nothing is chosen', () => {
    expect(planLanguageSync({ account: 'ko', stored: 'ko' })).toEqual({ type: 'none' });
    expect(planLanguageSync({ account: null, stored: null })).toEqual({ type: 'none' });
  });
});
