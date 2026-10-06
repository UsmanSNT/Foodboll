import type { OrganizerApplicationStatus, UserRole } from '@foodboll/contracts';
import type { MessageKey } from '@foodboll/i18n';
import type { Tone } from '../../../ui/Badge';

export const APPLICATION_STATUS_LABEL_KEY = {
  PENDING: 'adminPeople.applications.tab.PENDING',
  APPROVED: 'adminPeople.applications.tab.APPROVED',
  REJECTED: 'adminPeople.applications.tab.REJECTED',
} as const satisfies Record<OrganizerApplicationStatus, MessageKey>;

export const APPLICATION_STATUS_TONE = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
} as const satisfies Record<OrganizerApplicationStatus, Tone>;

export const APPLICATION_EMPTY_KEY = {
  PENDING: {
    title: 'adminPeople.applications.empty.PENDING.title',
    text: 'adminPeople.applications.empty.PENDING.text',
  },
  APPROVED: {
    title: 'adminPeople.applications.empty.APPROVED.title',
    text: 'adminPeople.applications.empty.APPROVED.text',
  },
  REJECTED: {
    title: 'adminPeople.applications.empty.REJECTED.title',
    text: 'adminPeople.applications.empty.REJECTED.text',
  },
} as const satisfies Record<OrganizerApplicationStatus, { title: MessageKey; text: MessageKey }>;

export const ROLE_LABEL_KEY = {
  PLAYER: 'adminPeople.users.role.PLAYER',
  ORGANIZER: 'adminPeople.users.role.ORGANIZER',
  ADMIN: 'adminPeople.users.role.ADMIN',
} as const satisfies Record<UserRole, MessageKey>;

export const ROLE_TONE = {
  PLAYER: 'neutral',
  ORGANIZER: 'primary',
  ADMIN: 'accent',
} as const satisfies Record<UserRole, Tone>;
