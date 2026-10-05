import { LOCALES, SUPPORTED_LOCALES, type LocaleCode } from '@foodboll/i18n';
import { useId } from 'react';

interface LanguagePickerProps {
  readonly legend: string;
  readonly selected: LocaleCode;
  readonly onSelect: (locale: LocaleCode) => void;
}

/**
 * Language names are always written in their own language and never translated, so a user can
 * find their language whatever the interface is currently showing.
 */
export function LanguagePicker({ legend, selected, onSelect }: LanguagePickerProps) {
  const name = useId();
  return (
    <fieldset className="language-picker">
      <legend>{legend}</legend>
      {SUPPORTED_LOCALES.map(({ code, nativeName }) => (
        <label key={code} className="language-option">
          <input
            type="radio"
            name={name}
            value={code}
            checked={selected === code}
            onChange={() => onSelect(code)}
          />
          <span lang={LOCALES[code].intlTag}>{nativeName}</span>
        </label>
      ))}
    </fieldset>
  );
}
