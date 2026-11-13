// سياق الواجهة المشترك: المخزن، التنسيق حسب الإعدادات، التنقل. يُملأ في main.js.
import { fmtAssetQty, fmtMoney, fmtQty } from '../core/money.js';
import { monthLabel, todayISO, ymOf } from '../core/util.js';
import { currentFiscalYear, precisionAt, stepsAt } from '../core/engine.js';

export const ctx = {
  store: null,
  pgroup: 'other', // مجموعة الخصوصية للشاشة المعروضة (يضبطها app.js عند كل رسم)
  get state() {
    return this.store.state;
  },
  get arabic() {
    return this.state.settings.digits === 'arab';
  },
  today: () => todayISO(),
  nowMonth: () => ymOf(todayISO()),
  fiscalYear() {
    return currentFiscalYear(this.state, new Date().getFullYear());
  },
  // الخانات العشرية السارية اليوم (لضبط الإدخال)؛ التحقق النهائي في المنطق حسب تاريخ الحركة.
  precision() {
    return precisionAt(this.state, todayISO());
  },
  steps(date) {
    return stepsAt(this.state, date || todayISO());
  },
  nav(path) {
    location.hash = path;
  },
  back() {
    if (history.length > 1) history.back();
    else location.hash = '#/';
  },
  refresh: () => {},
};

const digits = (s) => (ctx.store && ctx.arabic ? String(s).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]) : String(s));

const DEC_WORD = ['بلا كسور', 'خانة عشرية واحدة على الأكثر', 'خانتان عشريتان على الأكثر', '3 خانات عشرية على الأكثر'];
// نصوص أخطاء الإدخال حسب الإعداد الحالي.
export const RULE = {
  money: () => `أدخل مبلغاً صحيحاً (${DEC_WORD[ctx.precision().money]})`,
  qty: () => `أدخل كمية صحيحة (${DEC_WORD[ctx.precision().qty]})`,
  asset: () => `أدخل كمية صحيحة (${DEC_WORD[ctx.precision().asset]})`,
};

export const F = {
  money: (u, o = {}) => fmtMoney(u, { arabic: ctx.arabic, ...o }),
  egp: (u, o = {}) => `${fmtMoney(u, { arabic: ctx.arabic, ...o })} ج`,
  qty: (u) => fmtQty(u, { arabic: ctx.arabic }),
  aqty: (u) => fmtAssetQty(u, { arabic: ctx.arabic }),
  num: (n) => digits(n),
  date: (iso) => (iso ? digits(`${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`) : ''),
  month: (ym, o) => digits(monthLabel(ym, o)),
  monthShort: (ym) => monthLabel(ym, { short: true }),
  dateTime: (ts) => {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return digits(`${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`);
  },
};
