import { translate } from './messages';
import type { LocaleCode } from './locales';

/** Players live in Korea; dates are always shown in Korean time, not the device's zone. */
export const DISPLAY_TIME_ZONE = 'Asia/Seoul';

// Parts are extracted with a locale that every ICU build ships (en-US) and rendered through the
// catalog (`format.dateTime`), so output never depends on the device's data for ko/uz.
const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: DISPLAY_TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const amountFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function dateFields(value: Date | string | number) {
  const parts = Object.fromEntries(
    partsFormat.formatToParts(new Date(value)).map((part) => [part.type, part.value]),
  );
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  return {
    year,
    month,
    day,
    // Day of week of the Seoul calendar date (0 = Sunday), independent of any locale.
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    hour: String(parts.hour).padStart(2, '0'),
    minute: String(parts.minute).padStart(2, '0'),
  };
}

export function formatDateTime(locale: LocaleCode, value: Date | string | number): string {
  return translate(locale, 'format.dateTime', dateFields(value));
}

export function formatKrw(locale: LocaleCode, amount: number): string {
  return translate(locale, 'format.krw', { amount: amountFormat.format(amount) });
}

/** `Fri, Dec 11` style date (no year) in Korean time; month and weekday names come from the catalog. */
export function formatDate(locale: LocaleCode, value: Date | string | number): string {
  return translate(locale, 'format.date', dateFields(value));
}

/** Date with the year, no weekday ("Dec 11, 2026"), for things like "member since". */
export function formatDateLong(locale: LocaleCode, value: Date | string | number): string {
  return translate(locale, 'format.dateLong', dateFields(value));
}
