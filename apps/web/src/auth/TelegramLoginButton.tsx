import type { AuthTokenDto } from '@foodboll/contracts';
import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    onTelegramAuth?: (user: Record<string, unknown>) => void;
  }
}

/**
 * Telegram's official Login Widget. It hands back a payload SIGNED by Telegram; the server verifies
 * the signature, so nothing here is trusted. Not loaded in tests (no network).
 */
export function TelegramLoginButton({
  botUsername,
  onAuth,
}: {
  readonly botUsername: string;
  readonly onAuth: (payload: Record<string, unknown>) => void;
}) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = container.current;
    if (!host || import.meta.env.MODE === 'test') return;
    window.onTelegramAuth = onAuth;
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.dataset.telegramLogin = botUsername;
    script.dataset.size = 'large';
    script.dataset.radius = '24';
    script.dataset.requestAccess = 'write';
    script.dataset.onauth = 'onTelegramAuth(user)';
    host.replaceChildren(script);
    return () => {
      host.replaceChildren();
      delete window.onTelegramAuth;
    };
  }, [botUsername, onAuth]);

  return <div ref={container} className="telegram-login" data-testid="telegram-login" />;
}

export type { AuthTokenDto };
