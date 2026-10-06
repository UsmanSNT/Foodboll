import type { MatchTranslationsDto } from '@foodboll/contracts';
import { LOCALE_CODES, type LocaleCode } from '@foodboll/i18n';
import { formatClock, koreanDateKey } from '../../../lib/dates';

export const TRANSLATION_FIELDS = [
  'title',
  'description',
  'rules',
  'locationInstructions',
  'equipmentRequirements',
  'cancellationPolicy',
] as const;
export type TranslationField = (typeof TRANSLATION_FIELDS)[number];
export type TranslationDraft = Readonly<Record<TranslationField, string>>;

/** Mirrors the limits of `matchInputSchema` (a test keeps them in step). */
export const LIMITS = {
  title: 200,
  venueName: 100,
  venueAddress: 200,
  text: 5000,
  playersPerSide: { min: 3, max: 11 },
  maxPlayers: 60,
} as const;

export const DEFAULT_PLAYERS_PER_SIDE = 6;

/** Error texts by field id, already in the reader's language. */
export type FieldMessages = Readonly<Record<string, string>>;

export interface FormState {
  readonly sourceLanguage: LocaleCode;
  readonly regionCode: string | null;
  /** `YYYY-MM-DD`, Korean calendar date. */
  readonly date: string;
  /** `HH:mm`, Korean time. */
  readonly startTime: string;
  readonly endTime: string;
  readonly venueName: string;
  readonly venueAddress: string;
  readonly playersPerSide: number;
  readonly maxPlayers: number;
  /** Until the organizer sets capacity by hand it follows `playersPerSide` (two full sides). */
  readonly maxPlayersTouched: boolean;
  readonly translations: Readonly<Record<LocaleCode, TranslationDraft>>;
}

const EMPTY_DRAFT: TranslationDraft = {
  title: '',
  description: '',
  rules: '',
  locationInstructions: '',
  equipmentRequirements: '',
  cancellationPolicy: '',
};

const emptyTranslations = (): FormState['translations'] =>
  Object.fromEntries(LOCALE_CODES.map((code) => [code, EMPTY_DRAFT])) as FormState['translations'];

export function createInitialState(options: {
  readonly language: LocaleCode;
  readonly regionCode: string | null;
}): FormState {
  return {
    sourceLanguage: options.language,
    regionCode: options.regionCode,
    date: '',
    startTime: '',
    endTime: '',
    venueName: '',
    venueAddress: '',
    playersPerSide: DEFAULT_PLAYERS_PER_SIDE,
    maxPlayers: DEFAULT_PLAYERS_PER_SIDE * 2,
    maxPlayersTouched: false,
    translations: emptyTranslations(),
  };
}

/** Pre-fills the editor from the raw per-language texts the API returns for the organizer. */
export function stateFromMatch(match: MatchTranslationsDto): FormState {
  const translations = emptyTranslations();
  const filled = Object.fromEntries(
    LOCALE_CODES.flatMap((code) => {
      const saved = match.translations[code];
      if (!saved) return [];
      const draft: TranslationDraft = {
        title: saved.title,
        description: saved.description ?? '',
        rules: saved.rules ?? '',
        locationInstructions: saved.locationInstructions ?? '',
        equipmentRequirements: saved.equipmentRequirements ?? '',
        cancellationPolicy: saved.cancellationPolicy ?? '',
      };
      return [[code, draft] as const];
    }),
  );
  return {
    sourceLanguage: match.sourceLanguage,
    regionCode: match.regionCode,
    date: koreanDateKey(match.startsAt),
    startTime: formatClock(match.startsAt),
    endTime: formatClock(match.endsAt),
    venueName: match.venueName,
    venueAddress: match.venueAddress ?? '',
    playersPerSide: match.playersPerSide,
    maxPlayers: match.maxPlayers,
    maxPlayersTouched: match.maxPlayers !== match.playersPerSide * 2,
    translations: { ...translations, ...filled },
  };
}

/** Changing the team size moves the default capacity along and never leaves room for fewer than two full sides. */
export function withPlayersPerSide(state: FormState, playersPerSide: number): FormState {
  const fullSides = playersPerSide * 2;
  return {
    ...state,
    playersPerSide,
    maxPlayers: state.maxPlayersTouched ? Math.max(state.maxPlayers, fullSides) : fullSides,
  };
}

export const withMaxPlayers = (state: FormState, maxPlayers: number): FormState => ({
  ...state,
  maxPlayers,
  maxPlayersTouched: true,
});

export const withTranslationField = (
  state: FormState,
  locale: LocaleCode,
  field: TranslationField,
  value: string,
): FormState => ({
  ...state,
  translations: { ...state.translations, [locale]: { ...state.translations[locale], [field]: value } },
});

export const withClearedLanguage = (state: FormState, locale: LocaleCode): FormState => ({
  ...state,
  translations: { ...state.translations, [locale]: EMPTY_DRAFT },
});

/** Counted the way the API counts: normalized and trimmed. */
export const charCount = (value: string): number => value.normalize('NFC').trim().length;

/** A language counts as provided as soon as any of its fields has text. */
export const hasText = (draft: TranslationDraft): boolean =>
  TRANSLATION_FIELDS.some((field) => draft[field].trim() !== '');

export const isDirty = (current: FormState, initial: FormState): boolean =>
  JSON.stringify(current) !== JSON.stringify(initial);
