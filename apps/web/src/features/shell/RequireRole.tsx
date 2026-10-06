import type { UserRole } from '@foodboll/contracts';
import type { ReactNode } from 'react';
import { useMe } from '../../api/queries';
import { useAuth } from '../../auth/AuthProvider';
import { useLoginGate } from '../../auth/useRequireLogin';
import { useI18n } from '../../i18n/I18nProvider';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { ErrorState } from '../../ui/ErrorState';
import { ShieldCheck } from '../../ui/icons';
import { PageHeader } from '../../ui/PageHeader';
import { ListSkeleton } from '../../ui/Skeleton';

/**
 * Gate for staff screens. The API enforces every permission itself; this only keeps people from
 * landing on a screen whose requests would all fail, and tells them why.
 */
export function RequireRole({
  roles,
  children,
}: {
  readonly roles?: readonly UserRole[];
  readonly children: ReactNode;
}) {
  const { t } = useI18n();
  const { signedIn } = useAuth();
  const { openLogin } = useLoginGate();
  const me = useMe();

  const bare = (content: ReactNode) => (
    <>
      <PageHeader back title={t('app.name')} />
      <div className="page">{content}</div>
    </>
  );

  if (!signedIn) {
    return bare(
      <EmptyState
        icon={<ShieldCheck size={32} />}
        title={t('auth.title')}
        text={t('auth.subtitle')}
        action={
          <Button variant="primary" onClick={openLogin}>
            {t('auth.login')}
          </Button>
        }
      />,
    );
  }
  if (me.isPending) return bare(<ListSkeleton rows={2} />);
  if (me.isError) return bare(<ErrorState error={me.error} onRetry={() => void me.refetch()} />);
  if (roles && !roles.includes(me.data.role)) {
    return bare(<EmptyState icon={<ShieldCheck size={32} />} title={t('errors.FORBIDDEN')} />);
  }
  return <>{children}</>;
}
