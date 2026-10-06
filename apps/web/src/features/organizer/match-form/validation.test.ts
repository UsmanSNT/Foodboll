import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  LIMITS,
  withMaxPlayers,
  withPlayersPerSide,
  withTranslationField,
  type FormState,
} from './form-state';
import { firstInvalidField, localeOfField, validateMatchForm, type FieldErrors } from './validation';

// 09:00 on 1 May 2030 in Seoul.
const NOW = new Date('2030-05-01T00:00:00Z');

function filledForm(change: (state: FormState) => FormState = (state) => state): FormState {
  const base: FormState = {
    ...createInitialState({ language: 'ko', regionCode: 'seoul-gangnam' }),
    date: '2030-05-04',
    startTime: '22:00',
    endTime: '00:00',
    venueName: '강남 풋살파크',
  };
  return change(withTranslationField(base, 'ko', 'title', '강남 금요 풋살'));
}

function errorsOf(state: FormState): FieldErrors {
  const result = validateMatchForm(state, NOW);
  if (result.ok) throw new Error('expected validation to fail');
  return result.errors;
}

describe('a valid form', () => {
  it('produces exactly the request body of the API, without any fee', () => {
    const result = validateMatchForm(filledForm(), NOW);
    expect(result).toEqual({
      ok: true,
      input: {
        sourceLanguage: 'ko',
        regionCode: 'seoul-gangnam',
        startsAt: '2030-05-04T22:00:00+09:00',
        endsAt: '2030-05-05T00:00:00+09:00',
        venueName: '강남 풋살파크',
        venueAddress: null,
        playersPerSide: 6,
        maxPlayers: 12,
        translations: {
          ko: {
            title: '강남 금요 풋살',
            description: null,
            rules: null,
            locationInstructions: null,
            equipmentRequirements: null,
            cancellationPolicy: null,
          },
        },
      },
    });
    expect(result.ok && 'feeKrw' in result.input).toBe(false);
  });

  it('trims and normalizes text, and sends blank optional fields as null', () => {
    const state = filledForm((s) =>
      withTranslationField({ ...s, venueName: '  한  ', venueAddress: '   ' }, 'ko', 'description', '  Open to all levels  '),
    );
    const result = validateMatchForm(state, NOW);
    expect(result.ok && result.input.venueName).toBe('한');
    expect(result.ok && result.input.venueAddress).toBeNull();
    expect(result.ok && result.input.translations.ko?.description).toBe('Open to all levels');
  });

  it('sends every language that has text and leaves completely empty ones out', () => {
    const state = filledForm((s) =>
      withTranslationField(withTranslationField(s, 'en', 'title', 'Gangnam Friday futsal'), 'uz', 'rules', ''),
    );
    const result = validateMatchForm(state, NOW);
    expect(result.ok && Object.keys(result.input.translations).sort()).toEqual(['en', 'ko']);
  });

  it('accepts the source language being a different one than Korean', () => {
    const state = createInitialState({ language: 'uz', regionCode: 'gyeonggi-ansan' });
    const uzbek = withTranslationField(
      { ...state, date: '2030-05-04', startTime: '19:00', endTime: '21:00', venueName: '안산 풋살장' },
      'uz',
      'title',
      'Ansar futzal',
    );
    const result = validateMatchForm(uzbek, NOW);
    expect(result.ok && result.input.sourceLanguage).toBe('uz');
  });
});

describe('required fields', () => {
  it('flags everything that is missing on an empty form', () => {
    const errors = errorsOf(createInitialState({ language: 'en', regionCode: null }));
    expect(Object.keys(errors).sort()).toEqual(
      ['date', 'endTime', 'regionCode', 'startTime', 'translations.en.title', 'venueName'].sort(),
    );
    expect(errors.regionCode).toEqual({ key: 'form.required' });
    expect(errors.venueName).toEqual({ key: 'form.required' });
    expect(errors['translations.en.title']).toEqual({ key: 'matchForm.errors.sourceTitle' });
  });

  it('requires the title of the source language even if another language is filled', () => {
    const state = withTranslationField(filledForm((s) => withTranslationField(s, 'ko', 'title', '')), 'en', 'title', 'Friday futsal');
    expect(errorsOf(state)).toEqual({ 'translations.ko.title': { key: 'matchForm.errors.sourceTitle' } });
  });

  it('asks for a title when a language has text but no title, and for nothing when it is empty', () => {
    const state = filledForm((s) => withTranslationField(s, 'uz', 'description', 'Barcha darajalar uchun'));
    expect(errorsOf(state)).toEqual({ 'translations.uz.title': { key: 'matchForm.errors.languageTitle' } });
    expect(validateMatchForm(filledForm(), NOW).ok).toBe(true);
  });

  it('treats a title of only spaces as missing', () => {
    expect(errorsOf(filledForm((s) => withTranslationField(s, 'ko', 'title', '   ')))['translations.ko.title']).toEqual({
      key: 'matchForm.errors.sourceTitle',
    });
  });

  it('flags one missing time at a time', () => {
    expect(Object.keys(errorsOf(filledForm((s) => ({ ...s, endTime: '' }))))).toEqual(['endTime']);
    expect(Object.keys(errorsOf(filledForm((s) => ({ ...s, startTime: '' }))))).toEqual(['startTime']);
    expect(Object.keys(errorsOf(filledForm((s) => ({ ...s, date: '' }))))).toEqual(['date']);
  });
});

