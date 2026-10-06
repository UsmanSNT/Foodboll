import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { apiRequest, UNAUTHORIZED_EVENT } from '../api/client';
import { clearAccessToken, readAccessToken, writeAccessToken } from '../i18n/storage';

interface AuthValue {
  readonly token: string | null;
  readonly signedIn: boolean;
  /** Stores a freshly issued access token and refreshes everything that depends on the user. */
  signIn(token: string): void;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { readonly children: ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(readAccessToken);

  const signIn = useCallback(
    (next: string) => {
      writeAccessToken(next);
      setToken(next);
      // Data fetched while anonymous (e.g. "am I registered?") is stale for the new user.
      void queryClient.invalidateQueries();
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    try {
      await apiRequest('/v1/auth/logout', { method: 'POST' });
    } catch {
      /* already expired or offline: the local sign-out below is what matters */
    }
    clearAccessToken();
    setToken(null);
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    const onUnauthorized = () => {
      clearAccessToken();
      setToken(null);
      queryClient.clear();
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [queryClient]);

  const value = useMemo(
    () => ({ token, signedIn: token !== null, signIn, signOut }),
    [token, signIn, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
