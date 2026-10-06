import { useEffect, useRef, type ReactNode } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { Button } from './Button';
import { X } from './icons';

interface SheetProps {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

/**
 * Bottom sheet on phones, modal on desktop, built on the native <dialog>: focus is trapped,
 * Escape closes it and the page behind is inert, without any custom focus code.
 */
export function Sheet({ open, title, onClose, children }: SheetProps) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby="sheet-title"
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop (the dialog element itself) dismisses the sheet.
        if (event.target === ref.current) onClose();
      }}
    >
      {open && (
        <>
          <div className="sheet__head">
            <h2 id="sheet-title">{title}</h2>
            <Button variant="ghost" size="sm" icon aria-label={t('common.close')} onClick={onClose}>
              <X size={20} aria-hidden="true" />
            </Button>
          </div>
          <div className="sheet__body">{children}</div>
        </>
      )}
    </dialog>
  );
}
