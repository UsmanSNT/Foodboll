import type { LocaleCode, LocalizedValue } from '@foodboll/i18n';
import type { AchievementId, ActivityLevel, LevelProgress } from './progression';
import type {
  BankDepositReason,
  BankDepositSource,
  BankDepositStatus,
  BankMatchMethod,
  NotificationType,
  OrganizerApplicationStatus,
  PaymentRejectReason,
  PaymentStatus,
  RegistrationStatus,
  UserRole,
} from './enums';

export type LocalizedValueDto = LocalizedValue;

export interface AuthTokenDto {
  /** Bearer token for the Authorization header. */
  readonly accessToken: string;
  readonly expiresAt: string;
  readonly user: MeDto;
}

export interface NotificationDto {
  readonly id: string;
  readonly type: NotificationType;
  /** Rendered in the reader's current language, whatever language it was first sent in. */
  readonly title: string;
  readonly body: string;
  readonly createdAt: string;
  readonly readAt: string | null;
}

export interface NotificationPage extends Page<NotificationDto> {
  readonly unread: number;
}

export interface LanguageDto {
  readonly code: LocaleCode;
  readonly nativeName: string;
  readonly englishName: string;
}

export interface RegionRefDto {
  readonly id: string;
  readonly code: string;
  /** Localized with fallback; region names are proper nouns, so Korean/English fall back freely. */
  readonly name: LocalizedValueDto;
}

export interface RegionDto extends RegionRefDto {
  readonly level: 1 | 2;
  readonly parent: RegionRefDto | null;
}

export interface RegionNodeDto extends RegionRefDto {
  readonly level: 1 | 2;
  /** Upcoming matches in this region, including its districts. */
  readonly upcomingMatches: number;
  readonly children: readonly RegionNodeDto[];
}

export interface MeDto {
  readonly id: string;
  readonly displayName: string;
  readonly role: UserRole;
  /** The user's explicit choice; null until they choose. */
  readonly preferredLanguage: LocaleCode | null;
  /** Language used for this response. */
  readonly effectiveLanguage: LocaleCode;
  /** Name shown on the player's bank transfers; helps match deposits when no memo is typed. */
  readonly depositorName: string | null;
  /** Where the user plays; the feed defaults to it. */
  readonly homeRegion: RegionDto | null;
}

export interface MatchSummaryDto {
  readonly id: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly venueName: string;
  readonly venueAddress: string | null;
  readonly region: RegionDto;
  readonly playersPerSide: number;
  readonly maxPlayers: number;
  /** Players holding a seat (confirmed, or awaiting payment within their window). */
  readonly registeredCount: number;
  readonly spotsLeft: number;
  readonly feeKrw: number;
  readonly sourceLanguage: LocaleCode;
  readonly title: LocalizedValueDto;
  /** The signed-in user's own registration for this match, if any. */
  readonly viewer: { readonly registrationId: string; readonly status: RegistrationStatus } | null;
}

export interface MatchDto extends MatchSummaryDto {
  /** Fields the organizer left empty in every language are null. */
  readonly description: LocalizedValueDto | null;
  readonly rules: LocalizedValueDto | null;
  readonly locationInstructions: LocalizedValueDto | null;
  readonly equipmentRequirements: LocalizedValueDto | null;
  readonly cancellationPolicy: LocalizedValueDto | null;
}

export interface PaymentInstructionDto {
  readonly id: string;
  readonly bankName: LocalizedValueDto;
  readonly accountNumber: string;
  readonly accountHolder: string;
  readonly instructions: LocalizedValueDto;
}

/** Raw per-language texts for the admin editor (no fallback applied). */
export interface AdminPaymentInstructionDto {
  readonly id: string;
  readonly accountNumber: string;
  readonly accountHolder: string;
  readonly translations: Readonly<
    Partial<Record<LocaleCode, { readonly bankName: string; readonly instructions: string }>>
  >;
  /** Enabled languages that have no text yet; readers of these see the Korean fallback. */
  readonly missingLanguages: readonly LocaleCode[];
}

export interface LegalDocumentDto {
  readonly type: string;
  readonly version: number;
  readonly publishedAt: string;
  readonly title: LocalizedValueDto;
  readonly body: LocalizedValueDto;
}

