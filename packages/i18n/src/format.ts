import { LOCALES, type LocaleCode } from './locales';

/** Players live in Korea; dates are always shown in Korean time, not the device's zone. */
export const DISPLAY_TIME_ZONE = 'Asia/Seoul';

const dateTimeFormats = new Map<LocaleCode, Intl.DateTimeFormat>();
const currencyFormats = new Map<LocaleCode, Intl.NumberFormat>();

export function formatDateTime(locale: LocaleCode, value: Date | string | number): string {
  let format = dateTimeFormats.get(locale);
  if (!format) {
    format = new Intl.DateTimeFormat(LOCALES[locale].intlTag, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: DISPLAY_TIME_ZONE,
    });
    dateTimeFormats.set(locale, format);
  }
  return format.format(new Date(value));
}

export function formatKrw(locale: LocaleCode, amount: number): string {
  let format = currencyFormats.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(LOCALES[locale].intlTag, {
      style: 'currency',
      currency: 'KRW',
      maximumFractionDigits: 0,
    });
    currencyFormats.set(locale, format);
  }
  return format.format(amount);
}
