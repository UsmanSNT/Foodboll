import { useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { Button } from '../../ui/Button';
import { Check, Copy } from '../../ui/icons';
import { useToast } from '../../ui/Toast';

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Older in-app browsers expose no async clipboard.
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    if (!document.execCommand('copy')) throw new Error('copy command refused');
  } finally {
    area.remove();
  }
}

export function CopyButton({ value, label }: { readonly value: string; readonly label: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await writeClipboard(value);
      setCopied(true);
      toast.show(t('payment.copied'));
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the value stays selectable on screen; there is nothing more useful to do */
    }
  };

  return (
    <Button size="sm" aria-label={`${t('payment.copy')}: ${label}`} onClick={() => void copy()}>
      {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
      {copied ? t('payment.copied') : t('payment.copy')}
    </Button>
  );
}
