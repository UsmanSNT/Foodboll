/** Admin settings screens: the bank payment instructions players see, and the legal documents. */
export const adminSettingsKo = {
  lang: {
    tabs: '언어별 내용',
    filled: '작성됨',
    empty: '비어 있음',
    problem: '확인 필요',
    intro: '한국어는 필수예요. 비워 둔 언어를 쓰는 사용자에게는 한국어 내용이 보여요.',
    missingWarning:
      '{languages} 내용이 아직 없어요. 내용이 없는 언어를 쓰는 사용자에게는 한국어 내용이 보여요.',
  },
  field: {
    charsLeft: '{count, number}자 남음',
    charsOver: '{count, number}자 초과',
  },
  errors: {
    tooShort: '{min}자 이상 입력해주세요.',
    languagePartial: '이 언어는 두 항목을 모두 입력하거나, 둘 다 비워주세요.',
  },
  keepEditing: '계속 수정하기',
  leave: {
    title: '작성 중인 내용을 버릴까요?',
    text: '저장하지 않은 내용은 사라져요.',
    confirm: '버리고 나가기',
  },
  payment: {
    title: '결제 안내',
    current: {
      title: '지금 선수에게 보이는 안내',
      shownAs: '{language}를 쓰는 선수에게 보이는 모습이에요.',
      noneTitle: '아직 등록된 안내가 없어요',
      noneText: '계좌 정보를 등록하기 전까지 선수는 어디로 입금해야 하는지 볼 수 없어요.',
      missing:
        '지금은 {languages} 안내가 없어요. 안내가 없는 언어를 쓰는 선수에게는 한국어 안내가 보여요.',
    },
    account: {
      legend: '입금 계좌',
      hint: '은행에 등록된 값 그대로 입력하세요. 모든 언어에서 똑같이 보이고 번역되지 않아요.',
      numberHint: '숫자, 영문, 공백, 하이픈만 쓸 수 있어요. 예: 110-123-456789',
      holderHint: '은행에 등록된 이름 그대로 입력하세요.',
    },
    texts: {
      legend: '언어별 안내',
      bankNameHint: '선수가 은행 앱에서 찾을 이름이에요. 예: 신한은행',
      instructions: '안내 문구',
      instructionsHint:
        '입금 방법과 주의할 점을 알려주세요. 예: 입금 코드를 보내는 사람 메모에 적어주세요.',
    },
    review: '확인하고 저장',
    unchanged: '바뀐 내용이 없어요.',
    preview: {
      title: '저장하기 전에 확인하세요',
      intro: '선수에게 아래처럼 보여요. 언어를 바꿔 가며 각각 확인해보세요.',
      language: '미리 볼 언어',
      fallback: '{language} 안내가 없어서 한국어 안내가 보여요.',
      accountChanged: '계좌번호가 바뀌어요: {from} → {to}',
      holderChanged: '예금주가 바뀌어요: {from} → {to}',
      warning:
        '선수들이 이 계좌로 실제 돈을 보냅니다. 계좌번호와 예금주를 한 글자씩 다시 확인하세요. 잘못 저장하면 선수의 돈이 다른 사람에게 갈 수 있어요.',
      effect: '저장하면 바로 모든 선수에게 적용돼요. 이전 안내는 기록으로 남아요.',
      submit: '저장하고 적용',
    },
    saved: '결제 안내를 저장했어요',
    errors: {
      accountNumberFormat: '숫자, 영문, 공백, 하이픈만 쓸 수 있고 숫자나 영문으로 시작해야 해요.',
    },
  },
  legal: {
    title: '약관·정책',
    intro: '문서를 수정하면 새 버전이 게시돼요. 이전 버전은 그대로 보관돼요.',
    published: '게시됨',
    notPublished: '게시 전',
    version: '버전 {version} · {date} 게시',
    none: '아직 게시된 문서가 없어요.',
    statusUnknown: '상태를 확인할 수 없어요.',
    backToList: '약관·정책 목록',
    editor: {
      intro:
        '게시하면 새 버전이 모든 사용자에게 바로 적용돼요. 이전 버전은 삭제되지 않고 기록으로 남아요.',
      first: '아직 게시된 버전이 없어요. 지금 게시하면 첫 버전이 됩니다.',
    },
    fields: {
      title: '제목',
      body: '본문',
      bodyHint: '일반 텍스트로 입력하세요. 줄바꿈은 입력한 그대로 보여요.',
    },
    publish: '확인하고 게시',
    unchanged: '게시된 버전에서 바뀐 내용이 없어요.',
    confirm: {
      title: '새 버전을 게시할까요?',
      first: '{document}의 첫 버전을 게시합니다. 게시하면 모든 사용자에게 바로 적용돼요.',
      next: '{document}의 새 버전을 게시합니다(현재 버전 {version} 다음). 게시하면 모든 사용자에게 바로 적용돼요. 이전 버전은 기록으로 남지만, 게시한 버전은 수정하거나 삭제할 수 없어요.',
      languages: '언어별 상태',
      emptyFallback: '비어 있음. 이 언어를 쓰는 사용자에게는 한국어가 보여요.',
      removed:
        '이 언어는 현재 게시본에 있지만 새 버전에서는 빠져요. 이 언어를 쓰는 사용자에게는 한국어가 보여요.',
      submit: '게시하기',
    },
    done: '버전 {version}을 게시했어요',
  },
};

