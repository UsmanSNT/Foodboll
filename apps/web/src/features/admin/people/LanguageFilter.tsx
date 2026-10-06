import { LOCALES, SUPPORTED_LOCALES } from '@foodboll/i18n';
import { useI18n } from '../../../i18n/I18nProvider';
import { Chip } from '../../../ui/Chip';
import type { UserLanguageFilter } from './api';

/** All, one chip per supported language (in its own name), and the people who never chose one. */
export function LanguageFilter({ value, onChange }: { readonly value: UserLanguageFilter; readonly onChange: (value: UserLanguageFilter) => void }) {
  const { t } = useI18n();
  return (
    <div className="chips" role="group" aria-label={t('adminPeople.users.filterLabel')}>
      <Chip selected={value === 'all'} onClick={() => onChange('all')}>
        {t('adminPeople.users.filterAll')}
      </Chip>
      {SUPPORTED_LOCALES.map((locale) => (
        <Chip key={locale.code} lang={LOCALES[locale.code].intlTag} selected={value === locale.code} onClick={() => onChange(locale.code)}>
          {locale.nativeName}
        </Chip>
      ))}
      <Chip selected={value === 'none'} onClick={() => onChange('none')}>
        {t('adminPeople.users.languageNone')}
      </Chip>
    </div>
  );
}
