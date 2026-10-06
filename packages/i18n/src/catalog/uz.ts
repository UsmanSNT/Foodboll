import { glossaryMessages } from '../glossary';
import type { ko } from './ko';

/**
 * Uzbek (Latin) catalog. Typed as `typeof ko`: every key must exist here.
 *
 * Typography: use ‘ (U+2018) in o‘, g‘ and ’ (U+2019) for the tutuq belgisi (Ma’lumot).
 * Never use an ASCII apostrophe: it is an escape character in ICU MessageFormat.
 *
 * NOTE: needs review by a native Uzbek speaker who plays football before release.
 */
export const uz: typeof ko = {
  app: {
    name: 'Foodboll',
  },
  common: {
    loading: 'Yuklanmoqda…',
    retry: 'Qayta urinish',
    save: 'Saqlash',
    cancel: 'Bekor qilish',
    confirm: 'Tasdiqlash',
    close: 'Yopish',
    back: 'Orqaga',
    required: 'Majburiy',
  },
  language: {
    select: 'Tilni tanlang',
    title: 'Til',
    description:
      'Ilovada ishlatiladigan tilni tanlang. Uni istalgan vaqtda Profil bo‘limidan o‘zgartirishingiz mumkin.',
    current: 'Joriy til',
    saved: 'Til o‘zgartirildi.',
    saveFailed: 'Tilni hisobingizga saqlab bo‘lmadi. U ushbu qurilmada qo‘llanildi.',
  },
  nav: {
    matches: 'Matchlar',
    teams: 'Jamoalar',
    players: 'Futbolchilar',
    myPage: 'Profil',
    main: 'Asosiy menyu',
    breadcrumb: 'Joriy joy',
  },
  myPage: {
    title: 'Profil',
    settings: 'Sozlamalar',
    paymentInfo: 'To‘lov bo‘yicha ma’lumot',
    registrations: 'Mening arizalarim',
    legal: 'Shartlar va siyosat',
  },
  settings: {
    title: 'Sozlamalar',
  },
  match: {
    apply: 'Matchga yozilish',
    confirmed: 'Ishtirok tasdiqlandi',
    cancelled: 'Bekor qilindi',
    applied: 'Ariza yuborildi',
    listTitle: 'Matchlar ro‘yxati',
    listEmpty: 'Hozircha matchlar yo‘q.',
    startsAt: 'Sana va vaqt',
    format: 'O‘yin formati',
    formatValue: '{size}x{size}',
    fee: 'Ishtirok to‘lovi',
    organizer: 'Tashkilotchi',
    description: 'Match haqida',
    rules: 'Qoidalar',
    locationInstructions: 'Manzil bo‘yicha ko‘rsatma',
    equipmentRequirements: 'Kerakli jihozlar',
    cancellationPolicy: 'Bekor qilish shartlari',
    notFound: 'Match topilmadi.',
    maxPlayers: 'Ishtirokchilar soni',
  },
  registration: {
    title: 'Mening arizalarim',
    applied: 'Arizangiz qabul qilindi. To‘lovni amalga oshirib, chekni yuklang.',
    empty: 'Hali hech qaysi matchga yozilmagansiz.',
    cancel: 'Arizani bekor qilish',
    dueAt: 'To‘lov muddati',
    receiptHint: 'JPG, PNG, PDF · eng ko‘pi bilan {maxMb} MB',
    cancelConfirm: 'Bu arizani bekor qilasizmi?',
    freeConfirmed: 'Ishtirok to‘lovi yo‘q, shuning uchun ishtirokingiz darhol tasdiqlandi.',
  },
  content: {
    fallbackNotice: 'Asl matn ({language}) ko‘rsatilmoqda.',
    empty: 'Ma’lumot kiritilmagan.',
  },
  payment: {
    pending: 'To‘lov tekshirilmoqda',
    awaiting: 'To‘lov kutilmoqda',
    paid: 'To‘lov tasdiqlandi',
    rejected: 'To‘lov tasdiqlanmadi',
    refundPending: 'Qaytarish kutilmoqda',
    refunded: 'To‘lov qaytarildi',
    uploadReceipt: 'To‘lov chekini yuklash',
    instructionsTitle: 'To‘lov bo‘yicha ko‘rsatma',
    account: 'To‘lov uchun hisob',
    bankName: 'Bank',
    accountNumber: 'Hisob raqami',
    accountHolder: 'Hisob egasi',
    notAvailable: 'To‘lov bo‘yicha ma’lumot hali kiritilmagan.',
    amount: 'To‘lov summasi',
    rejectReasonLabel: 'Sabab',
    rejectReason: {
      AMOUNT_MISMATCH: 'To‘lov summasi mos kelmadi',
      RECEIPT_UNREADABLE: 'Chekni o‘qib bo‘lmadi',
      PAYMENT_NOT_FOUND: 'To‘lov topilmadi',
      OTHER: 'Boshqa sabab',
    },
  },
  stats: {
    title: 'Statistika',
    rating: 'Reyting',
    level: 'Daraja',
    levelValue: '{level}-daraja',
    experience: 'Tajriba balli',
    achievements: 'Yutuqlar',
    matchesPlayed: 'O‘yinlar soni',
    goals: 'Gollar',
    assists: 'Gol uzatmalari',
  },
  notification: {
    paymentConfirmed: {
      title: 'To‘lov tasdiqlandi',
      body: 'To‘lovingiz tasdiqlandi.',
    },
    paymentRejected: {
      title: 'To‘lov tasdiqlanmadi',
      body: 'To‘lovni tasdiqlab bo‘lmadi. Sabab: {reason}. Chekni qayta yuklang.',
    },
    paymentRefunded: {
      title: 'To‘lov qaytarildi',
      body: 'To‘lagan summangiz qaytarildi.',
    },
    participationConfirmed: {
      title: 'Ishtirok tasdiqlandi',
      body: 'Matchdagi ishtirokingiz tasdiqlandi.',
    },
  },
  legal: {
    terms: 'Foydalanish shartlari',
    privacy: 'Maxfiylik siyosati',
    cancellation: 'Bekor qilish siyosati',
    refund: 'Pulni qaytarish siyosati',
    notAvailable: 'Hujjat hali e’lon qilinmagan.',
  },
  format: {
    dateTime:
      '{day}-{month, select, 1 {yanvar} 2 {fevral} 3 {mart} 4 {aprel} 5 {may} 6 {iyun} 7 {iyul} 8 {avgust} 9 {sentabr} 10 {oktabr} 11 {noyabr} 12 {dekabr} other {}} {year}, {weekday, select, 0 {yakshanba} 1 {dushanba} 2 {seshanba} 3 {chorshanba} 4 {payshanba} 5 {juma} 6 {shanba} other {}}, {hour}:{minute}',
    krw: '₩{amount}',
  },
  form: {
    required: 'Majburiy maydon.',
    tooLong: 'Eng ko‘pi bilan {max} ta belgi kiriting.',
  },
  errors: {
    INTERNAL_ERROR: 'Xatolik yuz berdi. Iltimos, birozdan so‘ng qayta urinib ko‘ring.',
    NETWORK_ERROR: 'Internet aloqasini tekshirib, qayta urinib ko‘ring.',
    UNAUTHENTICATED: 'Tizimga kirish talab qilinadi.',
    FORBIDDEN: 'Bu amalni bajarishga ruxsatingiz yo‘q.',
    VALIDATION_FAILED: 'Kiritilgan ma’lumotlarni tekshiring.',
    NOT_FOUND: 'So‘ralgan ma’lumot topilmadi.',
    RATE_LIMITED: 'So‘rovlar juda ko‘p. Birozdan so‘ng qayta urinib ko‘ring.',
    LANGUAGE_NOT_SUPPORTED: 'Bu til qo‘llab-quvvatlanmaydi.',
    SOURCE_TRANSLATION_REQUIRED: 'Asl (asosiy) tilda yozilgan ma’lumot majburiy.',
    MATCH_NOT_FOUND: 'Match topilmadi.',
    PAYMENT_INSTRUCTIONS_NOT_FOUND: 'To‘lov bo‘yicha ma’lumot hali kiritilmagan.',
    LEGAL_DOCUMENT_NOT_FOUND: 'Hujjat hali e’lon qilinmagan.',
    PAYLOAD_TOO_LARGE: 'Fayl juda katta. Kichikroq fayl yuklang.',
    REGISTRATION_NOT_FOUND: 'Ariza topilmadi.',
    RECEIPT_NOT_FOUND: 'Chek yuklanmagan.',
    ALREADY_REGISTERED: 'Siz bu matchga allaqachon yozilgansiz.',
    MATCH_FULL: 'Joylar to‘lgan.',
    MATCH_STARTED: 'Match allaqachon boshlangan.',
    INVALID_STATE: 'Hozirgi holatda bu amalni bajarib bo‘lmaydi.',
    INVALID_RECEIPT: 'Faqat JPG, PNG yoki PDF fayl yuklash mumkin.',
    REGION_NOT_FOUND: 'Hudud topilmadi.',
    REGION_FORBIDDEN: 'Bu hududda match e’lon qilishga ruxsatingiz yo‘q.',
    CAPACITY_BELOW_REGISTRATIONS:
      'Ishtirokchilar sonini hozirgi arizalar sonidan kamaytirib bo‘lmaydi.',
  },
  glossary: glossaryMessages('uz'),
};