export const adminSettingsUz: typeof adminSettingsKo = {
  lang: {
    tabs: 'Tillar bo‘yicha matn',
    filled: 'Yozilgan',
    empty: 'Bo‘sh',
    problem: 'Tekshirish kerak',
    intro: 'Koreys tili majburiy. Bo‘sh qoldirilgan tilni o‘qiydiganlar koreyscha matnni ko‘radi.',
    missingWarning:
      '{languages} tilida matn hali yo‘q. Matni bo‘lmagan tilni o‘qiydiganlar koreyscha matnni ko‘radi.',
  },
  field: {
    charsLeft: '{count, number} belgi qoldi',
    charsOver: '{count, number} belgi ortiqcha',
  },
  errors: {
    tooShort: 'Kamida {min} ta belgi kiriting.',
    languagePartial:
      'Bu til uchun ikkala maydonni ham to‘ldiring yoki ikkalasini ham bo‘sh qoldiring.',
  },
  keepEditing: 'Tahrirlashni davom ettirish',
  leave: {
    title: 'Yozganlaringiz o‘chib ketsinmi?',
    text: 'Saqlanmagan ma’lumotlar yo‘qoladi.',
    confirm: 'O‘chirib, chiqish',
  },
  payment: {
    title: 'To‘lov ko‘rsatmasi',
    current: {
      title: 'Futbolchilar hozir ko‘rayotgan ma’lumot',
      shownAs: '{language} tilini o‘qiydigan futbolchilarga shunday ko‘rinadi.',
      noneTitle: 'Ko‘rsatma hali kiritilmagan',
      noneText:
        'Hisob ma’lumotlari kiritilmaguncha futbolchilar pulni qayerga yuborishni ko‘ra olmaydi.',
      missing:
        'Hozir {languages} tilida ko‘rsatma yo‘q. Matni bo‘lmagan tilni o‘qiydigan futbolchilar koreyscha matnni ko‘radi.',
    },
    account: {
      legend: 'To‘lov hisobi',
      hint: 'Bankda ro‘yxatdan o‘tgan ma’lumotni aynan shunday kiriting. U barcha tillarda bir xil ko‘rinadi va tarjima qilinmaydi.',
      numberHint: 'Faqat raqam, lotin harflari, bo‘sh joy va defis. Masalan: 110-123-456789',
      holderHint: 'Bankda ro‘yxatdan o‘tgan nom bilan aynan bir xil yozing.',
    },
    texts: {
      legend: 'Tillar bo‘yicha ko‘rsatma',
      bankNameHint: 'Futbolchi bank ilovasida qidiradigan nom. Masalan: Shinhan Bank',
      instructions: 'Ko‘rsatma matni',
      instructionsHint:
        'To‘lovni qanday qilish va nimaga e’tibor berish kerakligini yozing. Masalan: to‘lov kodini izohga yozing.',
    },
    review: 'Tekshirib saqlash',
    unchanged: 'O‘zgarish yo‘q.',
    preview: {
      title: 'Saqlashdan oldin tekshiring',
      intro:
        'Futbolchilarga quyidagicha ko‘rinadi. Tillarni almashtirib, har birini tekshirib chiqing.',
      language: 'Ko‘rish tili',
      fallback: '{language} tilida matn yo‘q, shuning uchun koreyscha matn ko‘rsatiladi.',
      accountChanged: 'Hisob raqami o‘zgaradi: {from} → {to}',
      holderChanged: 'Hisob egasi o‘zgaradi: {from} → {to}',
      warning:
        'Futbolchilar shu hisobga haqiqiy pul yuboradi. Hisob raqami va hisob egasini bir belgidan tekshirib chiqing. Xato saqlansa, futbolchilarning puli boshqa odamga ketib qolishi mumkin.',
      effect:
        'Saqlansa, yangi ma’lumot darhol barcha futbolchilarga ko‘rinadi. Oldingi ko‘rsatma tarix sifatida saqlanadi.',
      submit: 'Saqlash va qo‘llash',
    },
    saved: 'To‘lov ko‘rsatmasi saqlandi',
    errors: {
      accountNumberFormat:
        'Faqat raqam, lotin harflari, bo‘sh joy va defis kiriting; raqam yoki harf bilan boshlang.',
    },
  },
  legal: {
    title: 'Shartlar va siyosat',
    intro:
      'Hujjatni o‘zgartirsangiz, yangi versiya e’lon qilinadi. Eski versiyalar saqlanib qoladi.',
    published: 'E’lon qilingan',
    notPublished: 'E’lon qilinmagan',
    version: '{version}-versiya · e’lon qilingan: {date}',
    none: 'Hali e’lon qilingan hujjat yo‘q.',
    statusUnknown: 'Holatini bilib bo‘lmadi.',
    backToList: 'Hujjatlar ro‘yxati',
    editor: {
      intro:
        'E’lon qilsangiz, yangi versiya darhol hamma uchun kuchga kiradi. Eski versiyalar o‘chirilmaydi, tarix sifatida saqlanadi.',
      first: 'Hali versiya e’lon qilinmagan. Hozir e’lon qilsangiz, bu birinchi versiya bo‘ladi.',
    },
    fields: {
      title: 'Sarlavha',
      body: 'Matn',
      bodyHint: 'Oddiy matn kiriting. Qatorlar kiritganingizdek ko‘rinadi.',
    },
    publish: 'Tekshirib e’lon qilish',
    unchanged: 'E’lon qilingan versiyadan o‘zgarish yo‘q.',
    confirm: {
      title: 'Yangi versiya e’lon qilinsinmi?',
      first:
        '{document} hujjatining birinchi versiyasi e’lon qilinadi. E’lon qilingach, u darhol hamma uchun kuchga kiradi.',
      next: '{document} hujjatining yangi versiyasi e’lon qilinadi ({version}-versiyadan keyin). U darhol hamma uchun kuchga kiradi. Eski versiyalar tarix sifatida saqlanadi, lekin e’lon qilingan versiyani tahrirlab yoki o‘chirib bo‘lmaydi.',
      languages: 'Tillar holati',
      emptyFallback: 'Bo‘sh. Bu tilni o‘qiydiganlar koreyscha matnni ko‘radi.',
      removed:
        'Bu til hozirgi versiyada bor, lekin yangi versiyada bo‘lmaydi. Bu tilni o‘qiydiganlar koreyscha matnni ko‘radi.',
      submit: 'E’lon qilish',
    },
    done: '{version}-versiya e’lon qilindi',
  },
};

