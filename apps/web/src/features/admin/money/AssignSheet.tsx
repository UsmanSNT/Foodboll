import {
  PAYMENT_STATUS_LABEL_KEY,
  type AdminPaymentDto,
  type BankDepositDto,
} from '@foodboll/contracts';
import { useState } from 'react';
import { useI18n } from '../../../i18n/I18nProvider';
import { Alert } from '../../../ui/Alert';
import { Badge } from '../../../ui/Badge';
import { Button } from '../../../ui/Button';
import { Chip } from '../../../ui/Chip';
import { EmptyState } from '../../../ui/EmptyState';
import { ErrorState } from '../../../ui/ErrorState';
import { Field, TextInput } from '../../../ui/Field';
import { Search } from '../../../ui/icons';
import { Sheet } from '../../../ui/Sheet';
import { ListSkeleton } from '../../../ui/Skeleton';
import { useToast } from '../../../ui/Toast';
import { paymentTone } from '../../registrations/status';
import { ActionError } from './ActionError';
import { useAssignCandidates, useAssignDeposit, type CandidatePool } from './api';
import { filterCandidates } from './candidates';
import type { DepositHandlers } from './DepositCard';
import { isAssignable, type AssignableDeposit } from './deposit-rules';
import { DepositSummary } from './DepositSummary';
import { PaymentSummary } from './PaymentSummary';
import { isStaleState } from './resolution';

/** Long queues are searched, not scrolled: more rows than this only slow the sheet down. */
const MAX_VISIBLE = 50;

interface AssignSheetProps {
  readonly deposit: BankDepositDto | null;
  readonly onClose: () => void;
  readonly handlers: DepositHandlers;
}

/** Ties a deposit the matcher could not place to the registration it paid for. */
export function AssignSheet({ deposit, onClose, handlers }: AssignSheetProps) {
  const { t } = useI18n();
  return (
    <Sheet open={deposit !== null} title={t('adminDeposits.assignTitle')} onClose={onClose}>
      {deposit && isAssignable(deposit) && (
        <AssignFlow key={deposit.id} deposit={deposit} handlers={handlers} />
      )}
    </Sheet>
  );
}

/** Pick a registration, then confirm. The filters survive a step back, so a wrong pick costs one tap. */
function AssignFlow({
  deposit,
  handlers,
}: {
  readonly deposit: AssignableDeposit;
  readonly handlers: DepositHandlers;
}) {
  const candidates = useAssignCandidates(true);
  const [sameAmountOnly, setSameAmountOnly] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<AdminPaymentDto | null>(null);

  if (selected) {
    return (
      <AssignConfirm
        deposit={deposit}
        candidate={selected}
        onBack={() => setSelected(null)}
        handlers={handlers}
      />
    );
  }
  return (
    <div className="stack">
      <DepositSummary deposit={deposit} />
      <CandidatePicker
        deposit={deposit}
        sameAmountOnly={sameAmountOnly}
        onSameAmountOnly={setSameAmountOnly}
        search={search}
        onSearch={setSearch}
        onSelect={setSelected}
        candidates={candidates}
      />
    </div>
  );
}

interface CandidatePickerProps {
  readonly deposit: AssignableDeposit;
  readonly sameAmountOnly: boolean;
  readonly onSameAmountOnly: (value: boolean) => void;
  readonly search: string;
  readonly onSearch: (value: string) => void;
  readonly onSelect: (candidate: AdminPaymentDto) => void;
  readonly candidates: ReturnType<typeof useAssignCandidates>;
}

function CandidatePicker({
  deposit,
  sameAmountOnly,
  onSameAmountOnly,
  search,
  onSearch,
  onSelect,
  candidates,
}: CandidatePickerProps) {
  const { t, formatKrw } = useI18n();
  return (
    <div className="stack">
      <p className="small muted">{t('adminDeposits.assignIntro')}</p>
      <Field label={t('adminDeposits.searchLabel')}>
        {(props) => (
          <div className="search">
            <Search size={18} aria-hidden="true" />
            <TextInput
              {...props}
              type="search"
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              autoComplete="off"
              maxLength={60}
            />
          </div>
        )}
      </Field>
      <div className="row">
        <Chip
          className="money-chip"
          selected={sameAmountOnly}
          onClick={() => onSameAmountOnly(!sameAmountOnly)}
        >
          {t('adminDeposits.sameAmountOnly', { amount: formatKrw(deposit.amountKrw) })}
        </Chip>
      </div>
      {candidates.isPending && <ListSkeleton rows={3} height={92} />}
      {candidates.isError && (
        <ErrorState error={candidates.error} onRetry={() => void candidates.refetch()} />
      )}
      {candidates.data && (
        <CandidateList
          deposit={deposit}
          pool={candidates.data}
          sameAmountOnly={sameAmountOnly}
          search={search}
          onShowAll={() => onSameAmountOnly(false)}
          onSelect={onSelect}
        />
      )}
    </div>
  );
}

