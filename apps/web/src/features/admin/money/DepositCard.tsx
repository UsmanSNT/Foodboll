import type { BankDepositDto } from '@foodboll/contracts';
import { useId } from 'react';
import { useI18n } from '../../../i18n/I18nProvider';
import { Badge } from '../../../ui/Badge';
import { Button } from '../../../ui/Button';
import { CheckCircle2, Info } from '../../../ui/icons';
import { isAssignable, isIgnorable } from './deposit-rules';
import {
  DEPOSIT_METHOD_LABEL_KEY,
  DEPOSIT_REASON_LABEL_KEY,
  DEPOSIT_SOURCE_LABEL_KEY,
  DEPOSIT_STATUS_LABEL_KEY,
  DEPOSIT_STATUS_TONE,
} from './labels';
import { RawMessage } from './RawMessage';
import { RemovableItem } from './RemovableItem';

export type DepositSheetKind = 'assign' | 'ignore';

/** What the deposit screen does when a card or one of its sheets finishes an action. */
export interface DepositHandlers {
  readonly open: (kind: DepositSheetKind, deposit: BankDepositDto) => void;
  /** The deposit was settled: its sheet closes and its card leaves the queue. */
  readonly resolved: (depositId: string) => void;
  /** The deposit had already changed: say so and show its real state. */
  readonly stale: () => void;
}

interface DepositCardProps {
  readonly deposit: BankDepositDto;
  readonly leaving: boolean;
  readonly handlers: DepositHandlers;
}

/** One bank deposit: what arrived, why it was not matched (or how it was), and the message itself. */
export function DepositCard({ deposit, leaving, handlers }: DepositCardProps) {
  const { t, formatKrw, formatDateTime } = useI18n();
  const amountId = useId();
  const received = formatDateTime(deposit.receivedAt);
  const amount = deposit.amountKrw === null ? t('adminDeposits.amountUnknown') : formatKrw(deposit.amountKrw);
  // Each button's name carries the deposit, so a list of cards stays distinguishable by ear.
  const label = (action: string) => t('adminDeposits.actionLabel', { action, summary: `${amount}, ${received}` });
  const amountClass = deposit.amountKrw === null ? 'money-deposit__amount money-deposit__amount--unknown' : 'money-deposit__amount num';
  const assignable = isAssignable(deposit);
  const ignorable = isIgnorable(deposit);

  return (
    <RemovableItem leaving={leaving}>
      <article className="card money-card" aria-labelledby={amountId}>
        <header className="money-card__head">
          <strong id={amountId} className={amountClass}>
            {amount}
          </strong>
          <Badge tone={DEPOSIT_STATUS_TONE[deposit.status]}>{t(DEPOSIT_STATUS_LABEL_KEY[deposit.status])}</Badge>
        </header>

        {deposit.reason && (
          <p className="money-note">
            <Info size={16} aria-hidden="true" />
            <span>{t(DEPOSIT_REASON_LABEL_KEY[deposit.reason])}</span>
          </p>
        )}
        {deposit.matchMethod && (
          <p className="money-note money-note--ok">
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>{t(DEPOSIT_METHOD_LABEL_KEY[deposit.matchMethod])}</span>
          </p>
        )}

        <dl className="kv">
          <dt>{t('adminDeposits.receivedAt')}</dt>
          <dd>{received}</dd>
          <dt>{t('adminDeposits.sourceLabel')}</dt>
          <dd>{t(DEPOSIT_SOURCE_LABEL_KEY[deposit.source])}</dd>
        </dl>

        <RawMessage text={deposit.rawText} />

        {(assignable || ignorable) && (
          <div className="money-actions">
            {ignorable && (
              <div className="money-actions__row">
                <Button aria-label={label(t('adminDeposits.ignore'))} onClick={() => handlers.open('ignore', deposit)}>
                  {t('adminDeposits.ignore')}
                </Button>
              </div>
            )}
            {assignable && (
              <Button variant="primary" block aria-label={label(t('adminDeposits.assign'))} onClick={() => handlers.open('assign', deposit)}>
                {t('adminDeposits.assign')}
              </Button>
            )}
          </div>
        )}
      </article>
    </RemovableItem>
  );
}
