import { PAYMENT_REJECT_REASON_LABEL_KEY, type AdminPaymentDto } from '@foodboll/contracts';
import { useId } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../../i18n/I18nProvider';
import { regionLabel } from '../../../lib/match';
import { Avatar } from '../../../ui/Avatar';
import { Badge } from '../../../ui/Badge';
import { Calendar, MapPin } from '../../../ui/icons';
import { LanguageTag } from './LanguageTag';
import { PaymentActions, type PaymentHandlers } from './PaymentActions';
import { RemovableItem } from './RemovableItem';

interface PaymentCardProps {
  readonly item: AdminPaymentDto;
  readonly leaving: boolean;
  readonly handlers: PaymentHandlers;
}

/** One payment in a queue: who, which match, how much, and the codes and times to check it by. */
export function PaymentCard({ item, leaving, handlers }: PaymentCardProps) {
  const { t, formatKrw, formatDateTime } = useI18n();
  const nameId = useId();
  const { user, match, payment } = item;

  return (
    <RemovableItem leaving={leaving}>
      <article className="card money-card" aria-labelledby={nameId}>
        <header className="money-card__head">
          <Avatar name={user.displayName} id={user.id} />
          <h3 className="money-card__name">
            <span id={nameId}>{user.displayName}</span>
            <LanguageTag language={user.preferredLanguage} />
            {item.registrationStatus === 'CANCELLED' && <Badge>{t('match.cancelled')}</Badge>}
          </h3>
          <strong className="money-card__amount num">{formatKrw(payment.amountKrw)}</strong>
        </header>

        <div className="money-match">
          <Link to={`/matches/${match.id}`} className="money-match__title" lang={match.title.locale}>
            {match.title.text}
          </Link>
          <p>
            <Calendar size={14} aria-hidden="true" />
            <span>{formatDateTime(match.startsAt)}</span>
          </p>
          <p>
            <MapPin size={14} aria-hidden="true" />
            <span>
              {match.venueName} · {regionLabel(match.region)}
            </span>
          </p>
        </div>

        <dl className="kv">
          {payment.referenceCode && (
            <>
              <dt>{t('adminPayments.reference')}</dt>
              <dd className="money-code">{payment.referenceCode}</dd>
            </>
          )}
          {item.receiptUploadedAt && (
            <>
              <dt>{t('adminPayments.receiptUploaded')}</dt>
              <dd>{formatDateTime(item.receiptUploadedAt)}</dd>
            </>
          )}
          <dt>{t('adminPayments.due')}</dt>
          <dd>{formatDateTime(payment.dueAt)}</dd>
          {payment.rejectReason && (
            <>
              <dt>{t('payment.rejectReasonLabel')}</dt>
              <dd>{t(PAYMENT_REJECT_REASON_LABEL_KEY[payment.rejectReason])}</dd>
            </>
          )}
        </dl>

        <PaymentActions item={item} withReceipt handlers={handlers} />
      </article>
    </RemovableItem>
  );
}
