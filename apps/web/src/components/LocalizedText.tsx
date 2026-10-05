import type { LocalizedValueDto } from '@foodboll/contracts';
import { LOCALES } from '@foodboll/i18n';
import { useI18n } from '../i18n/I18nProvider';

/**
 * Renders user-authored content. `lang` is set to the language the text is really written in so
 * screen readers pronounce it correctly; when it is a fallback the reader is told why they are
 * seeing another language. Text is rendered as text (React escapes it), never as HTML.
 */
export function LocalizedText({ value }: { readonly value: LocalizedValueDto }) {
  const { t } = useI18n();
  return (
    <>
      <span lang={LOCALES[value.locale].intlTag} className="localized-text">
        {value.text}
      </span>
      {value.isFallback && (
        <small className="fallback-notice">
          {t('content.fallbackNotice', { language: LOCALES[value.locale].nativeName })}
        </small>
      )}
    </>
  );
}
