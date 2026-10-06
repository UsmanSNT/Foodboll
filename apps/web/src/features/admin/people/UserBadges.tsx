import type { AdminUserDto, UserRole } from '@foodboll/contracts';
import { LOCALES } from '@foodboll/i18n';
import { useI18n } from '../../../i18n/I18nProvider';
import { Badge } from '../../../ui/Badge';
import { ROLE_LABEL_KEY, ROLE_TONE } from './labels';

export function RoleBadge({ role }: { readonly role: UserRole }) {
  const { t } = useI18n();
  return <Badge tone={ROLE_TONE[role]}>{t(ROLE_LABEL_KEY[role])}</Badge>;
}

/** The language the person chose, or that they never did. The prefix tells screen readers what the badge is. */
export function LanguageBadge({
  language,
}: {
  readonly language: AdminUserDto['preferredLanguage'];
}) {
  const { t } = useI18n();
  return (
    <>
      <span className="visually-hidden">{t('adminPeople.users.languageLabel')}: </span>
      {language === null ? (
        <Badge>{t('adminPeople.users.languageNone')}</Badge>
      ) : (
        <span lang={LOCALES[language].intlTag}>
          <Badge tone="info">{LOCALES[language].nativeName}</Badge>
        </span>
      )}
    </>
  );
}

/** What the device reported, exactly as stored (`uz-Latn-UZ`): support context next to the person's own choice. */
export function DeviceLocale({ tag }: { readonly tag: string | null }) {
  const { t } = useI18n();
  return (
    <span className="small muted">
      {tag ? t('adminPeople.users.device', { tag }) : t('adminPeople.users.deviceUnknown')}
    </span>
  );
}
