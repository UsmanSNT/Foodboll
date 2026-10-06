import { setOrganizerRegionsInputSchema, type AdminUserDto, type RegionNodeDto } from '@foodboll/contracts';
import { useMemo, useState } from 'react';
import { useI18n } from '../../../i18n/I18nProvider';
import { Alert } from '../../../ui/Alert';
import { Button } from '../../../ui/Button';
import { ErrorState } from '../../../ui/ErrorState';
import { useToast } from '../../../ui/Toast';
import { useSetOrganizerRegions } from './api';
import { RegionChecklist } from './RegionChecklist';
import { indexRegions, MAX_ORGANIZER_REGIONS, sameSelection, toggleCode } from './region-selection';
import { SelectedRegions } from './SelectedRegions';

interface Props {
  /** A player or an organizer: admins can announce everywhere and the API refuses to change them. */
  readonly user: AdminUserDto;
  readonly tree: readonly RegionNodeDto[];
  readonly onSaved: () => void;
}

/** Says what saving will do to the person's role, since the API changes it together with the grants. */
function RoleNote({ user, empty }: { readonly user: AdminUserDto; readonly empty: boolean }) {
  const { t } = useI18n();
  const params = { name: user.displayName };
  if (user.role === 'ORGANIZER') {
    return empty ? (
      <Alert tone="warning">{t('adminPeople.regions.organizerDemote', params)}</Alert>
    ) : (
      <p className="small muted">{t('adminPeople.regions.organizerHint', params)}</p>
    );
  }
  return empty ? (
    <p className="small muted">{t('adminPeople.regions.playerHint', params)}</p>
  ) : (
    <Alert tone="info">{t('adminPeople.regions.playerPromote', params)}</Alert>
  );
}

/** Edits the full set of regions a person may announce matches in; saving replaces it. */
export function RegionEditor({ user, tree, onSaved }: Props) {
  const { t } = useI18n();
  const toast = useToast();
  const save = useSetOrganizerRegions();
  const initial = useMemo(() => new Set(user.organizerRegions), [user.organizerRegions]);
  const regions = useMemo(() => indexRegions(tree), [tree]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(initial);

  const regionCodes = [...selected].sort();
  const valid = setOrganizerRegionsInputSchema.safeParse({ regionCodes }).success;
  const changed = !sameSelection(selected, initial);

  const change = (next: ReadonlySet<string>) => {
    save.reset();
    setSelected(next);
  };

  const submit = () =>
    save.mutate(
      { userId: user.id, regionCodes },
      {
        onSuccess: () => {
          toast.show(t('adminPeople.regions.saved'));
          onSaved();
        },
      },
    );

  return (
    <div className="stack people-editor">
      <p className="small muted">{t('adminPeople.regions.intro', { name: user.displayName })}</p>
      <RoleNote user={user} empty={selected.size === 0} />
      <SelectedRegions selected={selected} regions={regions} onRemove={(code) => change(toggleCode(selected, code))} />
      {selected.size >= MAX_ORGANIZER_REGIONS && (
        <Alert tone={valid ? 'info' : 'warning'}>{t('adminPeople.regions.limit', { max: MAX_ORGANIZER_REGIONS })}</Alert>
      )}
      <RegionChecklist tree={tree} selected={selected} onChange={change} />
      <div className="people-save stack">
        {save.isError && <ErrorState error={save.error} />}
        <Button variant="primary" block loading={save.isPending} disabled={!changed || !valid} onClick={submit}>
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}
