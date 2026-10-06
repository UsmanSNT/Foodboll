import type { OrganizerApplicationStatus } from '@foodboll/contracts';
import type { MessageKey } from '@foodboll/i18n';
import type { Tone } from '../../../ui/Badge';

export const APPLICATION_STATUS_LABEL_KEY = {
  PENDING: 'organizer.apply.status.PENDING',
  APPROVED: 'organizer.apply.status.APPROVED',
  REJECTED: 'organizer.apply.status.REJECTED',
} as const satisfies Record<OrganizerApplicationStatus, MessageKey>;

export const APPLICATION_STATUS_TONE = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
} as const satisfies Record<OrganizerApplicationStatus, Tone>;
