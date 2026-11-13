// ترحيل 3 → 4: حاسبة الاحتياج والالتزام العيني وصندوق الوقف.
// لا يمس أي حدث موجود: يضيف فقط ما تزرعه الدفاتر الجديدة (بنفس المعرّفات الثابتة فلا يتكرر عند الدمج):
//   - صندوق الوقف الأساسي، ونوع المال للأغراض الافتراضية (زكاة مال/فطر، صدقة، كفارة) إن لم يُحدَّد،
//   - النسخة الأولى من إعداد حاسبة الاحتياج.
// أنواع الأحداث الجديدة (family.inkind.set، need.*، udhiya.upsert) اختيارية ولا تحتاج تحويلاً.
// لا تعدّل هذا الملف بعد النشر — نسخة الإعداد هنا مثبتة كما كانت يوم الترحيل.
import { NEED_DEFAULT_CONFIG } from '../../config/need-config.js';

const TS = '2000-01-01T00:00:00.000Z';
const PURPOSE_TYPES = { 'p-zakat-mal': 'zakat_mal', 'p-zakat-fitr': 'zakat_fitr', 'p-sadaqa': 'sadaqa', 'p-kaffara': 'kaffara' };

export const m004 = {
  from: 3,
  to: 4,
  description: 'حاسبة الاحتياج (نسخة إعداد أولى)، نوع المال للأغراض الافتراضية، صندوق الوقف',
  migrate(doc) {
    const ids = new Set(doc.events.map((e) => e.id));
    const add = [];
    const push = (ev) => {
      if (!ids.has(ev.id)) add.push(ev);
    };
    push({ id: 'seed-funds-waqf', ts: TS, type: 'list.upsert', data: { list: 'funds', item: { id: 'waqf', name: 'صندوق الوقف', type: 'waqf', builtin: true } } });
    // نوع المال يُضاف فقط للأغراض الافتراضية الموجودة فعلاً (لا يُنشئ غرضاً حذفه صاحب الدفتر، ولا يغيّر اسماً عدّله)
    const purposes = new Set();
    const typed = new Set();
    for (const e of doc.events) {
      if (e.type !== 'list.upsert' || !e.data || e.data.list !== 'purposes' || !e.data.item) continue;
      purposes.add(e.data.item.id);
      if (e.data.item.moneyType !== undefined) typed.add(e.data.item.id);
    }
    for (const [id, moneyType] of Object.entries(PURPOSE_TYPES)) {
      if (purposes.has(id) && !typed.has(id)) add.push({ id: `mig4-purpose-${id}`, ts: TS, type: 'list.upsert', data: { list: 'purposes', item: { id, moneyType } } });
    }
    const hasConfig = doc.events.some((e) => e.type === 'need.config.set');
    if (!hasConfig) push({ id: 'seed-need-config-1', ts: TS, type: 'need.config.set', data: { from: '2000-01', version: 1, config: JSON.parse(JSON.stringify(NEED_DEFAULT_CONFIG)), note: 'الإعداد الافتراضي (الدليل — نوفمبر 2026)' } });
    // أحداث الزرع تُلحق في آخر السجل: القوائم لا تعتمد على الترتيب، والأحداث السابقة لا تشير إليها.
    return { ...doc, schemaVersion: 4, events: [...doc.events, ...add] };
  },
};
