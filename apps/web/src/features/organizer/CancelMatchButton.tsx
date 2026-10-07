import type { LocalizedValueDto, MatchDto } from '@foodboll/contracts';
import { useState } from 'react';
import { useApiMutation } from '../../api/queries';
import { useI18n } from '../../i18n/I18nProvider';
import { Alert } from '../../ui/Alert';
import { Button } from '../../ui/Button';
import { ErrorState } from '../../ui/ErrorState';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';

/**
 * "Cancel match" for an organizer (their own match) or an admin. Nothing happens on the first tap:
 * the sheet spells out what cancelling does, and only its own confirm button cancels.
 */
export function CancelMatchButton({
  matchId,
  title,
  block = false,
  onCancelled,
}: {
  readonly matchId: string;
  readonly title: LocalizedValueDto;
  readonly block?: boolean;
  readonly onCancelled?: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const cancel = useApiMutation<void, MatchDto>(
    () => ({ path: `/v1/matches/${encodeURIComponent(matchId)}/cancel`, method: 'POST' }),
    [
      ['feed'],
      ['match'],
      ['match-translations'],
      ['organized-matches'],
      ['registrations'],
      ['registration'],
      ['match-players'],
      ['roster'],
      ['regions'],
      ['player'],
      ['my-profile'],
    ],
  );

  const close = () => {
    setOpen(false);
    cancel.reset();
  };

  return (
    <>
      <Button
        variant="danger"
        block={block}
        aria-label={t('organizer.home.actionLabel', {
          action: t('organizer.cancel.button'),
          title: title.text,
        })}
        onClick={() => setOpen(true)}
      >
        {t('organizer.cancel.button')}
      </Button>
      <Sheet open={open} title={t('organizer.cancel.title')} onClose={close}>
        <div className="stack">
          <p lang={title.locale}>
            <strong>{title.text}</strong>
          </p>
          <Alert tone="warning">
            <ul className="stack">
              <li>{t('organizer.cancel.notifyAll')}</li>
              <li>{t('organizer.cancel.refundPaid')}</li>
              <li>{t('organizer.cancel.irreversible')}</li>
            </ul>
          </Alert>
          {cancel.isError && <ErrorState error={cancel.error} />}
          <Button
            variant="danger"
            block
            loading={cancel.isPending}
            onClick={() =>
              cancel.mutate(undefined, {
                onSuccess: () => {
                  setOpen(false);
                  toast.show(t('organizer.cancel.done'));
                  onCancelled?.();
                },
              })
            }
          >
            {t('organizer.cancel.confirm')}
          </Button>
          <Button block onClick={close}>
            {t('organizer.cancel.keep')}
          </Button>
        </div>
      </Sheet>
    </>
  );
}
