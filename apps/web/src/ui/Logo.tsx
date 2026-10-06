import { useI18n } from '../i18n/I18nProvider';

/** Foodboll mark: a ball on a pitch-green tile. Decorative; the wordmark carries the name. */
export function LogoMark({ size = 40 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <rect width="48" height="48" rx="14" fill="var(--pitch-500)" />
      <g transform="translate(6 6) scale(1.5)" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polygon points="12,8 15.8,10.8 14.35,15.2 9.65,15.2 8.2,10.8" fill="var(--lime-400)" stroke="var(--pitch-900)" />
        <path d="M12 8V2M15.8 10.8l5.7-1.8M14.35 15.2l3.55 5M9.65 15.2L6.1 20.2M8.2 10.8L2.5 9" />
      </g>
    </svg>
  );
}

export function Wordmark() {
  const { t } = useI18n();
  return (
    <span className="wordmark">
      <LogoMark size={32} />
      <span>{t('app.name')}</span>
    </span>
  );
}
