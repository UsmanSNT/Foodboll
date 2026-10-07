import type { MessageKey } from '@foodboll/i18n';
import { useEffect, useRef } from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';

/** Page title per route, most specific first; unknown routes fall back to the app name alone. */
const ROUTE_TITLES: readonly (readonly [pattern: string, key: MessageKey])[] = [
  ['/', 'nav.matches'],
  ['/players', 'nav.players'],
  ['/my-matches', 'nav.myMatches'],
  ['/me', 'nav.myPage'],
  ['/matches/:id', 'nav.matches'],
  ['/registrations/:id', 'registration.heading'],
  ['/players/:id', 'profile.title'],
  ['/notifications', 'inbox.title'],
  ['/settings', 'settings.title'],
  ['/legal', 'myPage.legal'],
  ['/legal/:type', 'myPage.legal'],
  ['/organizer', 'organizer.home.title'],
  ['/organizer/apply', 'organizer.apply.title'],
  ['/organizer/matches/new', 'matchForm.titleNew'],
  ['/organizer/matches/:id/edit', 'matchForm.titleEdit'],
  ['/organizer/matches/:id/roster', 'organizer.roster.title'],
  ['/admin', 'adminHome.title'],
  ['/admin/payments', 'adminPayments.title'],
  ['/admin/deposits', 'adminDeposits.title'],
  ['/admin/applications', 'adminPeople.applications.title'],
  ['/admin/users', 'adminPeople.users.title'],
  ['/admin/payment-info', 'adminSettings.payment.title'],
  ['/admin/legal', 'adminSettings.legal.title'],
  ['/admin/legal/:type', 'adminSettings.legal.title'],
];

/**
 * Keeps the document title in step with the screen and, after a client-side navigation, moves
 * focus to the main region so screen reader and keyboard users start at the new content.
 */
export function RouteEffects() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const first = useRef(true);

  const route = ROUTE_TITLES.find(([pattern]) => matchPath({ path: pattern, end: true }, pathname));
  const page = route ? t(route[1]) : null;
  const app = t('app.name');

  useEffect(() => {
    document.title = page && page !== app ? `${page} · ${app}` : app;
  }, [page, app]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [pathname]);

  return null;
}
