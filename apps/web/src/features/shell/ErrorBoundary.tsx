import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { Alert } from '../../ui/Alert';
import { Button } from '../../ui/Button';

function CrashFallback() {
  const { t } = useI18n();
  return (
    <div className="page stack">
      <Alert>{t('common.crashed')}</Alert>
      {/* A failed lazy() import is cached by React, so only a full reload can retry it. */}
      <Button variant="primary" onClick={() => window.location.reload()}>
        {t('common.reload')}
      </Button>
    </div>
  );
}

interface State {
  readonly failed: boolean;
}

/** Catches render errors and failed lazy chunks so the app never turns into a blank page. */
export class ErrorBoundary extends Component<{ readonly children: ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(error, info.componentStack);
  }

  override render(): ReactNode {
    return this.state.failed ? <CrashFallback /> : this.props.children;
  }
}
