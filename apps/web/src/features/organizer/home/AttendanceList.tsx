import type { MatchDto, RosterEntryDto } from '@foodboll/contracts';
import { useState } from 'react';
import { useI18n } from '../../../i18n/I18nProvider';
import { Alert } from '../../../ui/Alert';
import { Button } from '../../../ui/Button';
import { EmptyState } from '../../../ui/EmptyState';
import { ErrorState } from '../../../ui/ErrorState';
import { CheckCircle2, Users } from '../../../ui/icons';
import { useToast } from '../../../ui/Toast';
import { useSaveAttendance } from '../api';
import { RosterRow } from './RosterRow';
import { RosterSummary } from './RosterSummary';
import {
  ATTENDANCE_WINDOW_DAYS,
  markingState,
  markOf,
  pendingMarks,
  summarize,
  withMark,
  withRestPresent,
  type Drafts,
} from './roster-state';
import { useNow } from './useNow';
import { useUnsavedGuard } from './useUnsavedGuard';

interface Props {
  readonly match: MatchDto;
  readonly entries: readonly RosterEntryDto[];
  /** Called when a save fails, so the roster is reloaded in case someone left the match meanwhile. */
  readonly onStale: () => void;
}

/**
 * The attendance sheet. Taps only change local drafts; one explicit Save sends the differences, so
 * a mis-tap costs nothing and a half-finished sheet is never stored.
 */
export function AttendanceList({ match, entries, onStale }: Props) {
  const { t } = useI18n();
  const toast = useToast();
  const now = useNow();
  const save = useSaveAttendance(match.id);
  const [drafts, setDrafts] = useState<Drafts>({});

  const marking = markingState(match, now);
  const editable = marking === 'open' && !save.isPending;
  const marks = pendingMarks(entries, drafts);
  const counts = summarize(entries, drafts);
  useUnsavedGuard(marks.length > 0);

  if (entries.length === 0) {
    return <EmptyState icon={<Users size={32} />} title={t('organizer.roster.emptyTitle')} text={t('organizer.roster.emptyText')} />;
  }

  const anyDecided = counts.unmarked < entries.length;
  const change = (update: (current: Drafts) => Drafts) => {
    if (save.isError) save.reset();
    setDrafts(update);
  };
  const submit = () =>
    save.mutate(marks, {
      onSuccess: () => {
        setDrafts({});
        toast.show(t('organizer.roster.saved'));
      },
      onError: onStale,
    });

  return (
    <>
      {marking === 'before' && <Alert tone="info">{t('organizer.roster.notStarted')}</Alert>}
      {marking === 'closed' && <Alert tone="warning">{t('organizer.roster.closed', { days: ATTENDANCE_WINDOW_DAYS })}</Alert>}

      <RosterSummary {...counts} />

      <section className="stack">
        <h2 className="section-title">{t('organizer.roster.players', { count: entries.length })}</h2>
        <Button block disabled={!editable || counts.unmarked === 0} onClick={() => change((current) => withRestPresent(current, entries))}>
          <CheckCircle2 size={18} aria-hidden="true" />
          {anyDecided ? t('organizer.roster.markRest') : t('organizer.roster.markAll')}
        </Button>
        <ul className="stack">
          {entries.map((entry) => (
            <RosterRow
              key={entry.registrationId}
              entry={entry}
              mark={markOf(entry, drafts)}
              disabled={!editable}
              onChange={(value) => change((current) => withMark(current, entry, value))}
            />
          ))}
        </ul>
        {entries.some((entry) => entry.attended !== null) && <p className="small muted">{t('organizer.roster.savedHint')}</p>}
      </section>

      {marking === 'open' && (
        <div className="cta-bar">
          <div className="cta-bar__inner stack">
            {save.isError && <ErrorState error={save.error} />}
            <p className="small muted roster-status" aria-live="polite">
              {marks.length > 0 ? t('organizer.roster.unsaved', { count: marks.length }) : t('organizer.roster.noChanges')}
            </p>
            <Button variant="primary" size="lg" block loading={save.isPending} disabled={marks.length === 0} onClick={submit}>
              {t('organizer.roster.save')}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
