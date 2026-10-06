import type { MatchTranslationsDto } from '@foodboll/contracts';
import { describe, expect, it } from 'vitest';
import {
  charCount,
  createInitialState,
  hasText,
  isDirty,
  stateFromMatch,
  withClearedLanguage,
  withMaxPlayers,
  withPlayersPerSide,
  withTranslationField,
} from './form-state';

const start = () => createInitialState({ language: 'uz', regionCode: null });

describe('capacity', () => {
  it('follows two full sides until the organizer sets it by hand', () => {
    expect(start()).toMatchObject({ playersPerSide: 6, maxPlayers: 12, maxPlayersTouched: false });
    expect(withPlayersPerSide(start(), 8)).toMatchObject({ playersPerSide: 8, maxPlayers: 16 });
  });

  it('keeps a hand-set capacity but never below two full sides', () => {
    const custom = withMaxPlayers(start(), 20);
    expect(withPlayersPerSide(custom, 8)).toMatchObject({ maxPlayers: 20 });
    expect(withPlayersPerSide(custom, 11)).toMatchObject({ maxPlayers: 22 });
  });
});

describe('translations', () => {
  it('sets one field of one language and clears a whole language', () => {
    const typed = withTranslationField(start(), 'en', 'title', 'Friday futsal');
    expect(typed.translations.en.title).toBe('Friday futsal');
    expect(typed.translations.ko.title).toBe('');
    expect(withClearedLanguage(typed, 'en').translations.en.title).toBe('');
  });

  it('counts a language as provided once any field has text', () => {
    expect(hasText(start().translations.ko)).toBe(false);
    expect(hasText(withTranslationField(start(), 'ko', 'rules', ' no sliding ').translations.ko)).toBe(true);
    expect(hasText(withTranslationField(start(), 'ko', 'rules', '   ').translations.ko)).toBe(false);
  });

  it('counts characters the way the API does: normalized and trimmed', () => {
    expect(charCount('  hello ')).toBe(5);
    // Decomposed Hangul (macOS keyboards) is one character per syllable once normalized.
    expect(charCount('한')).toBe(1);
  });
});

describe('stateFromMatch', () => {
  const saved: MatchTranslationsDto = {
    sourceLanguage: 'ko',
    regionCode: 'seoul-gangnam',
    // 22:00-00:00 on 4 May in Seoul.
    startsAt: '2030-05-04T13:00:00.000Z',
    endsAt: '2030-05-04T15:00:00.000Z',
    venueName: '강남 풋살파크',
    venueAddress: null,
    playersPerSide: 6,
    maxPlayers: 14,
    translations: {
      ko: { title: '강남 금요 풋살', description: '소개', rules: null, locationInstructions: null, equipmentRequirements: null, cancellationPolicy: null },
    },
  };

  it('pre-fills everything, showing the saved instants as Korean date and clock times', () => {
    expect(stateFromMatch(saved)).toMatchObject({
      sourceLanguage: 'ko',
      regionCode: 'seoul-gangnam',
      date: '2030-05-04',
      startTime: '22:00',
      endTime: '00:00',
      venueName: '강남 풋살파크',
      venueAddress: '',
      playersPerSide: 6,
      maxPlayers: 14,
      maxPlayersTouched: true,
    });
    const { translations } = stateFromMatch(saved);
    expect(translations.ko).toMatchObject({ title: '강남 금요 풋살', description: '소개', rules: '' });
    expect(hasText(translations.uz)).toBe(false);
  });

  it('keeps the default capacity default when it equals two full sides', () => {
    expect(stateFromMatch({ ...saved, maxPlayers: 12 }).maxPlayersTouched).toBe(false);
  });

  it('is not dirty until something changes', () => {
    const initial = stateFromMatch(saved);
    expect(isDirty(initial, stateFromMatch(saved))).toBe(false);
    expect(isDirty(withTranslationField(initial, 'ko', 'title', 'x'), initial)).toBe(true);
  });
});
