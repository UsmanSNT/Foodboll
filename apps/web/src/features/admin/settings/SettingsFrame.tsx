import type { ReactNode } from 'react';
import { PageHeader } from '../../../ui/PageHeader';

/** Header and page body for the states around an editor: loading, failed, not found. */
export function SettingsFrame({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <>
      <PageHeader back title={title} />
      <div className="page">{children}</div>
    </>
  );
}
