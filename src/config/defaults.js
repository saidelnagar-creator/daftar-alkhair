// القوائم الافتراضية للقالب — قيم عامة فقط (لا أسماء ولا أرقام شخصية).
// تُزرع كأحداث عند أول تشغيل، وكل ما فيها قابل للإضافة/التعديل من الواجهة.

export const FUND_TYPES = Object.freeze({
  general: 'عام',
  reserve: 'سيولة احتياطية',
  gold: 'ذهب',
  invest: 'استثمار',
  store: 'مخزن عيني',
  campaigns: 'حملات',
  earmarked: 'أمانات (توصيل لجهة محددة)',
  waqf: 'وقف',
  other: 'أخرى',
});

// معرفات الصناديق الأساسية ثابتة لأن المنطق يشير إليها.
export const DEFAULT_FUNDS = [
  { id: 'general', name: 'الصندوق العام', type: 'general', builtin: true },
  { id: 'reserve', name: 'السيولة الاحتياطية', type: 'reserve', builtin: true },
  { id: 'gold', name: 'صندوق الذهب', type: 'gold', builtin: true },
  { id: 'invest', name: 'صندوق الاستثمار', type: 'invest', builtin: true },
  { id: 'store', name: 'المخزن العيني', type: 'store', builtin: true },
  { id: 'campaigns', name: 'الحملات والمشروعات', type: 'campaigns', builtin: true },
  { id: 'earmarked', name: 'الأمانات المخصصة', type: 'earmarked', builtin: true },
  { id: 'waqf', name: 'صندوق الوقف', type: 'waqf', builtin: true },
];

// مجاميع الأرصدة: رصيد مجمَّع للعرض يضم صناديق تختارها (لا ينقل مالاً ولا يغيّر حساب أي صندوق).
// الافتراضي «رصيد الأسر» = الصندوق العام + الأمانات. يُعدَّل من شاشة الصناديق.
export const DEFAULT_ROLLUPS = Object.freeze([{ id: 'families', name: 'رصيد الأسر', funds: ['general', 'earmarked'] }]);

// نوع المال لكل غرض تبرع (لتنبيهات الصرف: زكاة لا تُصرف لمن لا تحل له).
export const MONEY_TYPES = Object.freeze({
  zakat_mal: 'زكاة مال',
  zakat_fitr: 'زكاة فطر',
  kaffara: 'كفارة',
  sadaqa: 'صدقة',
  conditional: 'مشروط',
  waqf: 'وقف',
});
// الأنواع التي تُعامل معاملة الزكاة في تنبيهات الصرف (زكاة الفطر والكفارات احتياطاً — انظر المواصفة قسم 12).
export const ZAKAT_LIKE = Object.freeze(['zakat_mal', 'zakat_fitr', 'kaffara']);

export const CAMPAIGN_KINDS = ['وجبات رمضان', 'أضاحي', 'مواسم المدارس', 'مسابقة قرآن', 'حالة خاصة', 'أخرى'];

export const DEFAULT_PURPOSES = [
  { id: 'p-general', name: 'تبرع عام' },
  { id: 'p-subscription', name: 'اشتراك شهري' },
  { id: 'p-zakat-mal', name: 'زكاة مال', moneyType: 'zakat_mal' },
  { id: 'p-zakat-fitr', name: 'زكاة الفطر', moneyType: 'zakat_fitr' },
  { id: 'p-sadaqa', name: 'صدقة', moneyType: 'sadaqa' },
  { id: 'p-kaffara', name: 'كفارة', moneyType: 'kaffara' },
  { id: 'p-living', name: 'مساعدة معيشة' },
  { id: 'p-food', name: 'إطعام' },
  { id: 'p-medical', name: 'مساعدة مرض' },
  { id: 'p-education', name: 'تعليم' },
  { id: 'p-marriage', name: 'مساعدة زواج' },
];

export const DEFAULT_EXPENSE_TYPES = [
  { id: 'x-transport', name: 'نقل وتوصيل' },
  { id: 'x-packing', name: 'تعبئة وأكياس' },
  { id: 'x-admin', name: 'مصروفات إدارية', function: 'admin' },
  { id: 'x-other', name: 'أخرى' },
];

export const DEFAULT_FAMILY_CATEGORIES = [
  { id: 'c-orphans', name: 'أيتام' },
  { id: 'c-widows', name: 'أرامل' },
  { id: 'c-sick', name: 'مرضى' },
  { id: 'c-students', name: 'طلاب' },
  { id: 'c-elderly', name: 'كبار سن' },
];

export const DEFAULT_ITEMS = [
  { id: 'i-rice', name: 'أرز', unit: 'كجم' },
  { id: 'i-pasta', name: 'معكرونة', unit: 'كجم' },
  { id: 'i-oil', name: 'زيت', unit: 'زجاجة' },
  { id: 'i-sugar', name: 'سكر', unit: 'كجم' },
  { id: 'i-chicken', name: 'فراخ', unit: 'كجم' },
  { id: 'i-meat', name: 'لحمة', unit: 'كجم' },
];

export const ASSET_KINDS = Object.freeze({
  gold: 'ذهب',
  currency: 'عملة',
  property: 'ممتلكات',
  investment: 'استثمار',
  livestock: 'مواشٍ',
  land: 'أرض / عقار',
  other: 'أخرى',
});

export const UDHIYA_KINDS = ['عجل', 'بقرة', 'جاموس', 'جمل', 'خروف', 'ماعز'];

export const FAMILY_STATUS = Object.freeze({
  permanent: 'مساعدة دائمة (شهرية)',
  occasional: 'مساعدات عند الحاجة',
  paused: 'موقوفة',
});

export const FAMILY_PREFERENCES = ['أموال', 'طعام', 'بقالة'];

// جدول نقاط الاستحقاق الموحّدة: النقاط = (عدد الأفراد × perMember) + نقاط درجة الاحتياج + نقاط الحالات + تعديل يدوي.
// الدعم الشهري المقترح = النقاط × قيمة النقطة (بتاريخ سريان). كله قابل للتعديل من الإعدادات.
export const DEFAULT_CRITERIA = Object.freeze({
  perMember: 1,
  needLevels: [
    { id: 'high', name: 'شديد', points: 3 },
    { id: 'medium', name: 'متوسط', points: 2 },
    { id: 'low', name: 'ضعيف', points: 1 },
  ],
  flags: [
    { id: 'orphans', name: 'أيتام', points: 2 },
    { id: 'chronic', name: 'مرض مزمن', points: 2 },
    { id: 'no-provider', name: 'بدون عائل', points: 2 },
    { id: 'rent', name: 'سكن بالإيجار', points: 1 },
  ],
});

// قيمة النقطة الافتراضية بأعشار الجنيه (1000 = 100 جنيه). تُعدَّل من الإعدادات بتاريخ سريان.
export const DEFAULT_POINT_VALUE = [{ from: '2000-01', value: 1000 }];

export const MONTH_NAMES = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

export const MOVEMENT_KINDS = Object.freeze({
  receipt: 'تبرع / سداد',
  inkind_receipt: 'تبرع عيني',
  distribution: 'صرف لأسرة',
  expense: 'مصروف',
  purchase: 'شراء عيني',
  transfer: 'تحويل بين صناديق',
  asset_buy: 'شراء أصل',
  asset_sell: 'بيع أصل',
  asset_in: 'أصل وارد',
  asset_income: 'عائد استثمار',
  adjustment: 'تسوية',
  opening: 'رصيد افتتاحي',
});
