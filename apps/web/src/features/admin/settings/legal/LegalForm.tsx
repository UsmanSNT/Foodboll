import {
  LEGAL_DOCUMENT_LABEL_KEY,
  type LegalDocumentInput,
  type LegalDocumentType,
} from '@foodboll/contracts';
import { DEFAULT_LOCALE, type LocaleCode } from '@foodboll/i18n';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../../../i18n/I18nProvider';
import { Alert } from '../../../../ui/Alert';
import { Button } from '../../../../ui/Button';
import { PageHeader } from '../../../../ui/PageHeader';
import { useToast } from '../../../../ui/Toast';
import { usePublishLegalDocument, type PublishedLegal } from '../api';
import { CountedField } from '../CountedField';
import { FORM_ERROR_ID, localizeErrors } from '../field-errors';
import { LanguageTabs, type LanguageStatus } from '../LanguageTabs';
import { LeaveSheet } from '../LeaveSheet';
import { LEGAL_LIMITS } from '../limits';
import { byLocale } from '../locale-record';
import { useUnsavedGuard } from '../../../organizer/home/useUnsavedGuard';
import {
  hasLegalText,
  isLegalDirty,
  legalDraftFrom,
  legalFieldLocale,
  legalTextId,
  validateLegalDraft,
  withLegalText,
  type LegalDraft,
  type LegalTextField,
} from './legal-form';
import { PublishSheet } from './PublishSheet';

const LIST = '/admin/legal';
const NO_ERRORS = {} as const;
const INVALID_CONTROL = '[aria-invalid="true"]';

interface LegalFormProps {
  readonly type: LegalDocumentType;
  /** The version readers have now; its texts fill the form. Null when nothing was published yet. */
  readonly published: PublishedLegal | null;
}

/** Writes the next version of a document, one language per tab. Nothing is sent until the sheet confirms. */
export function LegalForm({ type, published }: LegalFormProps) {
  const { t, formatDateLong } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const publish = usePublishLegalDocument(type);
  const formRef = useRef<HTMLFormElement>(null);

  // What the form started with: a refresh of the published version must not reset typed work.
  const [baseline] = useState(() => legalDraftFrom(published));
  const [draft, setDraft] = useState<LegalDraft>(baseline);
  const [activeLocale, setActiveLocale] = useState<LocaleCode>(DEFAULT_LOCALE);
  // Errors only appear after the first attempt to publish; from then on they follow every change.
  const [attempted, setAttempted] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [reviewing, setReviewing] = useState<LegalDocumentInput | null>(null);
  const [leaving, setLeaving] = useState(false);

  const checked = attempted ? validateLegalDraft(draft) : null;
  const errors = checked && !checked.ok ? checked.errors : NO_ERRORS;
  const messages = localizeErrors(errors, t);

  const dirty = isLegalDirty(draft, baseline);
  const canReview = published === null || dirty;
  useUnsavedGuard(dirty);

  // Moves focus to the first field that needs attention once the errors are on screen.
  useEffect(() => {
    if (focusRequest > 0) formRef.current?.querySelector<HTMLElement>(INVALID_CONTROL)?.focus();
  }, [focusRequest]);

  const statuses = byLocale<LanguageStatus>((code) => {
    if (Object.keys(errors).some((id) => legalFieldLocale(id) === code)) return 'problem';
    return hasLegalText(draft[code]) ? 'filled' : 'empty';
  });

  const fieldProps = (field: LegalTextField) => ({
    value: draft[activeLocale][field],
    lang: activeLocale,
    error: messages[legalTextId(activeLocale, field)],
    onChange: (value: string) => setDraft((d) => withLegalText(d, activeLocale, field, value)),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = validateLegalDraft(draft);
    if (result.ok) {
      setReviewing(result.input);
      return;
    }
    setAttempted(true);
    // The first problem may be on a language tab that is not showing.
    const language = result.first === null ? null : legalFieldLocale(result.first);
    if (language) setActiveLocale(language);
    setFocusRequest((count) => count + 1);
  };

  const closeReview = () => {
    setReviewing(null);
    publish.reset();
  };

  const confirm = (input: LegalDocumentInput) => {
    void publish.mutateAsync(input).then(
      (result) => {
        toast.show(t('adminSettings.legal.done', { version: result.version }));
        void navigate(LIST);
      },
      () => undefined, // shown in the sheet through `publish.error`
    );
  };

  const leave = () => (dirty ? setLeaving(true) : void navigate(LIST));

  return (
    <>
      <PageHeader back onBack={leave} title={t(LEGAL_DOCUMENT_LABEL_KEY[type])} />
      <form ref={formRef} className="page page--with-cta as-page" noValidate onSubmit={submit}>
        <Alert tone="info">{t('adminSettings.legal.editor.intro')}</Alert>
        <p className="small muted">
          {published
            ? t('adminSettings.legal.version', {
                version: published.version,
                date: formatDateLong(published.publishedAt),
              })
            : t('adminSettings.legal.editor.first')}
        </p>

        <div className="card card--pad stack">
          <p className="small muted">{t('adminSettings.lang.intro')}</p>
          <LanguageTabs active={activeLocale} statuses={statuses} onSelect={setActiveLocale}>
            <CountedField
              label={t('adminSettings.legal.fields.title')}
              max={LEGAL_LIMITS.title}
              {...fieldProps('title')}
            />
            <CountedField
              multiline
              rows={16}
              className="as-body"
              label={t('adminSettings.legal.fields.body')}
              hint={t('adminSettings.legal.fields.bodyHint')}
              max={LEGAL_LIMITS.body}
              {...fieldProps('body')}
            />
          </LanguageTabs>
        </div>

        <div className="cta-bar">
          <div className="cta-bar__inner stack">
            {messages[FORM_ERROR_ID] && <Alert>{messages[FORM_ERROR_ID]}</Alert>}
            {!canReview && <p className="small muted">{t('adminSettings.legal.unchanged')}</p>}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              block
              disabled={!canReview}
              loading={publish.isPending}
            >
              {t('adminSettings.legal.publish')}
            </Button>
          </div>
        </div>
      </form>

      <PublishSheet
        type={type}
        input={reviewing}
        published={published}
        publishing={publish.isPending}
        error={publish.error}
        onConfirm={() => {
          if (reviewing) confirm(reviewing);
        }}
        onClose={closeReview}
      />
      <LeaveSheet
        open={leaving}
        onKeep={() => setLeaving(false)}
        onLeave={() => void navigate(LIST)}
      />
    </>
  );
}
