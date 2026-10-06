import type { RegionDto } from '@foodboll/contracts';
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
import { apiRequest } from '../api/client';
import { useMe } from '../api/queries';
import { useAuth } from '../auth/AuthProvider';
import { ALL_REGIONS, readStoredRegion, writeStoredRegion } from '../i18n/storage';

interface RegionValue {
  /** Region code the feed is filtered to; null = every region. */
  readonly region: string | null;
  /** The region saved on the user's account, if signed in. */
  readonly homeRegion: RegionDto | null;
  /** True until the user has chosen (or skipped) a region on this device. */
  readonly needsOnboarding: boolean;
  /** True while a signed-in user's home region is still loading, so the feed must not guess. */
  readonly resolving: boolean;
  /** Changes what the feed shows. With `asHome`, also saves it as the user's home region. */
  choose(code: string | null, options?: { asHome?: boolean }): Promise<void>;
}

const RegionContext = createContext<RegionValue | null>(null);

export function RegionProvider({ children }: { readonly children: ReactNode }) {
  const { signedIn } = useAuth();
  const me = useMe();
  const queryClient = useQueryClient();
  const [stored, setStored] = useState<string | null>(readStoredRegion);
  const homeRegion = me.data?.homeRegion ?? null;

  const saveHome = useCallback(
    async (code: string | null) => {
      await apiRequest('/v1/me/region', { method: 'PATCH', body: { regionCode: code } });
      await queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    [queryClient],
  );

  const choose = useCallback(
    async (code: string | null, options: { asHome?: boolean } = {}) => {
      const value = code ?? ALL_REGIONS;
      writeStoredRegion(value);
      setStored(value);
      if (options.asHome && signedIn) {
        try {
          await saveHome(code);
        } catch {
          /* the on-device choice still applies; it is saved to the account on the next sign-in */
        }
      }
    },
    [saveHome, signedIn],
  );

  // A region picked before signing in becomes the account's home region once there is an account.
  useEffect(() => {
    if (signedIn && me.isSuccess && !me.data.homeRegion && stored && stored !== ALL_REGIONS) {
      void saveHome(stored).catch(() => undefined);
    }
  }, [signedIn, me.isSuccess, me.data?.homeRegion, stored, saveHome]);

  const value = useMemo<RegionValue>(() => {
    const region = stored === ALL_REGIONS ? null : (stored ?? homeRegion?.code ?? null);
    // A signed-in user is not asked again on a new device if their account already has a region.
    const waitingForAccount = signedIn && me.isPending;
    return {
      region,
      homeRegion,
      needsOnboarding: stored === null && homeRegion === null && !waitingForAccount,
      resolving: stored === null && waitingForAccount,
      choose,
    };
  }, [stored, homeRegion, signedIn, me.isPending, choose]);

  return <RegionContext.Provider value={value}>{children}</RegionContext.Provider>;
}

export function useRegion(): RegionValue {
  const value = useContext(RegionContext);
  if (!value) throw new Error('useRegion must be used inside <RegionProvider>');
  return value;
}
