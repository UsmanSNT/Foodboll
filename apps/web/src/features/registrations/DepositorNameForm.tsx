import { useState } from 'react';
import { useApiMutation, useMe } from '../../api/queries';
import { useI18n } from '../../i18n/I18nProvider';
import { Button } from '../../ui/Button';
import { ErrorState } from '../../ui/ErrorState';
import { Field, TextInput } from '../../ui/Field';
import { useToast } from '../../ui/Toast';

/** For players whose bank app has no sender-memo field: the name on the transfer is matched instead. */
export function DepositorNameForm() {
  const { t } = useI18n();
  const toast = useToast();
  const me = useMe();
  // Until the player types, show what is saved on the account.
  const [draft, setDraft] = useState<string | null>(null);
  const name = draft ?? me.data?.depositorName ?? '';

  const save = useApiMutation<string>(
    (depositorName) => ({ path: '/v1/me/depositor-name', method: 'PATCH', body: { depositorName } }),
    [['me']],
  );
  const trimmed = name.trim();

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(trimmed, { onSuccess: () => toast.show(t('payment.nameSaved')) });
      }}
    >
      <div>
        <h3>{t('payment.nameTitle')}</h3>
        <p className="muted small">{t('payment.nameHint')}</p>
      </div>
      <Field label={t('payment.nameLabel')}>
        {(props) => (
          <TextInput {...props} value={name} maxLength={60} onChange={(event) => setDraft(event.target.value)} autoComplete="off" />
        )}
      </Field>
      <Button type="submit" size="sm" loading={save.isPending} disabled={trimmed.length === 0 || trimmed === me.data?.depositorName}>
        {t('common.save')}
      </Button>
      {save.isError && <ErrorState error={save.error} />}
    </form>
  );
}
