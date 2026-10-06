import { useI18n } from '../../../i18n/I18nProvider';
import { LIMITS, type FieldMessages } from './form-state';
import { NumberStepper } from './NumberStepper';

interface FormatFieldsProps {
  readonly playersPerSide: number;
  readonly maxPlayers: number;
  readonly errors: FieldMessages;
  readonly onPlayersPerSideChange: (value: number) => void;
  readonly onMaxPlayersChange: (value: number) => void;
}

/** Team size and capacity; capacity can never be smaller than two full sides. */
export function FormatFields({ playersPerSide, maxPlayers, errors, onPlayersPerSideChange, onMaxPlayersChange }: FormatFieldsProps) {
  const { t } = useI18n();
  const minCapacity = playersPerSide * 2;

  return (
    <>
      <NumberStepper
        label={t('matchForm.format.perSide')}
        hint={t('matchForm.format.perSideHint')}
        error={errors.playersPerSide}
        value={playersPerSide}
        min={LIMITS.playersPerSide.min}
        max={LIMITS.playersPerSide.max}
        decreaseLabel={t('matchForm.format.decrease')}
        increaseLabel={t('matchForm.format.increase')}
        onChange={onPlayersPerSideChange}
      />
      <NumberStepper
        label={t('matchForm.format.max')}
        hint={t('matchForm.format.maxHint', { min: minCapacity, max: LIMITS.maxPlayers })}
        error={errors.maxPlayers}
        value={maxPlayers}
        min={minCapacity}
        max={LIMITS.maxPlayers}
        decreaseLabel={t('matchForm.format.decrease')}
        increaseLabel={t('matchForm.format.increase')}
        onChange={onMaxPlayersChange}
      />
    </>
  );
}
