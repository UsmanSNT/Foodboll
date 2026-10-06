import type { ReactNode } from 'react';

export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly text?: string;
  readonly action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty__icon" aria-hidden="true">
        {icon}
      </span>
      <h2>{title}</h2>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}
