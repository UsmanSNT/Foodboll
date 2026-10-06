import type { RegionNodeDto } from '@foodboll/contracts';
import type { LocaleCode } from '@foodboll/i18n';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../../i18n/I18nProvider';
import { Alert } from '../../../ui/Alert';
import { Button } from '../../../ui/Button';
import { ErrorState } from '../../../ui/ErrorState';
import { Sheet } from '../../../ui/Sheet';
import { useToast } from '../../../ui/Toast';
import { useSaveMatch } from './api';
import { ContentFields } from './ContentFields';
import { FormatFields } from './FormatFields';
import {
  isDirty,
  LIMITS,
  withClearedLanguage,
  withMaxPlayers,
  withPlayersPerSide,
  withTranslationField,
  type FieldMessages,
  type FormState,
} from './form-state';
import { FormGroup } from './FormGroup';
import { RegionField } from './RegionField';
import type { RegionGroup } from './regions';
import { TextField } from './TextField';
import { firstInvalidField, FORM_ERROR_ID, localeOfField, validateMatchForm } from './validation';
import { WhenFields } from './WhenFields';

interface MatchFormProps {
  /** The match being edited; undefined when announcing a new one. */
  readonly matchId: string | undefined;
  readonly initial: FormState;
  readonly tree: readonly RegionNodeDto[];
  readonly regions: readonly RegionGroup[];
  /** A match that has started can no longer be changed. */
  readonly locked: boolean;
}

const NO_ERRORS: FieldMessages = {};
const INVALID_CONTROL = '[aria-invalid="true"], [data-invalid="true"]';

export function MatchForm({ matchId, initial, tree, regions, locked }: MatchFormProps) {
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const save = useSaveMatch(matchId);
  const formRef = useRef<HTMLFormElement>(null);

  // What the form started with: later refreshes of the saved match must not reset or dirty it.
  const [baseline] = useState(initial);
  const [state, setState] = useState(baseline);
  const [activeLocale, setActiveLocale] = useState<LocaleCode>(baseline.sourceLanguage);
  // Errors only appear after the first attempt to save; from then on they follow every change.
  const [attempted, setAttempted] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [leaving, setLeaving] = useState(false);

  const checked = attempted ? validateMatchForm(state, new Date()) : null;
  const messages: FieldMessages =
    checked && !checked.ok
      ? Object.fromEntries(Object.entries(checked.errors).map(([id, error]) => [id, t(error.key, error.params)]))
      : NO_ERRORS;

  const dirty = isDirty(state, baseline);

  // A reload or closing the tab would throw typed work away.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // Moves focus to the first field that needs attention once the errors are on screen.
  useEffect(() => {
    if (focusRequest > 0) formRef.current?.querySelector<HTMLElement>(INVALID_CONTROL)?.focus();
  }, [focusRequest]);

  // Any edit retires the last server error: it was about what was sent, not what is on screen now.
  const update = (change: (current: FormState) => FormState) => {
    setState(change);
    if (save.isError) save.reset();
  };
  const patch = (changes: Partial<FormState>) => update((current) => ({ ...current, ...changes }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (save.isPending || locked) return;
    const result = validateMatchForm(state, new Date());
    if (!result.ok) {
      setAttempted(true);
      // The first problem may be on a language tab that is not showing.
      const first = firstInvalidField(result.errors, state.sourceLanguage);
      const language = first === null ? null : localeOfField(first);
      if (language) setActiveLocale(language);
      setFocusRequest((count) => count + 1);
      return;
    }
    save.mutate(result.input, {
      onSuccess: () => {
        toast.show(t(matchId === undefined ? 'matchForm.created' : 'matchForm.saved'));
        void navigate('/organizer');
      },
    });
  };

  const cancel = () => (dirty ? setLeaving(true) : void navigate('/organizer'));

  // Enter in a single-line field must not publish the match by accident: only the button does.
  const ignoreEnter = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement && !event.nativeEvent.isComposing) {
      event.preventDefault();
    }
  };

  return (
    <>
      <form ref={formRef} className="page page--with-cta" noValidate onSubmit={submit} onKeyDown={ignoreEnter}>
        {locked && <Alert tone="warning">{t('matchForm.startedNotice')}</Alert>}

        <FormGroup legend={t('matchForm.where.legend')} disabled={locked}>
          <RegionField
            value={state.regionCode}
            tree={tree}
            groups={regions}
            error={messages.regionCode}
            onChange={(regionCode) => patch({ regionCode })}
          />
          <TextField
            label={t('matchForm.where.venue')}
            hint={t('matchForm.where.venueHint')}
            error={messages.venueName}
            value={state.venueName}
            max={LIMITS.venueName}
            onChange={(venueName) => patch({ venueName })}
          />
          <TextField
            label={t('matchForm.where.address')}
            hint={t('matchForm.where.addressHint')}
            error={messages.venueAddress}
            value={state.venueAddress}
            max={LIMITS.venueAddress}
            onChange={(venueAddress) => patch({ venueAddress })}
          />
        </FormGroup>

        <FormGroup legend={t('matchForm.when.legend')} disabled={locked}>
          <WhenFields value={state} errors={messages} onChange={patch} />
        </FormGroup>

        <FormGroup legend={t('matchForm.format.legend')} disabled={locked}>
          <FormatFields
            playersPerSide={state.playersPerSide}
            maxPlayers={state.maxPlayers}
            errors={messages}
            onPlayersPerSideChange={(value) => update((current) => withPlayersPerSide(current, value))}
            onMaxPlayersChange={(value) => update((current) => withMaxPlayers(current, value))}
          />
        </FormGroup>

        <FormGroup legend={t('matchForm.content.legend')} disabled={locked}>
          <ContentFields
            state={state}
            activeLocale={activeLocale}
            errors={messages}
            onActiveLocaleChange={setActiveLocale}
            onSourceChange={(sourceLanguage) => {
              patch({ sourceLanguage });
              setActiveLocale(sourceLanguage);
            }}
            onFieldChange={(locale, field, value) => update((current) => withTranslationField(current, locale, field, value))}
            onClear={(locale) => update((current) => withClearedLanguage(current, locale))}
          />
        </FormGroup>

        <Alert tone="info">{t('matchForm.feeNote')}</Alert>

        <div className="cta-bar">
          <div className="cta-bar__inner stack">
            {messages[FORM_ERROR_ID] && <Alert>{messages[FORM_ERROR_ID]}</Alert>}
            {save.isError && <ErrorState error={save.error} />}
            <div className="mf-actions">
              <Button size="lg" onClick={cancel}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" variant="primary" size="lg" loading={save.isPending} disabled={locked}>
                {t(matchId === undefined ? 'matchForm.submitCreate' : 'matchForm.submitSave')}
              </Button>
            </div>
          </div>
        </div>
      </form>

      <Sheet open={leaving} title={t('matchForm.discard.title')} onClose={() => setLeaving(false)}>
        <div className="stack">
          <p className="muted">{t('matchForm.discard.text')}</p>
          <Button variant="danger" block onClick={() => void navigate('/organizer')}>
            {t('matchForm.discard.confirm')}
          </Button>
          <Button block onClick={() => setLeaving(false)}>
            {t('matchForm.discard.keep')}
          </Button>
        </div>
      </Sheet>
    </>
  );
}
