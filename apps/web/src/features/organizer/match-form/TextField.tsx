import { useId } from 'react';
import { useI18n } from '../../../i18n/I18nProvider';
import { Field, TextArea, TextInput } from '../../../ui/Field';
import { charCount } from './form-state';

interface TextFieldProps {
  readonly label: string;
  readonly hint?: string;
  readonly error?: string | undefined;
  readonly value: string;
  /** Character limit of the shared schema; the counter shows what is left of it. */
  readonly max: number;
  readonly onChange: (value: string) => void;
  readonly multiline?: boolean;
  /** Language the text is written in, so screen readers and keyboards switch to it. */
  readonly lang?: string;
}

/** A text input or textarea with a label, a hint and a remaining-characters counter. */
export function TextField({
  label,
  hint,
  error,
  value,
  max,
  onChange,
  multiline,
  lang,
}: TextFieldProps) {
  const { t } = useI18n();
  const counterId = useId();
  const left = max - charCount(value);

  return (
    <Field label={label} error={error} {...(hint && { hint })}>
      {(props) => {
        const shared = {
          ...props,
          'aria-describedby': [props['aria-describedby'], counterId].filter(Boolean).join(' '),
          value,
          lang,
          autoComplete: 'off',
        };
        return (
          <>
            {multiline ? (
              <TextArea {...shared} rows={4} onChange={(event) => onChange(event.target.value)} />
            ) : (
              <TextInput {...shared} onChange={(event) => onChange(event.target.value)} />
            )}
            <span
              id={counterId}
              className={left < 0 ? 'mf-counter mf-counter--over' : 'mf-counter'}
            >
              {left < 0
                ? t('matchForm.content.charsOver', { count: -left })
                : t('matchForm.content.charsLeft', { count: left })}
            </span>
          </>
        );
      }}
    </Field>
  );
}
