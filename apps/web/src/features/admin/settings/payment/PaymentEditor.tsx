import type { AdminPaymentInstructionDto, PaymentInstructionInput } from '@foodboll/contracts';
import { DEFAULT_LOCALE, type LocaleCode } from '@foodboll/i18n';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../../../i18n/I18nProvider';
import { Alert } from '../../../../ui/Alert';
import { Button } from '../../../../ui/Button';
import { Field, TextInput } from '../../../../ui/Field';
import { PageHeader } from '../../../../ui/PageHeader';
import { useToast } from '../../../../ui/Toast';
import { useSavePaymentInstruction } from '../api';
import { CountedField } from '../CountedField';
import { FORM_ERROR_ID, localizeErrors } from '../field-errors';
import { LanguageTabs, type LanguageStatus } from '../LanguageTabs';
import { LeaveSheet } from '../LeaveSheet';
import { PAYMENT_LIMITS } from '../limits';
import { byLocale, nativeNames } from '../locale-record';
import { useUnsavedGuard } from '../../../organizer/home/useUnsavedGuard';
import { CurrentPayment } from './CurrentPayment';
import {
  emptyPaymentLanguages,
  hasPaymentText,
  isPaymentDirty,
  paymentDraftFrom,
  paymentFieldLocale,
  paymentTextId,
  validatePaymentDraft,
  withPaymentText,
  type PaymentDraft,
  type PaymentTextField,
} from './payment-form';
import { PaymentPreviewSheet } from './PaymentPreviewSheet';

const NO_ERRORS = {} as const;
const INVALID_CONTROL = '[aria-invalid="true"]';

/**
 * Edits the bank details players pay to. Nothing is sent from the form itself: it first opens the
 * preview, and only the preview's confirm button saves.
 */
