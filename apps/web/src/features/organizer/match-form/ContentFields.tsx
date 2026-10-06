import { LOCALE_CODES, LOCALES, type LocaleCode, type MessageKey } from '@foodboll/i18n';
import { useId } from 'react';
import { useI18n } from '../../../i18n/I18nProvider';
import { Alert } from '../../../ui/Alert';
import { Badge } from '../../../ui/Badge';
import { Button } from '../../../ui/Button';
import {
  hasText,
  LIMITS,
  TRANSLATION_FIELDS,
  type FieldMessages,
  type FormState,
  type TranslationDraft,
  type TranslationField,
} from './form-state';
import { LANGUAGE_STATUS_KEY, LanguageTabs, type LanguageStatus } from './LanguageTabs';
import { TextField } from './TextField';
import { translationFieldId } from './validation';

type BodyField = Exclude<TranslationField, 'title'>;

const BODY_FIELDS = TRANSLATION_FIELDS.filter((field): field is BodyField => field !== 'title');

// Labels reuse the headings players read on the match page, so organizers see the same words.
const BODY_FIELD_TEXT = {
  description: { label: 'match.description', hint: 'matchForm.content.hints.description' },
  rules: { label: 'match.rules', hint: 'matchForm.content.hints.rules' },
  locationInstructions: {
    label: 'match.locationInstructions',
    hint: 'matchForm.content.hints.locationInstructions',
  },
  equipmentRequirements: {
    label: 'match.equipmentRequirements',
    hint: 'matchForm.content.hints.equipmentRequirements',
  },
  cancellationPolicy: {
    label: 'match.cancellationPolicy',
    hint: 'matchForm.content.hints.cancellationPolicy',
  },
} as const satisfies Record<BodyField, { label: MessageKey; hint: MessageKey }>;

function statusOf(
  locale: LocaleCode,
  draft: TranslationDraft,
  errors: FieldMessages,
): LanguageStatus {
  const titleMissing = draft.title.trim() === '' && hasText(draft);
  if (titleMissing || translationFieldId(locale, 'title') in errors) return 'needsTitle';
  if (Object.keys(errors).some((id) => id.startsWith(`translations.${locale}.`)))
    return 'attention';
  return hasText(draft) ? 'filled' : 'empty';
}

interface ContentFieldsProps {
  readonly state: Pick<FormState, 'sourceLanguage' | 'translations'>;
  readonly activeLocale: LocaleCode;
  readonly errors: FieldMessages;
  readonly onActiveLocaleChange: (locale: LocaleCode) => void;
  readonly onSourceChange: (locale: LocaleCode) => void;
  readonly onFieldChange: (locale: LocaleCode, field: TranslationField, value: string) => void;
  readonly onClear: (locale: LocaleCode) => void;
}

/** The heart of the form: pick the original language, then write each language on its own tab. */
export function ContentFields({
  state,
  activeLocale,
  errors,
  onActiveLocaleChange,
  onSourceChange,
  onFieldChange,
  onClear,
}: ContentFieldsProps) {
  const { t } = useI18n();
  const sourceName = useId();
  const draft = state.translations[activeLocale];
  const isSource = activeLocale === state.sourceLanguage;
  const statuses = Object.fromEntries(
    LOCALE_CODES.map((code) => [code, statusOf(code, state.translations[code], errors)]),
  ) as Record<LocaleCode, LanguageStatus>;
  const status = statuses[activeLocale];
  const textOf = (field: TranslationField) => ({
    value: draft[field],
    lang: activeLocale,
    error: errors[translationFieldId(activeLocale, field)],
    onChange: (value: string) => onFieldChange(activeLocale, field, value),
  });

  return (
    <>
      <p className="small muted">{t('matchForm.content.intro')}</p>

      <fieldset className="mf-subgroup">
        <legend className="field__label">{t('matchForm.content.source')}</legend>
        <div className="mf-subgroup__body">
          <div className="mf-choices">
            {LOCALE_CODES.map((code) => (
              <label key={code} className="mf-choice">
                <input
                  type="radio"
                  name={sourceName}
                  value={code}
                  className="visually-hidden"
                  checked={state.sourceLanguage === code}
                  onChange={() => onSourceChange(code)}
                />
                <span lang={code}>{LOCALES[code].nativeName}</span>
              </label>
            ))}
          </div>
          <p className="field__hint">{t('matchForm.content.sourceHint')}</p>
        </div>
      </fieldset>

      <LanguageTabs active={activeLocale} statuses={statuses} onSelect={onActiveLocaleChange}>
        <div className="row row--wrap">
          <Badge tone={isSource ? 'primary' : 'neutral'}>
            {t(isSource ? 'matchForm.content.original' : 'matchForm.content.translation')}
          </Badge>
          <Badge tone={status === 'filled' ? 'success' : status === 'empty' ? 'neutral' : 'danger'}>
            {t(LANGUAGE_STATUS_KEY[status])}
          </Badge>
          {!isSource && hasText(draft) && (
            <Button variant="ghost" onClick={() => onClear(activeLocale)}>
              {t('matchForm.content.clear')}
            </Button>
          )}
        </div>
        <TextField
          label={t('matchForm.content.titleLabel')}
          hint={t('matchForm.content.titleHint')}
          max={LIMITS.title}
          {...textOf('title')}
        />
        {BODY_FIELDS.map((field) => (
          <TextField
            key={field}
            multiline
            label={t(BODY_FIELD_TEXT[field].label)}
            hint={t(BODY_FIELD_TEXT[field].hint)}
            max={LIMITS.text}
            {...textOf(field)}
          />
        ))}
      </LanguageTabs>

      <Alert tone="info">
        {t('matchForm.content.fallback', { language: LOCALES[state.sourceLanguage].nativeName })}
      </Alert>
    </>
  );
}
