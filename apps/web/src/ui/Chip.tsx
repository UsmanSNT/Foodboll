import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'> {
  readonly selected: boolean;
  readonly children: ReactNode;
  readonly day?: boolean;
}

/** A toggle button styled as a pill (filters, day picker). */
export function Chip({ selected, day, className, children, ...rest }: ChipProps) {
  return (
    <button
      type="button"
      {...rest}
      aria-pressed={selected}
      className={['chip', day && 'chip--day', className].filter(Boolean).join(' ')}
    >
      {children}
    </button>
  );
}
