import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * A choice kept in the address (`?status=…`), so a reload or a shared link opens the same tab.
 * Unknown values fall back to the default instead of failing.
 */
export function useChoiceParam<T extends string>(
  name: string,
  choices: readonly T[],
  fallback: T,
): readonly [T, (value: T) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get(name);
  const value = choices.find((choice) => choice === raw) ?? fallback;

  const choose = useCallback(
    (next: T) =>
      setParams(
        (current) => {
          const updated = new URLSearchParams(current);
          if (next === fallback) updated.delete(name);
          else updated.set(name, next);
          return updated;
        },
        { replace: true },
      ),
    [setParams, name, fallback],
  );
  return [value, choose];
}