describe('limits', () => {
  const text = (length: number) => 'a'.repeat(length);
  const cases: readonly [string, (value: string) => (s: FormState) => FormState, number][] = [
    ['venueName', (v) => (s) => ({ ...s, venueName: v }), LIMITS.venueName],
    ['venueAddress', (v) => (s) => ({ ...s, venueAddress: v }), LIMITS.venueAddress],
    ['translations.ko.title', (v) => (s) => withTranslationField(s, 'ko', 'title', v), LIMITS.title],
    ['translations.ko.description', (v) => (s) => withTranslationField(s, 'ko', 'description', v), LIMITS.text],
    ['translations.ko.rules', (v) => (s) => withTranslationField(s, 'ko', 'rules', v), LIMITS.text],
    ['translations.ko.locationInstructions', (v) => (s) => withTranslationField(s, 'ko', 'locationInstructions', v), LIMITS.text],
    ['translations.ko.equipmentRequirements', (v) => (s) => withTranslationField(s, 'ko', 'equipmentRequirements', v), LIMITS.text],
    ['translations.ko.cancellationPolicy', (v) => (s) => withTranslationField(s, 'ko', 'cancellationPolicy', v), LIMITS.text],
  ];

  it.each(cases)('%s: the limit used by the form is the limit of the shared schema', (id, set, max) => {
    expect(validateMatchForm(filledForm(set(text(max))), NOW).ok).toBe(true);
    expect(errorsOf(filledForm(set(text(max + 1))))[id]).toEqual({ key: 'form.tooLong', params: { max } });
  });
});

describe('when', () => {
  it('refuses a start that is not in the future, on the field that caused it', () => {
    expect(errorsOf(filledForm((s) => ({ ...s, date: '2030-05-01', startTime: '08:00', endTime: '10:00' })))).toEqual({
      startTime: { key: 'matchForm.errors.startPast' },
    });
    expect(errorsOf(filledForm((s) => ({ ...s, date: '2030-04-30' })))).toEqual({
      date: { key: 'matchForm.errors.startPast' },
    });
  });

  it('refuses a match longer than 12 hours, and an end equal to the start', () => {
    expect(errorsOf(filledForm((s) => ({ ...s, startTime: '08:00', endTime: '20:01' })))).toEqual({
      endTime: { key: 'matchForm.errors.tooLong', params: { hours: 12 } },
    });
    expect(errorsOf(filledForm((s) => ({ ...s, startTime: '08:00', endTime: '08:00' }))).endTime).toBeDefined();
    expect(validateMatchForm(filledForm((s) => ({ ...s, startTime: '08:00', endTime: '20:00' })), NOW).ok).toBe(true);
  });
});

describe('format', () => {
  it('refuses a team size outside 3 to 11', () => {
    expect(errorsOf(filledForm((s) => ({ ...s, playersPerSide: 12 }))).playersPerSide).toEqual({
      key: 'matchForm.errors.playersPerSide',
      params: { min: 3, max: 11 },
    });
    expect(errorsOf(filledForm((s) => ({ ...s, playersPerSide: 2 }))).playersPerSide).toBeDefined();
  });

  it('refuses a capacity that does not fit two full sides or exceeds 60', () => {
    const tooSmall = filledForm((s) => ({ ...withPlayersPerSide(s, 8), maxPlayers: 14 }));
    expect(errorsOf(tooSmall).maxPlayers).toEqual({ key: 'matchForm.errors.maxPlayers', params: { min: 16, max: 60 } });
    expect(errorsOf(filledForm((s) => withMaxPlayers(s, 61))).maxPlayers).toBeDefined();
    expect(validateMatchForm(filledForm((s) => withMaxPlayers(s, 60)), NOW).ok).toBe(true);
  });
});

describe('text the API cannot store', () => {
  it('rejects NUL bytes with the general message on the field', () => {
    expect(errorsOf(filledForm((s) => ({ ...s, venueName: 'a\u0000b' }))).venueName).toEqual({
      key: 'errors.VALIDATION_FAILED',
    });
  });
});

describe('a rejection no field explains', () => {
  it('still blocks the submit with a general error instead of doing nothing', () => {
    const errors = errorsOf({ ...filledForm(), sourceLanguage: 'fr' as never });
    expect(errors).toEqual({ form: { key: 'errors.VALIDATION_FAILED' } });
  });
});

describe('localeOfField', () => {
  it('names the language of a translation field and nothing else', () => {
    expect(localeOfField('translations.uz.title')).toBe('uz');
    expect(localeOfField('translations.fr.title')).toBeNull();
    expect(localeOfField('venueName')).toBeNull();
    expect(localeOfField('form')).toBeNull();
  });
});

describe('firstInvalidField', () => {
  const error = { key: 'form.required' } as const;

  it('follows the order of the screen: where, when, format, then content', () => {
    expect(firstInvalidField({ maxPlayers: error, date: error, 'translations.ko.title': error }, 'ko')).toBe('date');
    expect(firstInvalidField({ 'translations.ko.title': error, venueName: error, regionCode: error }, 'ko')).toBe('regionCode');
  });

  it('reads the source language first', () => {
    const errors = { 'translations.ko.title': error, 'translations.en.description': error };
    expect(firstInvalidField(errors, 'ko')).toBe('translations.ko.title');
    expect(firstInvalidField(errors, 'en')).toBe('translations.en.description');
  });

  it('is null when nothing is invalid', () => {
    expect(firstInvalidField({}, 'ko')).toBeNull();
  });
});
