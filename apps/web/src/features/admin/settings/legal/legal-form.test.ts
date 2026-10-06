import { describe, expect, it } from 'vitest';
import type { PublishedLegal } from '../api';
import {
  isLegalDirty,
  legalDraftFrom,
  outcomeOf,
  parseLegalType,
  validateLegalDraft,
  withLegalText,
} from './legal-form';

const korean = { title: '이용약관', body: '본문' };
const published: PublishedLegal = {
  version: 3,
  publishedAt: '2030-01-01T00:00:00.000Z',
  texts: { ko: korean, uz: { title: 'Shartlar', body: 'Matn' } },
};

describe('parseLegalType', () => {
  it('accepts the document names in any case and nothing else', () => {
    expect(parseLegalType('TERMS')).toBe('TERMS');
    expect(parseLegalType('privacy')).toBe('PRIVACY');
    expect(parseLegalType('imprint')).toBeNull();
    expect(parseLegalType('')).toBeNull();
  });
});

describe('validateLegalDraft', () => {
  it('requires Korean and says so on both fields', () => {
    const result = validateLegalDraft(legalDraftFrom(null));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors)).toEqual(['translations.ko.title', 'translations.ko.body']);
    expect(result.first).toBe('translations.ko.title');
  });

  it('leaves out languages without text and keeps the others', () => {
    const result = validateLegalDraft(legalDraftFrom(published));
    expect(result.ok && result.input).toEqual({
      translations: {
        ko: { title: '이용약관', body: '본문' },
        uz: { title: 'Shartlar', body: 'Matn' },
      },
    });
  });

  it('reports a body over the limit on the language it is in', () => {
    const result = validateLegalDraft(
      withLegalText(legalDraftFrom(published), 'uz', 'body', 'x'.repeat(100_001)),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual({
      'translations.uz.body': { key: 'form.tooLong', params: { max: 100_000 } },
    });
  });

  it('asks for the missing half of a half-written language', () => {
    const result = validateLegalDraft(
      withLegalText(legalDraftFrom(published), 'en', 'title', 'Terms'),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual({
      'translations.en.body': { key: 'adminSettings.errors.languagePartial' },
    });
  });
});

describe('drafts and outcomes', () => {
  it('compares texts after trimming', () => {
    const baseline = legalDraftFrom(published);
    expect(isLegalDirty(withLegalText(baseline, 'ko', 'body', ' 본문 '), baseline)).toBe(false);
    expect(isLegalDirty(withLegalText(baseline, 'ko', 'body', '새 본문'), baseline)).toBe(true);
  });

  it('tells what publishing does to each language', () => {
    const input = {
      translations: { ko: { title: 'T', body: 'B' }, en: { title: 'T', body: 'B' } },
    };
    expect(outcomeOf('en', input, published)).toBe('written');
    expect(outcomeOf('uz', input, published)).toBe('removed');
    expect(outcomeOf('uz', input, null)).toBe('fallback');
    expect(outcomeOf('uz', input, { ...published, texts: { ko: korean } })).toBe('fallback');
  });
});