export function PaymentEditor({
  current,
}: {
  readonly current: AdminPaymentInstructionDto | null;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const save = useSavePaymentInstruction();
  const formRef = useRef<HTMLFormElement>(null);

  // What the form started with: it is replaced (new key) after a save, never silently by a refresh.
  const [baseline] = useState(() => paymentDraftFrom(current));
  const [draft, setDraft] = useState<PaymentDraft>(baseline);
  const [activeLocale, setActiveLocale] = useState<LocaleCode>(DEFAULT_LOCALE);
  // Errors only appear after the first attempt to save; from then on they follow every change.
  const [attempted, setAttempted] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [reviewing, setReviewing] = useState<PaymentInstructionInput | null>(null);
  const [leaving, setLeaving] = useState(false);

  const checked = attempted ? validatePaymentDraft(draft) : null;
  const errors = checked && !checked.ok ? checked.errors : NO_ERRORS;
  const messages = localizeErrors(errors, t);

  const dirty = isPaymentDirty(draft, baseline);
  const canReview = current === null || dirty;
  useUnsavedGuard(dirty);

  // Moves focus to the first field that needs attention once the errors are on screen.
  useEffect(() => {
    if (focusRequest > 0) formRef.current?.querySelector<HTMLElement>(INVALID_CONTROL)?.focus();
  }, [focusRequest]);

  const statuses = byLocale<LanguageStatus>((code) => {
    if (Object.keys(errors).some((id) => paymentFieldLocale(id) === code)) return 'problem';
    return hasPaymentText(draft.texts[code]) ? 'filled' : 'empty';
  });
  const emptyLanguages = emptyPaymentLanguages(draft);

  const setText = (field: PaymentTextField, value: string) =>
    setDraft((d) => withPaymentText(d, activeLocale, field, value));
  const textProps = (field: PaymentTextField) => ({
    value: draft.texts[activeLocale][field],
    lang: activeLocale,
    error: messages[paymentTextId(activeLocale, field)],
    onChange: (value: string) => setText(field, value),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = validatePaymentDraft(draft);
    if (result.ok) {
      setReviewing(result.input);
      return;
    }
    setAttempted(true);
    // The first problem may be on a language tab that is not showing.
    const language = result.first === null ? null : paymentFieldLocale(result.first);
    if (language) setActiveLocale(language);
    setFocusRequest((count) => count + 1);
  };

  const closeReview = () => {
    setReviewing(null);
    save.reset();
  };

  // The promise, not mutate's callbacks: saving swaps this form for the saved one while it runs.
  const confirm = (input: PaymentInstructionInput) => {
    void save.mutateAsync(input).then(
      () => toast.show(t('adminSettings.payment.saved')),
      () => undefined, // shown in the preview through `save.error`
    );
  };

  const leave = () => (dirty ? setLeaving(true) : void navigate('/admin'));

  return (
    <>
      <PageHeader back onBack={leave} title={t('adminSettings.payment.title')} />
      <form ref={formRef} className="page page--with-cta as-page" noValidate onSubmit={submit}>
        <CurrentPayment current={current} />

        <fieldset className="as-group">
          <legend className="section-title">{t('adminSettings.payment.account.legend')}</legend>
          <div className="card card--pad stack">
            <p className="small muted">{t('adminSettings.payment.account.hint')}</p>
            <Field
              label={t('payment.accountNumber')}
              hint={t('adminSettings.payment.account.numberHint')}
              error={messages.accountNumber}
            >
              {(props) => (
                <TextInput
                  {...props}
                  className="num"
                  value={draft.accountNumber}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) =>
                    setDraft((d) => ({ ...d, accountNumber: event.target.value }))
                  }
                />
              )}
            </Field>
            <Field
              label={t('payment.accountHolder')}
              hint={t('adminSettings.payment.account.holderHint')}
              error={messages.accountHolder}
            >
              {(props) => (
                <TextInput
                  {...props}
                  value={draft.accountHolder}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) =>
                    setDraft((d) => ({ ...d, accountHolder: event.target.value }))
                  }
                />
              )}
            </Field>
          </div>
        </fieldset>

        <fieldset className="as-group">
          <legend className="section-title">{t('adminSettings.payment.texts.legend')}</legend>
          <div className="card card--pad stack">
            <p className="small muted">{t('adminSettings.lang.intro')}</p>
            <LanguageTabs active={activeLocale} statuses={statuses} onSelect={setActiveLocale}>
              <CountedField
                label={t('payment.bankName')}
                hint={t('adminSettings.payment.texts.bankNameHint')}
                max={PAYMENT_LIMITS.bankName}
                {...textProps('bankName')}
              />
              <CountedField
                multiline
                rows={6}
                label={t('adminSettings.payment.texts.instructions')}
                hint={t('adminSettings.payment.texts.instructionsHint')}
                max={PAYMENT_LIMITS.instructions}
                {...textProps('instructions')}
              />
            </LanguageTabs>
            {emptyLanguages.length > 0 && (
              <Alert tone="warning">
                {t('adminSettings.lang.missingWarning', { languages: nativeNames(emptyLanguages) })}
              </Alert>
            )}
          </div>
        </fieldset>

        <div className="cta-bar">
          <div className="cta-bar__inner stack">
            {messages[FORM_ERROR_ID] && <Alert>{messages[FORM_ERROR_ID]}</Alert>}
            {!canReview && <p className="small muted">{t('adminSettings.payment.unchanged')}</p>}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              block
              disabled={!canReview}
              loading={save.isPending}
            >
              {t('adminSettings.payment.review')}
            </Button>
          </div>
        </div>
      </form>

      <PaymentPreviewSheet
        input={reviewing}
        current={current}
        startLanguage={activeLocale}
        saving={save.isPending}
        error={save.error}
        onConfirm={() => {
          if (reviewing) confirm(reviewing);
        }}
        onClose={closeReview}
      />
      <LeaveSheet
        open={leaving}
        onKeep={() => setLeaving(false)}
        onLeave={() => void navigate('/admin')}
      />
    </>
  );
}
