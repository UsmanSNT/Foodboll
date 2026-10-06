import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

interface ToastApi {
  show(message: string): void;
}
const ToastContext = createContext<ToastApi | null>(null);

/** Short confirmations ("Copied"). Announced to screen readers through a polite live region. */
export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [messages, setMessages] = useState<{ id: number; text: string }[]>([]);
  const next = useRef(0);

  const show = useCallback((text: string) => {
    const id = next.current++;
    setMessages((current) => [...current.slice(-2), { id, text }]);
    window.setTimeout(() => setMessages((current) => current.filter((m) => m.id !== id)), 2800);
  }, []);

  const api = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {messages.map((m) => (
          <div key={m.id} className="toast">
            {m.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside <ToastProvider>');
  return api;
}
