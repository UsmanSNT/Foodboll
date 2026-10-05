import type { LocaleCode } from '../locales';
import { ko } from './ko';
import { uz } from './uz';

export type Catalog = typeof ko;

type Paths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Paths<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** Every valid message key, e.g. `'match.apply'`. Typos fail to compile. */
export type MessageKey = Paths<Catalog>;

export const CATALOGS: Readonly<Record<LocaleCode, Catalog>> = { ko, uz };