/** Raw per-language texts of a match, for the organizer's editor. */
export interface MatchTranslationsDto {
  readonly sourceLanguage: LocaleCode;
  readonly regionCode: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly venueName: string;
  readonly venueAddress: string | null;
  readonly playersPerSide: number;
  readonly maxPlayers: number;
  readonly translations: Readonly<
    Partial<
      Record<
        LocaleCode,
        {
          readonly title: string;
          readonly description: string | null;
          readonly rules: string | null;
          readonly locationInstructions: string | null;
          readonly equipmentRequirements: string | null;
          readonly cancellationPolicy: string | null;
        }
      >
    >
  >;
}

export interface AdminUserDto {
  readonly id: string;
  readonly displayName: string;
  readonly role: UserRole;
  /** Explicit choice (null = never chose). */
  readonly preferredLanguage: LocaleCode | null;
  /** Region codes the user may publish matches in (organizers only). */
  readonly organizerRegions: readonly string[];
  /** Raw language reported by the user's device, for support context. */
  readonly deviceLocale: string | null;
  readonly createdAt: string;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly limit: number;
  readonly offset: number;
}

export interface RegistrationPaymentDto {
  readonly status: PaymentStatus;
  readonly amountKrw: number;
  /** Seat is released automatically if no receipt is uploaded by this time. */
  readonly dueAt: string;
  /**
   * 4-digit code the player puts in the transfer's sender memo so the deposit is recognised
   * automatically. Present while a payment is expected.
   */
  readonly referenceCode: string | null;
  readonly hasReceipt: boolean;
  /** Code of the latest rejection; localize with PAYMENT_REJECT_REASON_LABEL_KEY. */
  readonly rejectReason: PaymentRejectReason | null;
}

export interface RegistrationDto {
  readonly id: string;
  readonly status: RegistrationStatus;
  readonly createdAt: string;
  readonly match: MatchSummaryDto;
  /** Null for free matches, which are confirmed immediately. */
  readonly payment: RegistrationPaymentDto | null;
}

export interface AdminPaymentDto {
  readonly registrationId: string;
  readonly user: {
    readonly id: string;
    readonly displayName: string;
    readonly preferredLanguage: LocaleCode | null;
  };
  readonly match: MatchSummaryDto;
  readonly registrationStatus: RegistrationStatus;
  readonly payment: RegistrationPaymentDto;
  readonly receiptUploadedAt: string | null;
}

export interface BankDepositDto {
  readonly id: string;
  readonly source: BankDepositSource;
  readonly status: BankDepositStatus;
  readonly matchMethod: BankMatchMethod | null;
  readonly reason: BankDepositReason | null;
  readonly amountKrw: number | null;
  readonly receivedAt: string;
  /** The message as received. Contains personal data: admin screens only. */
  readonly rawText: string;
  readonly matchedRegistrationId: string | null;
}

export interface PlayerStatsDto {
  readonly matchesPlayed: number;
  readonly matchesOrganized: number;
  readonly noShows: number;
  /** Share of marked confirmed matches the player attended; null until an organizer marked any. */
  readonly attendanceRate: number | null;
  readonly last90Days: number;
  readonly firstMatchAt: string | null;
  readonly lastMatchAt: string | null;
  readonly provincesPlayed: number;
}

/** What other players may see. Never includes contact, payment or account details. */
export interface PlayerCardDto {
  readonly id: string;
  readonly displayName: string;
  readonly homeRegion: RegionDto | null;
  readonly level: LevelProgress;
}

export interface PlayerProfileDto extends PlayerCardDto {
  readonly role: UserRole;
  readonly memberSince: string;
  readonly xp: number;
  readonly stats: PlayerStatsDto;
  readonly activity: ActivityLevel;
  readonly achievements: readonly AchievementId[];
  /** Most recent attended matches, newest first. */
  readonly recentMatches: readonly MatchSummaryDto[];
}

export interface RosterEntryDto {
  readonly registrationId: string;
  readonly player: PlayerCardDto;
  /** Null until the organizer marks attendance. */
  readonly attended: boolean | null;
}

export interface OrganizerApplicationDto {
  readonly id: string;
  readonly status: OrganizerApplicationStatus;
  readonly region: RegionDto;
  readonly message: string | null;
  readonly createdAt: string;
  readonly reviewedAt: string | null;
  readonly applicant: { readonly id: string; readonly displayName: string };
}
