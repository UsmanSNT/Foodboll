import type { UserRole } from '@foodboll/contracts';
import { USER_ROLES } from '@foodboll/contracts';
import { useState } from 'react';
import { ROLE_LABEL_KEY } from '../features/admin/people/labels';
import { useAuthConfig, useDevLogin, useTelegramLogin } from '../api/queries';
import { useI18n } from '../i18n/I18nProvider';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Field, TextInput } from '../ui/Field';
import { Send } from '../ui/icons';
import { Sheet } from '../ui/Sheet';
import { ErrorState } from '../ui/ErrorState';
import { useAuth } from './AuthProvider';
import { TelegramLoginButton } from './TelegramLoginButton';

const DEFAULT_DEV_ROLE: UserRole = 'PLAYER';

/** The sign-in sheet. Opened by anything that needs an account (joining, notifications, players). */
export function LoginSheet({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  const { t } = useI18n();
  const { signIn } = useAuth();
  const config = useAuthConfig();
  const telegram = useTelegramLogin();
  const dev = useDevLogin();
  const [name, setName] = useState('');
  const [role, setRole] = useState<UserRole>(DEFAULT_DEV_ROLE);

  const finish = (token: string) => {
    signIn(token);
    onClose();
  };

  return (
    <Sheet open={open} title={t('auth.title')} onClose={onClose}>
      <div className="stack stack--lg">
        <p className="muted">{t('auth.subtitle')}</p>

        {config.isError && (
          <ErrorState error={config.error} onRetry={() => void config.refetch()} />
        )}

        {config.data?.telegramBotUsername && (
          <div className="stack">
            <TelegramLoginButton
              botUsername={config.data.telegramBotUsername}
              onAuth={(payload) =>
                telegram.mutate(payload, { onSuccess: (result) => finish(result.accessToken) })
              }
            />
            <p className="field__hint row">
              <Send size={14} aria-hidden="true" />
              {t('auth.telegramHint')}
            </p>
            {telegram.isError && <ErrorState error={telegram.error} />}
          </div>
        )}

        {config.data && !config.data.telegramBotUsername && !config.data.devLogin && (
          <Alert tone="info">{t('auth.unavailable')}</Alert>
        )}

        {config.data?.devLogin && (
          <form
            className="stack card card--pad"
            onSubmit={(event) => {
              event.preventDefault();
              dev.mutate(
                // The API keeps an existing user's role unless one is sent, so only send a deliberate choice.
                { name: name.trim(), ...(role !== DEFAULT_DEV_ROLE && { role }) },
                { onSuccess: (result) => finish(result.accessToken) },
              );
            }}
          >
            <h3>{t('auth.devTitle')}</h3>
            <Field label={t('auth.devName')}>
              {(props) => (
                <TextInput
                  {...props}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={60}
                  required
                />
              )}
            </Field>
            <Field label={t('auth.devRole')}>
              {(props) => (
                <select
                  {...props}
                  className="select"
                  value={role}
                  onChange={(e) => setRole(e.target.value as UserRole)}
                >
                  {USER_ROLES.map((value) => (
                    <option key={value} value={value}>
                      {t(ROLE_LABEL_KEY[value])}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Button
              type="submit"
              variant="primary"
              loading={dev.isPending}
              disabled={name.trim().length === 0}
            >
              {t('auth.login')}
            </Button>
            {dev.isError && <ErrorState error={dev.error} />}
          </form>
        )}
      </div>
    </Sheet>
  );
}
