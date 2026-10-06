import { useEffect, useState } from 'react';
import { fetchReceipt } from './api';

export type ReceiptState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: unknown }
  | { readonly status: 'ready'; readonly url: string; readonly kind: 'image' | 'pdf' };

/**
 * Loads one receipt into an object URL for as long as the component is mounted. The URL is
 * revoked on unmount, which is when the sheet showing it closes, so the bytes never outlive it.
 */
export function useReceipt(registrationId: string): ReceiptState {
  const [state, setState] = useState<ReceiptState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    fetchReceipt(registrationId, controller.signal).then(
      (blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ status: 'ready', url: objectUrl, kind: blob.type === 'application/pdf' ? 'pdf' : 'image' });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'error', error });
      },
    );
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [registrationId]);

  return state;
}
