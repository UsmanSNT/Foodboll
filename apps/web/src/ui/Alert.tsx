import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info } from './icons';

export function Alert({
  tone = 'danger',
  children,
}: {
  readonly tone?: 'danger' | 'info' | 'success' | 'warning';
  readonly children: ReactNode;
}) {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'info' ? Info : AlertTriangle;
  return (
    <div
      className={tone === 'danger' ? 'alert' : `alert alert--${tone}`}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      <Icon size={18} aria-hidden="true" style={{ flex: 'none', marginTop: 1 }} />
      <div>{children}</div>
    </div>
  );
}
