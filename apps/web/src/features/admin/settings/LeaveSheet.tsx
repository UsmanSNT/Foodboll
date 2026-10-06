import { useI18n } from '../../../i18n/I18nProvider';
import { Button } from '../../../ui/Button';
import { Sheet } from '../../../ui/Sheet';

interface LeaveSheetProps {
  readonly open: boolean;
  readonly onKeep: () => void;
  readonly onLeave: () => void;
}

/** Asked before leaving a form with unsaved changes. */
export function LeaveSheet({ open, onKeep, onLeave }: LeaveSheetProps) {
  const { t } = useI18n();
  return (
    <Sheet open={open} title={t('adminSettings.leave.title')} onClose={onKeep}>
      <div className="stack">
        <p className="muted">{t('adminSettings.leave.text')}</p>
        <Button variant="danger" block onClick={onLeave}>
          {t('adminSettings.leave.confirm')}
        </Button>
        <Button block onClick={onKeep}>
          {t('adminSettings.keepEditing')}
        </Button>
      </div>
    </Sheet>
  );
}
