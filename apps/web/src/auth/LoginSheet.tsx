import { useState } from 'react';
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
                { name: name.trim(), role: 'PLAYER' },
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
