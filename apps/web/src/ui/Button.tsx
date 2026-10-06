import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface Look {
  readonly variant?: Variant | undefined;
  readonly size?: Size | undefined;
  readonly block?: boolean | undefined;
  readonly icon?: boolean | undefined;
}

function classes({ variant = 'secondary', size = 'md', block, icon }: Look): string {
  return [
    'btn',
    `btn--${variant}`,
    size !== 'md' && `btn--${size}`,
    block && 'btn--block',
    icon && 'btn--icon',
  ]
    .filter(Boolean)
    .join(' ');
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, Look {
  /** Shows a spinner and blocks repeat clicks while an action is in flight. */
  readonly loading?: boolean;
  readonly children: ReactNode;
}

export function Button({ variant, size, block, icon, loading, className, disabled, children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={[classes({ variant, size, block, icon }), className].filter(Boolean).join(' ')}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

interface ButtonLinkProps extends LinkProps, Look {}

export function ButtonLink({ variant, size, block, icon, className, ...rest }: ButtonLinkProps) {
  return <Link {...rest} className={[classes({ variant, size, block, icon }), className].filter(Boolean).join(' ')} />;
}