interface CandidateListProps {
  readonly deposit: AssignableDeposit;
  readonly pool: CandidatePool;
  readonly sameAmountOnly: boolean;
  readonly search: string;
  readonly onShowAll: () => void;
  readonly onSelect: (candidate: AdminPaymentDto) => void;
}

function CandidateList({
  deposit,
  pool,
  sameAmountOnly,
  search,
  onShowAll,
  onSelect,
}: CandidateListProps) {
  const { t, formatKrw, formatDateTime } = useI18n();
  const matches = filterCandidates(pool.items, {
    amountKrw: deposit.amountKrw,
    sameAmountOnly,
    query: search,
  });
  const visible = matches.slice(0, MAX_VISIBLE);

  return (
    <>
      {pool.truncated && <Alert tone="warning">{t('adminDeposits.candidatesTruncated')}</Alert>}
      {matches.length === 0 &&
        (pool.items.length === 0 ? (
          <EmptyState icon={<Search size={32} />} title={t('adminDeposits.noWaiting')} />
        ) : search.trim() !== '' ? (
          <EmptyState icon={<Search size={32} />} title={t('adminDeposits.noResults')} />
        ) : (
          <EmptyState
            icon={<Search size={32} />}
            title={t('adminDeposits.noSameAmount', { amount: formatKrw(deposit.amountKrw) })}
            action={<Button onClick={onShowAll}>{t('adminDeposits.showAllAmounts')}</Button>}
          />
        ))}
      {visible.length > 0 && (
        <ul className="money-candidates">
          {visible.map((item) => {
            // The server only settles an exact amount; anything else is shown but cannot be chosen.
            const fits = item.payment.amountKrw === deposit.amountKrw;
            return (
              <li key={item.registrationId}>
                <button
                  type="button"
                  className="money-candidate"
                  disabled={!fits}
                  onClick={() => onSelect(item)}
                >
                  <span className="money-candidate__top">
                    <strong>{item.user.displayName}</strong>
                    <Badge tone={paymentTone(item.payment.status)}>
                      {t(PAYMENT_STATUS_LABEL_KEY[item.payment.status])}
                    </Badge>
                    {item.registrationStatus === 'CANCELLED' && (
                      <Badge>{t('match.cancelled')}</Badge>
                    )}
                  </span>
                  <span className="small" lang={item.match.title.locale}>
                    {item.match.title.text}
                  </span>
                  <span className="small muted">{formatDateTime(item.match.startsAt)}</span>
                  <span className="small">
                    <span className="num">{formatKrw(item.payment.amountKrw)}</span>
                    {item.payment.referenceCode && (
                      <>
                        {' '}
                        <span className="money-code">{item.payment.referenceCode}</span>
                      </>
                    )}
                  </span>
                  {!fits && (
                    <span className="small money-candidate__warn">
                      {t('adminDeposits.candidateDifferent')}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {matches.length > visible.length && (
        <p className="small muted">
          {t('adminDeposits.candidatesShown', { shown: visible.length, total: matches.length })}
        </p>
      )}
    </>
  );
}

interface AssignConfirmProps {
  readonly deposit: AssignableDeposit;
  readonly candidate: AdminPaymentDto;
  readonly onBack: () => void;
  readonly handlers: DepositHandlers;
}

function AssignConfirm({ deposit, candidate, onBack, handlers }: AssignConfirmProps) {
  const { t } = useI18n();
  const toast = useToast();
  const assign = useAssignDeposit(deposit.id);
  const name = candidate.user.displayName;

  const submit = () => {
    // The promise (not mutate's callbacks) because the sheet may be dismissed while this is in flight.
    void assign.mutateAsync(candidate.registrationId).then(
      () => {
        toast.show(t('adminDeposits.assigned', { name }));
        handlers.resolved(deposit.id);
      },
      (error: unknown) => {
        if (isStaleState(error)) handlers.stale();
      },
    );
  };

  return (
    <div className="stack">
      <h3>{t('adminDeposits.confirmTitle')}</h3>
      <PaymentSummary item={candidate} />
      <Alert tone="info">{t('adminDeposits.confirmText', { name })}</Alert>
      <ActionError error={assign.error} />
      <Button variant="primary" block loading={assign.isPending} onClick={submit}>
        {t('adminDeposits.confirmSubmit')}
      </Button>
      <Button block disabled={assign.isPending} onClick={onBack}>
        {t('common.back')}
      </Button>
    </div>
  );
}
