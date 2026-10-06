import type { RegionNodeDto } from '@foodboll/contracts';
import { useId, useState } from 'react';
import { useI18n } from '../../../i18n/I18nProvider';
import { ChevronDown, MapPin } from '../../../ui/icons';
import { Sheet } from '../../../ui/Sheet';
import { RegionChooser } from './RegionChooser';
import { findRegion, regionName, type RegionGroup } from './regions';

interface RegionFieldProps {
  readonly value: string | null;
  /** The whole region tree, to name the current choice even if it is no longer on offer. */
  readonly tree: readonly RegionNodeDto[];
  /** What the organizer may choose. */
  readonly groups: readonly RegionGroup[];
  readonly error: string | undefined;
  readonly onChange: (code: string) => void;
}

/** Opens a sheet with the regions the organizer may announce in. */
export function RegionField({ value, tree, groups, error, onChange }: RegionFieldProps) {
  const { t } = useI18n();
  const id = useId();
  const [open, setOpen] = useState(false);
  const found = value === null ? null : findRegion(tree, value);
  const note = error ?? t('matchForm.region.hint');

  return (
    <div className="field">
      <span id={`${id}-label`} className="field__label">
        {t('matchForm.region.label')}
      </span>
      <button
        type="button"
        className="mf-select"
        aria-haspopup="dialog"
        aria-labelledby={`${id}-label ${id}-value`}
        aria-describedby={`${id}-note`}
        data-invalid={error ? 'true' : undefined}
        onClick={() => setOpen(true)}
      >
        <MapPin size={18} aria-hidden="true" />
        <span
          id={`${id}-value`}
          className={found ? 'mf-select__value' : 'mf-select__value mf-select__value--empty'}
          lang={found?.node.name.locale}
        >
          {found ? regionName(found) : t('matchForm.region.placeholder')}
        </span>
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      <p id={`${id}-note`} className={error ? 'field__hint mf-error' : 'field__hint'}>
        {note}
      </p>

      <Sheet open={open} title={t('region.title')} onClose={() => setOpen(false)}>
        <RegionChooser
          groups={groups}
          selected={value}
          onSelect={(code) => {
            onChange(code);
            setOpen(false);
          }}
        />
      </Sheet>
    </div>
  );
}