export const adminSettingsEn: typeof adminSettingsKo = {
  lang: {
    tabs: 'Text by language',
    filled: 'Written',
    empty: 'Empty',
    problem: 'Needs attention',
    intro: 'Korean is required. People who read a language you leave empty see the Korean text.',
    missingWarning:
      'There is no text yet in {languages}. When a language has no text, people who read it see the Korean text.',
  },
  field: {
    charsLeft: '{count, plural, one {# character left} other {# characters left}}',
    charsOver: '{count, plural, one {# character over} other {# characters over}}',
  },
  errors: {
    tooShort: 'Enter at least {min} characters.',
    languagePartial: 'Fill in both fields for this language, or leave both empty.',
  },
  keepEditing: 'Keep editing',
  leave: {
    title: 'Discard your changes?',
    text: 'Anything you haven’t saved will be lost.',
    confirm: 'Discard and leave',
  },
  payment: {
    title: 'Payment instructions',
    current: {
      title: 'What players see now',
      shownAs: 'This is how players who read {language} see it.',
      noneTitle: 'No payment instructions yet',
      noneText: 'Until you add the bank details, players can’t see where to send their payment.',
      missing:
        'Right now there is no text in {languages}. When a language has no text, players who read it see the Korean text.',
    },
    account: {
      legend: 'Bank account',
      hint: 'Enter them exactly as the bank has them. They look the same in every language and are never translated.',
      numberHint: 'Digits, letters, spaces and hyphens only. Example: 110-123-456789',
      holderHint: 'Write the name exactly as it is registered at the bank.',
    },
    texts: {
      legend: 'Text by language',
      bankNameHint: 'The name players look for in their banking app. Example: Shinhan Bank',
      instructions: 'Instructions',
      instructionsHint:
        'Explain how to pay and what to watch out for. Example: put your payment code in the sender memo.',
    },
    review: 'Review and save',
    unchanged: 'Nothing has changed.',
    preview: {
      title: 'Check before saving',
      intro: 'This is how players will see it. Switch languages to check each one.',
      language: 'Preview language',
      fallback: 'There is no {language} text, so players see the Korean text.',
      accountChanged: 'The account number changes: {from} → {to}',
      holderChanged: 'The account holder changes: {from} → {to}',
      warning:
        'Players will send real money to this account. Check the account number and holder name character by character. If they are wrong, players’ money can go to someone else.',
      effect: 'Players see the new details right away. The previous ones are kept as history.',
      submit: 'Save and apply',
    },
    saved: 'Payment instructions saved',
    errors: {
      accountNumberFormat:
        'Use only digits, letters, spaces and hyphens, and start with a digit or letter.',
    },
  },
  legal: {
    title: 'Terms and policies',
    intro: 'Editing a document publishes a new version. Earlier versions are kept.',
    published: 'Published',
    notPublished: 'Not published',
    version: 'Version {version} · published {date}',
    none: 'Nothing has been published yet.',
    statusUnknown: 'Status unavailable.',
    backToList: 'All documents',
    editor: {
      intro:
        'When you publish, the new version applies to everyone right away. Earlier versions are not deleted; they are kept as history.',
      first: 'Nothing is published yet. If you publish now, this becomes the first version.',
    },
    fields: {
      title: 'Title',
      body: 'Text',
      bodyHint: 'Plain text. Line breaks are kept as you type them.',
    },
    publish: 'Review and publish',
    unchanged: 'Nothing has changed from the published version.',
    confirm: {
      title: 'Publish a new version?',
      first:
        'You are publishing the first version of {document}. It applies to everyone right away.',
      next: 'You are publishing a new version of {document}, after version {version}. It applies to everyone right away. Earlier versions are kept as history, and a published version can’t be edited or deleted.',
      languages: 'Languages',
      emptyFallback: 'Empty. People who read this language see the Korean text.',
      removed:
        'This language is in the published version but will not be in the new one. People who read it will see the Korean text.',
      submit: 'Publish',
    },
    done: 'Version {version} published',
  },
};
