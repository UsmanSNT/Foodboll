import { useMemo } from 'react';
import { useApiMutation, useNotifications } from '../../api/queries';
import { useAuth } from '../../auth/AuthProvider';
import { useLoginGate } from '../../auth/useRequireLogin';
import { useI18n } from '../../i18n/I18nProvider';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { ErrorState } from '../../ui/ErrorState';
import { Bell } from '../../ui/icons';
import { PageHeader } from '../../ui/PageHeader';
import { ListSkeleton } from '../../ui/Skeleton';

export function NotificationsPage() {
  const { t, formatDateTime } = useI18n();
  const { signedIn } = useAuth();
  const { openLogin } = useLoginGate();
  const notifications = useNotifications();
  const markAll = useApiMutation<void>(
    () => ({ path: '/v1/me/notifications/read', method: 'POST', body: { all: true } }),
    [['notifications']],
  );
  const unread = notifications.data?.unread ?? 0;
  const items = useMemo(() => notifications.data?.items ?? [], [notifications.data]);

  if (!signedIn) {
    return (
      <>
        <PageHeader back title={t('inbox.title')} />
        <div className="page">
          <EmptyState
            icon={<Bell size={32} />}
            title={t('auth.title')}
            text={t('auth.subtitle')}
            action={
              <Button variant="primary" onClick={openLogin}>
                {t('auth.login')}
              </Button>
            }
          />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        back
        title={t('inbox.title')}
        actions={
          unread > 0 ? (
            <Button size="sm" loading={markAll.isPending} onClick={() => markAll.mutate()}>
              {t('inbox.markAllRead')}
            </Button>
          ) : undefined
        }
      />
      <div className="page">
        {notifications.isPending && <ListSkeleton rows={3} height={80} />}
        {notifications.isError && (
          <ErrorState error={notifications.error} onRetry={() => void notifications.refetch()} />
        )}
        {notifications.isSuccess && items.length === 0 && (
          <EmptyState icon={<Bell size={32} />} title={t('inbox.empty')} />
        )}
        {items.length > 0 && (
          <ul className="stack">
            {items.map((item) => (
              <li
                key={item.id}
                className={
                  item.readAt === null ? 'card card--pad note note--unread' : 'card card--pad note'
                }
              >
                <div className="row row--between">
                  <h2>{item.title}</h2>
                  {item.readAt === null && (
                    <span
                      className="note__dot"
                      role="img"
                      aria-label={t('inbox.unread', { count: 1 })}
                    />
                  )}
                </div>
                <p className="prewrap">{item.body}</p>
                <time className="small muted" dateTime={item.createdAt}>
                  {formatDateTime(item.createdAt)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
