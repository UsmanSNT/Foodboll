import type { ReactNode } from 'react';

/**
 * One list entry that folds away once it is resolved. While it leaves it is inert, so a second tap
 * cannot reach a card that is already gone.
 */
export function RemovableItem({ leaving, children }: { readonly leaving: boolean; readonly children: ReactNode }) {
  return (
    <li className={leaving ? 'money-item money-item--leaving' : 'money-item'} inert={leaving}>
      <div className="money-item__clip">{children}</div>
    </li>
  );
}
