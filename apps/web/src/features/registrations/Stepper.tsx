import { useI18n } from '../../i18n/I18nProvider';
import { Check } from '../../ui/icons';

/** Registered → Pay → Confirmed. `current` is the step the player is on (1-based). */
export function Stepper({ current }: { readonly current: 1 | 2 | 3 }) {
  const { t } = useI18n();
  const steps = [t('payment.stepRegistered'), t('payment.stepPay'), t('payment.stepConfirmed')];
  return (
    <ol className="stepper">
      {steps.map((label, index) => {
        const number = index + 1;
        const state =
          number < current || current === 3 ? 'done' : number === current ? 'current' : 'todo';
        return (
          <li
            key={label}
            className={`stepper__step stepper__step--${state}`}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span className="stepper__dot">
              {state === 'done' ? <Check size={14} aria-hidden="true" /> : number}
            </span>
            <span className="stepper__label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
