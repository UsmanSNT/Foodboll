import { organizerApplicationInputSchema } from '@foodboll/contracts';
import { useId, useState, type FormEvent } from 'react';
import { ApiError } from '../../../api/client';
import { useI18n } from '../../../i18n/I18nProvider';
import { RegionPicker } from '../../../region/RegionPicker';
import { useRegionLabel } from '../../../region/useRegionLabel';
import { Alert } from '../../../ui/Alert';
import { Button } from '../../../ui/Button';
import { ErrorState } from '../../../ui/ErrorState';
import { Field, TextArea } from '../../../ui/Field';
import { ChevronRight, MapPin } from '../../../ui/icons';
import { Sheet } from '../../../ui/Sheet';
import { useToast } from '../../../ui/Toast';
import { useApplyToOrganize } from '../api';

/** Mirrors `organizerApplicationInputSchema`; the schema stays the validator (a test keeps them aligned). */
export const APPLICATION_MESSAGE_MAX = 500;

function RegionName({ code }: { readonly code: string }) {
  const label = useRegionLabel(code);
  return <>{label}</>;
}

/** A duplicate, an existing grant and the open-application limit all answer 409; say which kinds of cause exist. */
function ApplyError({ error }: { readonly error: unknown }) {
  const { t } = useI18n();
  if (error instanceof ApiError && error.code === 'INVALID_STATE')
    return <Alert>{t('organizer.apply.conflict')}</Alert>;
  return <ErrorState error={error} />;
}

/** Choose one region, optionally say a few words, send. The region is picked in a sheet. */
export function ApplyForm() {
  const { t } = useI18n();
  const toast = useToast();
  const apply = useApplyToOrganize();
  const [regionCode, setRegionCode] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [picking, setPicking] = useState(false);
  const [problem, setProblem] = useState<'region' | 'message' | null>(null);
  const ids = useId();
  const [labelId, valueId, errorId] = [`${ids}-label`, `${ids}-value`, `${ids}-error`];

  const edited = () => {
    setProblem(null);
    if (apply.isError) apply.reset();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!regionCode) return setProblem('region');
    const parsed = organizerApplicationInputSchema.safeParse({ regionCode, message });
    if (!parsed.success)
      return setProblem(
        parsed.error.issues.some((issue) => issue.path[0] === 'message') ? 'message' : 'region',
      );
    setProblem(null);
    apply.mutate(parsed.data, {
      onSuccess: () => {
        setRegionCode(null);
        setMessage('');
        toast.show(t('organizer.apply.sent'));
      },
    });
  };

  return (
    <>
      <form className="card card--pad stack" onSubmit={submit} noValidate>
        <div className="field">
          <span className="field__label" id={labelId}>
            {t('organizer.apply.region')}
          </span>
          <button
            type="button"
            className={problem === 'region' ? 'apply-region apply-region--invalid' : 'apply-region'}
            aria-labelledby={`${labelId} ${valueId}`}
            aria-describedby={problem === 'region' ? errorId : undefined}
            onClick={() => setPicking(true)}
          >
            <MapPin size={18} aria-hidden="true" />
            <span id={valueId} className={regionCode ? 'grow' : 'grow muted'}>
              {regionCode ? (
                <RegionName code={regionCode} />
              ) : (
                t('organizer.apply.regionPlaceholder')
              )}
            </span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
          {problem === 'region' && (
            <p id={errorId} className="field__hint apply-error" role="alert">
              {t('organizer.apply.regionRequired')}
            </p>
          )}
        </div>

        <Field
          label={t('organizer.apply.message')}
          hint={t('organizer.apply.messageHint')}
          error={
            problem === 'message' ? t('form.tooLong', { max: APPLICATION_MESSAGE_MAX }) : undefined
          }
        >
          {(props) => (
            <TextArea
              {...props}
              value={message}
              maxLength={APPLICATION_MESSAGE_MAX}
              onChange={(event) => {
                setMessage(event.target.value);
                edited();
              }}
            />
          )}
        </Field>
        <p className="small muted num apply-counter">
          {message.length}/{APPLICATION_MESSAGE_MAX}
        </p>

        {apply.isError && <ApplyError error={apply.error} />}
        <Button type="submit" variant="primary" size="lg" block loading={apply.isPending}>
          {t('organizer.apply.submit')}
        </Button>
      </form>

      <Sheet open={picking} title={t('region.title')} onClose={() => setPicking(false)}>
        <RegionPicker
          current={regionCode}
          allowAll={false}
          onSelect={(code) => {
            setRegionCode(code);
            setPicking(false);
            edited();
          }}
        />
      </Sheet>
    </>
  );
}
