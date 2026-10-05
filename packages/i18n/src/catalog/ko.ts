import { glossaryMessages } from '../glossary';

/**
 * Korean catalog. This file defines the shape of every catalog: other locales are typed as
 * `typeof ko`, so a missing or extra key is a compile error.
 *
 * Messages use ICU MessageFormat. Never write an ASCII apostrophe (`'`) in a message.
 */
export const ko = {
  app: {
    name: 'Foodboll',
  },
  common: {
    loading: '불러오는 중…',
    retry: '다시 시도',
    save: '저장',
    cancel: '취소',
    confirm: '확인',
    close: '닫기',
    back: '뒤로',
    required: '필수',
  },
  language: {
    select: '언어 선택',
    title: '언어',
    description: '앱에서 사용할 언어를 선택하세요. 언제든지 마이페이지에서 바꿀 수 있습니다.',
    current: '현재 언어',
    saved: '언어가 변경되었습니다.',
    saveFailed: '계정에 언어를 저장하지 못했습니다. 이 기기에는 적용되었습니다.',
  },
  nav: {
    matches: '매치',
    teams: '팀',
    players: '선수',
    myPage: '마이페이지',
    main: '주 메뉴',
    breadcrumb: '현재 위치',
  },
  myPage: {
    title: '마이페이지',
    settings: '설정',
    paymentInfo: '입금 안내',
    legal: '약관 및 정책',
  },
  settings: {
    title: '설정',
  },
  match: {
    apply: '매치 신청',
    confirmed: '참가 확정',
    cancelled: '취소됨',
    applied: '신청 완료',
    listTitle: '매치 목록',
    listEmpty: '등록된 매치가 없습니다.',
    startsAt: '일시',
    format: '경기 방식',
    formatValue: '{size}v{size}',
    fee: '참가비',
    organizer: '주최자',
    description: '매치 소개',
    rules: '규칙',
    locationInstructions: '장소 안내',
    equipmentRequirements: '준비물',
    cancellationPolicy: '취소 규정',
    notFound: '매치를 찾을 수 없습니다.',
  },
  content: {
    fallbackNotice: '원문({language})을 표시하고 있습니다.',
    empty: '내용이 없습니다.',
  },
  payment: {
    pending: '입금 확인 중',
    awaiting: '입금 대기',
    paid: '입금 확인 완료',
    rejected: '입금 확인 불가',
    refunded: '환불 완료',
    uploadReceipt: '입금 영수증 업로드',
    instructionsTitle: '입금 안내',
    account: '입금 계좌',
    bankName: '은행',
    accountNumber: '계좌번호',
    accountHolder: '예금주',
    notAvailable: '입금 안내가 아직 등록되지 않았습니다.',
  },
  stats: {
    title: '기록',
    rating: '평점',
    level: '레벨',
    levelValue: 'Lv. {level}',
    experience: '경험치',
    achievements: '업적',
    matchesPlayed: '경기 수',
    goals: '골',
    assists: '어시스트',
  },
  notification: {
    paymentConfirmed: {
      title: '입금 확인 완료',
      body: '입금이 확인되었습니다.',
    },
    participationConfirmed: {
      title: '참가 확정',
      body: '매치 참가가 확정되었습니다.',
    },
  },
  legal: {
    terms: '이용약관',
    privacy: '개인정보 처리방침',
    cancellation: '취소 정책',
    refund: '환불 정책',
    notAvailable: '문서가 아직 게시되지 않았습니다.',
  },
  format: {
    // Date/time and money are composed from catalog patterns, not from platform Intl locale data,
    // which is incomplete for some languages on some devices.
    dateTime:
      '{year}년 {month}월 {day}일({weekday, select, 0 {일} 1 {월} 2 {화} 3 {수} 4 {목} 5 {금} 6 {토} other {}}) {hour}:{minute}',
    krw: '{amount}원',
  },
  form: {
    required: '필수 입력 항목입니다.',
    tooLong: '{max}자 이하로 입력해주세요.',
  },
  errors: {
    INTERNAL_ERROR: '문제가 발생했습니다. 잠시 후 다시 시도해주세요.',
    NETWORK_ERROR: '네트워크 연결을 확인한 후 다시 시도해주세요.',
    UNAUTHENTICATED: '로그인이 필요합니다.',
    FORBIDDEN: '이 작업을 수행할 권한이 없습니다.',
    VALIDATION_FAILED: '입력한 내용을 확인해주세요.',
    NOT_FOUND: '요청하신 내용을 찾을 수 없습니다.',
    RATE_LIMITED: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',
    LANGUAGE_NOT_SUPPORTED: '지원하지 않는 언어입니다.',
    SOURCE_TRANSLATION_REQUIRED: '원문 언어(기본 언어)로 작성한 내용이 반드시 필요합니다.',
    MATCH_NOT_FOUND: '매치를 찾을 수 없습니다.',
    PAYMENT_INSTRUCTIONS_NOT_FOUND: '입금 안내가 아직 등록되지 않았습니다.',
    LEGAL_DOCUMENT_NOT_FOUND: '문서가 아직 게시되지 않았습니다.',
  },
  glossary: glossaryMessages('ko'),
};
