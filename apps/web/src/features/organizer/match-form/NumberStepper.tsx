import { useState } from 'react';
import { Button } from '../../../ui/Button';
import { Field, TextInput } from '../../../ui/Field';

interface NumberStepperProps {
  readonly label: string;
  readonly hint?: string;
  readonly error?: string | undefined;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly decreaseLabel: string;
  readonly increaseLabel: string;
  readonly onChange: (value: number) => void;
}

/**
 * A whole number between `min` and `max`, set with the buttons, the arrow keys or by typing. While
 * typing, the field may be empty or out of range; it snaps back into range when it loses focus.
 */
export function NumberStepper({
  label,
  hint,
  error,
  value,
  min,
  max,
  decreaseLabel,
  increaseLabel,
  onChange,
}: NumberStepperProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (n: number) => Math.min(max, Math.max(min, n));

  const step = (delta: number) => {
    setDraft(null);
    onChange(clamp(value + delta));
  };

  return (
    <Field label={label} error={error} {...(hint && { hint })}>
      {(props) => (
        <div className="mf-stepper">
          <Button icon aria-label={`${decreaseLabel}: ${label}`} onClick={() => step(-1)}>
            <span aria-hidden="true">−</span>
          </Button>
          <TextInput
            {...props}
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            step={1}
            value={draft ?? String(value)}
            onChange={(event) => {
              setDraft(event.target.value);
              const n = event.target.valueAsNumber;
              if (Number.isInteger(n) && n >= min && n <= max) onChange(n);
            }}
            onBlur={() => {
              const n = draft === null || draft.trim() === '' ? NaN : Math.round(Number(draft));
              if (draft !== null) onChange(Number.isFinite(n) ? clamp(n) : value);
              setDraft(null);
            }}
          />
          <Button icon aria-label={`${increaseLabel}: ${label}`} onClick={() => step(1)}>
            <span aria-hidden="true">+</span>
          </Button>
        </div>
      )}
    </Field>
  );
}
