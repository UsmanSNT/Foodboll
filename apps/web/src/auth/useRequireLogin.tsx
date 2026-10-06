import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { LoginSheet } from './LoginSheet';
import { useAuth } from './AuthProvider';

interface LoginGate {
  /** Runs `action` now if signed in; otherwise opens the sign-in sheet first (action is dropped). */
  requireLogin(action?: () => void): void;
  openLogin(): void;
}
const LoginGateContext = createContext<LoginGate | null>(null);

/** Hosts the single sign-in sheet so any screen can ask for an account without owning the UI. */
export function LoginGateProvider({ children }: { readonly children: ReactNode }) {
  const { signedIn } = useAuth();
  const [open, setOpen] = useState(false);

  const requireLogin = useCallback(
    (action?: () => void) => {
      if (signedIn) action?.();
      else setOpen(true);
    },
    [signedIn],
  );
  const value = useMemo(() => ({ requireLogin, openLogin: () => setOpen(true) }), [requireLogin]);

  return (
    <LoginGateContext.Provider value={value}>
      {children}
      <LoginSheet open={open && !signedIn} onClose={() => setOpen(false)} />
    </LoginGateContext.Provider>
  );
}

export function useLoginGate(): LoginGate {
  const value = useContext(LoginGateContext);
  if (!value) throw new Error('useLoginGate must be used inside <LoginGateProvider>');
  return value;
}
